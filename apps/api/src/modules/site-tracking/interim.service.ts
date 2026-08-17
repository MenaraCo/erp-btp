import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export type TypeElementInterim =
  | 'panier' | 'trajet' | 'transport' | 'ifm' | 'iccp' | 'prime' | 'autre';

export interface ElementInterimInput {
  type: TypeElementInterim;
  label?: string | null;
  montant?: string | number;
  unite?: 'jour' | 'heure' | 'forfait' | 'pourcentage';
  codeAnalytiqueId?: string | null;
}

export interface ContratInterimInput {
  supplierId?: string | null;
  agence?: string | null;
  reference?: string | null;
  dateDebut: string;
  dateFin?: string | null;
  tauxHoraire?: string | number;
  coefficient?: string | number;
  codeAnalytiqueId?: string | null;
  commentaire?: string | null;
  elements?: ElementInterimInput[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Libellés par défaut : personne ne devrait avoir à retaper « Indemnité de fin de mission ». */
const LIBELLES: Record<TypeElementInterim, string> = {
  panier: 'Panier repas',
  trajet: 'Indemnité de trajet',
  transport: 'Indemnité de transport',
  ifm: 'Indemnité de fin de mission',
  iccp: 'Indemnité compensatrice de congés payés',
  prime: 'Prime',
  autre: 'Autre indemnité',
};

/**
 * Contrats d'intérim — l'agence, les termes, et ce que l'heure coûte VRAIMENT.
 *
 * Un intérimaire n'est pas une ligne de paye : c'est un achat d'heures. L'agence facture le taux
 * horaire MULTIPLIÉ par son coefficient (1,8 à 2,2 dans le BTP), puis ajoute paniers, trajets,
 * indemnité de fin de mission et congés payés. Retenir le taux horaire nu — ce que faisait la
 * fiche salarié — sous-estimait le coût du chantier de 60 à 100 % sur chaque heure d'intérim.
 *
 * Le taux facturé est donc CALCULÉ et figé au contrat : le jour où l'agence renégocie son
 * coefficient, les heures déjà pointées gardent le prix auquel elles ont réellement été payées.
 */
@Injectable()
export class InterimService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Contrats d'un salarié, du plus récent au plus ancien, avec leurs éléments. */
  contrats(employeeId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const contrats = await em.query(
        `SELECT c.*, c.date_debut::text AS date_debut, c.date_fin::text AS date_fin,
                s.name AS fournisseur, ac.code AS code_analytique
           FROM interim_contract c
           LEFT JOIN supplier s ON s.id = c.supplier_id
           LEFT JOIN analytical_code ac ON ac.id = c.code_analytique_id
          WHERE c.employee_id = $1
          ORDER BY c.date_debut DESC`,
        [employeeId],
      );
      if (contrats.length === 0) return [];
      const elements = await em.query(
        `SELECT e.*, ac.code AS code_analytique
           FROM interim_contract_element e
           LEFT JOIN analytical_code ac ON ac.id = e.code_analytique_id
          WHERE e.contract_id = ANY($1::uuid[])
          ORDER BY e.created_at`,
        [contrats.map((c: { id: string }) => c.id)],
      );
      return contrats.map((c: Record<string, unknown>) => ({
        ...c,
        elements: elements.filter((e: Record<string, unknown>) => e.contract_id === c.id),
      }));
    });
  }

  creer(employeeId: string, input: ContratInterimInput) {
    const tenantId = this.context.requireTenantId();
    if (!ISO.test(input.dateDebut ?? '')) {
      throw new BadRequestException('La date de début du contrat est requise (AAAA-MM-JJ).');
    }
    if (input.dateFin && !ISO.test(input.dateFin)) {
      throw new BadRequestException('Date de fin attendue au format AAAA-MM-JJ.');
    }
    const taux = new Decimal(input.tauxHoraire ?? 0);
    const coeff = new Decimal(input.coefficient ?? 1);
    if (taux.isNegative()) throw new BadRequestException('Le taux horaire ne peut pas être négatif.');
    if (coeff.lessThanOrEqualTo(0)) throw new BadRequestException('Le coefficient doit être positif.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const salarie = (await em.query(
        `SELECT contract_type FROM employee WHERE id = $1 AND deleted_at IS NULL`, [employeeId],
      ))[0];
      if (!salarie) throw new NotFoundException('Salarié introuvable.');
      if (salarie.contract_type !== 'interimaire') {
        throw new BadRequestException(
          'Ce salarié n’est pas en intérim : changez son type de contrat avant d’ajouter un contrat d’agence.',
        );
      }

      const contrat = (await em.query(
        `INSERT INTO interim_contract
           (tenant_id, employee_id, supplier_id, agence, reference, date_debut, date_fin,
            taux_horaire, coefficient, taux_facture, code_analytique_id, commentaire)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12)
         RETURNING *, date_debut::text AS date_debut, date_fin::text AS date_fin`,
        [
          tenantId, employeeId, input.supplierId ?? null,
          (input.agence ?? '').trim() || null, (input.reference ?? '').trim() || null,
          input.dateDebut, input.dateFin ?? null,
          taux.toFixed(4), coeff.toFixed(4),
          // Le taux facturé est figé ici : il ne se recalcule pas après coup.
          taux.times(coeff).toFixed(4),
          input.codeAnalytiqueId ?? null, (input.commentaire ?? '').trim() || null,
        ],
      ))[0];

      for (const el of input.elements ?? []) {
        await this.poserElement(em, tenantId, contrat.id, el);
      }
      return this.contrat(em, contrat.id);
    });
  }

  modifier(contractId: string, patch: Partial<ContratInterimInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const actuel = (await em.query(
        `SELECT * FROM interim_contract WHERE id = $1`, [contractId],
      ))[0];
      if (!actuel) throw new NotFoundException('Contrat introuvable.');

      const taux = patch.tauxHoraire !== undefined
        ? new Decimal(patch.tauxHoraire) : new Decimal(String(actuel.taux_horaire));
      const coeff = patch.coefficient !== undefined
        ? new Decimal(patch.coefficient) : new Decimal(String(actuel.coefficient));
      if (coeff.lessThanOrEqualTo(0)) throw new BadRequestException('Le coefficient doit être positif.');

      await em.query(
        `UPDATE interim_contract SET
           supplier_id = CASE WHEN $2::boolean THEN $3 ELSE supplier_id END,
           agence = COALESCE($4, agence),
           reference = COALESCE($5, reference),
           date_debut = COALESCE($6::date, date_debut),
           date_fin = CASE WHEN $7::boolean THEN $8::date ELSE date_fin END,
           taux_horaire = $9, coefficient = $10, taux_facture = $11,
           code_analytique_id = CASE WHEN $12::boolean THEN $13 ELSE code_analytique_id END,
           commentaire = COALESCE($14, commentaire),
           updated_at = now()
         WHERE id = $1`,
        [
          contractId,
          patch.supplierId !== undefined, patch.supplierId ?? null,
          patch.agence ?? null, patch.reference ?? null,
          patch.dateDebut ?? null,
          patch.dateFin !== undefined, patch.dateFin ?? null,
          taux.toFixed(4), coeff.toFixed(4), taux.times(coeff).toFixed(4),
          patch.codeAnalytiqueId !== undefined, patch.codeAnalytiqueId ?? null,
          patch.commentaire ?? null,
        ],
      );

      // Les éléments fournis remplacent les précédents : un contrat se renégocie en bloc, et
      // fusionner ligne à ligne ferait survivre une indemnité supprimée.
      if (patch.elements) {
        await em.query(`DELETE FROM interim_contract_element WHERE contract_id = $1`, [contractId]);
        for (const el of patch.elements) {
          await this.poserElement(em, tenantId, contractId, el);
        }
      }
      return this.contrat(em, contractId);
    });
  }

  supprimer(contractId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const r = await em.query(`DELETE FROM interim_contract WHERE id = $1`, [contractId]);
      if (Array.isArray(r) && r[1] === 0) throw new NotFoundException('Contrat introuvable.');
      return { supprime: true };
    });
  }

  /**
   * Coût horaire applicable à une date : le taux FACTURÉ du contrat qui couvre ce jour-là.
   * Sans contrat, on retombe sur le coût horaire de la fiche — un intérimaire de passage vaut
   * mieux qu'un pointage refusé.
   */
  async tauxApplicable(
    em: EntityManager, employeeId: string, date: string,
  ): Promise<string | null> {
    const rows = await em.query(
      `SELECT taux_facture FROM interim_contract
        WHERE employee_id = $1 AND date_debut <= $2::date
          AND (date_fin IS NULL OR date_fin >= $2::date)
        ORDER BY date_debut DESC LIMIT 1`,
      [employeeId, date],
    );
    return rows[0]?.taux_facture != null ? String(rows[0].taux_facture) : null;
  }

  private async poserElement(
    em: EntityManager, tenantId: string, contractId: string, el: ElementInterimInput,
  ) {
    if (!LIBELLES[el.type]) throw new BadRequestException(`Type d’indemnité inconnu : ${el.type}`);
    await em.query(
      `INSERT INTO interim_contract_element
         (tenant_id, contract_id, type, label, montant, unite, code_analytique_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tenantId, contractId, el.type,
        (el.label ?? '').trim() || LIBELLES[el.type],
        new Decimal(el.montant ?? 0).toFixed(4),
        el.unite ?? 'jour',
        el.codeAnalytiqueId ?? null,
      ],
    );
  }

  private async contrat(em: EntityManager, contractId: string) {
    const c = (await em.query(
      `SELECT c.*, c.date_debut::text AS date_debut, c.date_fin::text AS date_fin,
              s.name AS fournisseur, ac.code AS code_analytique
         FROM interim_contract c
         LEFT JOIN supplier s ON s.id = c.supplier_id
         LEFT JOIN analytical_code ac ON ac.id = c.code_analytique_id
        WHERE c.id = $1`,
      [contractId],
    ))[0];
    const elements = await em.query(
      `SELECT e.*, ac.code AS code_analytique
         FROM interim_contract_element e
         LEFT JOIN analytical_code ac ON ac.id = e.code_analytique_id
        WHERE e.contract_id = $1 ORDER BY e.created_at`,
      [contractId],
    );
    return { ...c, elements };
  }
}
