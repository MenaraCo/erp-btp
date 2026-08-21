import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export type TypeVentilable =
  | 'ressource' | 'commande' | 'facture' | 'pointage' | 'materiel';

/**
 * Ventilation analytique — ranger ce qui est arrivé sans code, et CORRIGER ce qui est mal rangé.
 *
 * Une dépense sans code analytique tombe dans « 999 — À ventiler » : elle est comptée dans le
 * total du chantier, mais dans aucun poste. Jusqu'ici on ne pouvait la classer que si elle venait
 * de la nomenclature — l'engagé d'une commande, une facture ou des heures restaient à ventiler
 * pour toujours, sans le moindre écran pour les traiter.
 *
 * Et une imputation se corrige : on découvre en cours de chantier qu'une ressource était du
 * matériel et non de la main-d'œuvre. Choisir un code ne doit donc jamais être définitif — la
 * seule règle est de ne pas réécrire ce qui est FIGÉ (heures imputées au mois clôturé).
 */
@Injectable()
export class VentilationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /**
   * Tout ce qui, sur ce chantier, ne porte pas de code analytique — budget, engagé et réalisé
   * confondus. C'est la liste de travail du conducteur, pas un simple constat.
   */
  aVentiler(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ressources = await em.query(
        // La ressource ne porte pas de quantité : elle est employée par des ouvrages, chacun avec
        // la sienne. Le montant à ventiler est donc la somme de ses emplois.
        `SELECT n.id, n.code, n.label, n.nature, n.unit,
                COALESCE(SUM(ec.quantite_objectif * n.unit_cost_objectif), 0)::numeric(16,2) AS montant
           FROM nomenclature_resource n
           LEFT JOIN execution_component ec ON ec.nomenclature_resource_id = n.id
          WHERE n.chantier_id = $1 AND n.code_analytique_id IS NULL
          GROUP BY n.id, n.code, n.label, n.nature, n.unit
          ORDER BY n.label`,
        [chantierId],
      );
      const commandes = await em.query(
        `SELECT l.id, o.code AS piece, l.designation AS label, l.nature,
                l.amount_ht::numeric(16,2) AS montant, o.status
           FROM purchase_order_line l
           JOIN purchase_order o ON o.id = l.order_id
          WHERE o.chantier_id = $1 AND l.code_analytique_id IS NULL
            AND l.kind <> 'comment' AND o.status <> 'cancelled'
          ORDER BY o.code, l.sort_order`,
        [chantierId],
      );
      const factures = await em.query(
        `SELECT f.id, f.code AS piece, f.nature, f.amount_ht::numeric(16,2) AS montant,
                f.invoice_date::text AS date
           FROM supplier_invoice f
          WHERE f.chantier_id = $1 AND f.code_analytique_id IS NULL
          ORDER BY f.invoice_date DESC`,
        [chantierId],
      );
      const pointages = await em.query(
        `SELECT t.id, t.employee_label AS label, t.work_date::text AS date,
                t.hours, t.cost::numeric(16,2) AS montant,
                (t.imputed_at IS NOT NULL) AS fige
           FROM timesheet t
          WHERE t.chantier_id = $1 AND t.code_analytique_id IS NULL
          ORDER BY t.work_date DESC`,
        [chantierId],
      );
      const materiel = await em.query(
        `SELECT u.id, e.code AS piece, e.label, u.work_date::text AS date,
                u.cout::numeric(16,2) AS montant
           FROM equipment_usage u
           JOIN equipment e ON e.id = u.equipment_id
          WHERE u.chantier_id = $1 AND u.code_analytique_id IS NULL
          ORDER BY u.work_date DESC`,
        [chantierId],
      );

      const somme = (lignes: Array<{ montant: string }>) =>
        lignes.reduce((t, l) => t + Number(l.montant ?? 0), 0).toFixed(2);

      return {
        ressources,
        commandes,
        factures,
        pointages,
        materiel,
        totaux: {
          budget: somme(ressources),
          engage: somme(commandes),
          realise: (
            Number(somme(factures)) + Number(somme(pointages)) + Number(somme(materiel))
          ).toFixed(2),
        },
        // Ce qui reste bloqué : des heures d'un mois déjà imputé ne se reclassent pas ici.
        figes: pointages.filter((p: { fige: boolean }) => p.fige).length,
      };
    });
  }

  /**
   * Impute (ou ré-impute) une ligne, quel que soit son type.
   *
   * Une commande ENVOYÉE reste imputable : le code analytique ne regarde que notre comptabilité,
   * il ne change rien à ce que le fournisseur a reçu. Refuser la correction obligerait à rouvrir
   * une commande partie — c'est-à-dire à mentir sur son statut pour ranger un chiffre.
   */
  imputer(
    chantierId: string, type: TypeVentilable, id: string, codeAnalytiqueId: string | null,
  ) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      if (codeAnalytiqueId) {
        const code = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [codeAnalytiqueId]);
        if (code.length === 0) throw new NotFoundException('Code analytique introuvable.');
      }

      switch (type) {
        case 'ressource':
          return this.majUne(
            em, `UPDATE nomenclature_resource SET code_analytique_id = $1, updated_at = now()
                  WHERE id = $2 AND chantier_id = $3`,
            [codeAnalytiqueId, id, chantierId], 'Ressource introuvable sur ce chantier.',
          );
        case 'commande':
          return this.majUne(
            em, `UPDATE purchase_order_line l SET code_analytique_id = $1
                   FROM purchase_order o
                  WHERE l.id = $2 AND o.id = l.order_id AND o.chantier_id = $3`,
            [codeAnalytiqueId, id, chantierId], 'Ligne de commande introuvable sur ce chantier.',
          );
        case 'facture':
          return this.majUne(
            em, `UPDATE supplier_invoice SET code_analytique_id = $1
                  WHERE id = $2 AND chantier_id = $3`,
            [codeAnalytiqueId, id, chantierId], 'Facture introuvable sur ce chantier.',
          );
        case 'materiel':
          return this.majUne(
            em, `UPDATE equipment_usage SET code_analytique_id = $1, updated_at = now()
                  WHERE id = $2 AND chantier_id = $3`,
            [codeAnalytiqueId, id, chantierId], 'Relevé de matériel introuvable sur ce chantier.',
          );
        case 'pointage': {
          // Les heures d'un mois imputé sont arrêtées : les reclasser changerait un résultat
          // publié. On le dit, plutôt que de laisser croire à une correction silencieuse.
          const t = (await em.query(
            `SELECT imputed_at FROM timesheet WHERE id = $1 AND chantier_id = $2`,
            [id, chantierId],
          ))[0];
          if (!t) throw new NotFoundException('Pointage introuvable sur ce chantier.');
          if (t.imputed_at) {
            throw new BadRequestException(
              'Ces heures sont imputées : leur mois est arrêté, l’imputation ne se corrige plus.',
            );
          }
          return this.majUne(
            em, `UPDATE timesheet SET code_analytique_id = $1, updated_at = now()
                  WHERE id = $2 AND chantier_id = $3`,
            [codeAnalytiqueId, id, chantierId], 'Pointage introuvable sur ce chantier.',
          );
        }
        default:
          throw new BadRequestException(`Type à ventiler inconnu : ${type}`);
      }
    });
  }

  private async majUne(
    em: EntityManager, sql: string, params: unknown[], introuvable: string,
  ): Promise<{ impute: boolean }> {
    const r = await em.query(sql, params);
    const touchees = Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 1;
    if (touchees === 0) throw new NotFoundException(introuvable);
    return { impute: params[0] != null };
  }
}
