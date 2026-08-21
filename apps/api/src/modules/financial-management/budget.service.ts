import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { AnalyticalPlanService } from '../analytical/analytical-plan.service';
import { aggregateAnalytical, MeasureRow, Metrics } from './analytical-aggregate';
import { budgetEtude, UNALLOC_PREFIX } from './budget-etude';

/** Les quatre colonnes du tableau des budgets, dans l'ordre de lecture. */
const METRICS = ['etude', 'mouvements', 'global', 'initial'] as const;

export interface SaisieBudget {
  date?: string;
  codeAnalytiqueId: string;
  ressourceId?: string | null;
  libelle: string;
  quantite?: string | number;
  montant: string | number;
  motif?: string | null;
}

export interface RipageBudget {
  date?: string;
  /** Source : d'où le budget est repris. Ressource ou, à défaut, code analytique seul. */
  sourceRessourceId?: string | null;
  sourceCodeAnalytiqueId?: string | null;
  /** Cible : où il est reporté. */
  cibleRessourceId?: string | null;
  cibleCodeAnalytiqueId?: string | null;
  montant: string | number;
  motif: string;
}

interface RessourceRow {
  id: string;
  code: string;
  label: string;
  unit: string | null;
  nature: string;
  code_analytique_id: string | null;
  code_analytique: string | null;
}

/**
 * Les budgets d'un chantier (guide Suivi de chantiers §17 à 20, cahier §5.8).
 *
 * Un chantier n'a pas UN budget mais une pile :
 *  - le budget d'ÉTUDE d'exécution, calculé (quantités × prix objectif) — la prévision technique ;
 *  - les MOUVEMENTS saisis : dotations, reprises, et surtout RIPAGES d'une ressource à l'autre ;
 *  - le budget GLOBAL = étude + mouvements, la cible du moment, celle que le contrôle de gestion
 *    compare à l'engagé et au réalisé ;
 *  - le budget INITIAL, photo du global figée à une date, qui dit si l'on tient l'objectif du
 *    départ ou une cible repoussée en douce.
 *
 * Le ripage n'est pas une correction d'étude : l'étude reste ce qu'elle était (on doit pouvoir
 * dire ce qu'on avait prévu), le mouvement dit ce qu'on a déplacé, quand, par qui et pourquoi.
 * Un ripage est donc TOUJOURS à somme nulle — deux lignes opposées partageant un même groupe.
 */
@Injectable()
export class BudgetService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly plan: AnalyticalPlanService,
  ) {}

  /** Tableau des budgets par code analytique : étude / mouvements / global / initial. */
  async tableau(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    await this.plan.ensurePlan(tenantId);
    const tree = await this.plan.getTree(tenantId);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);

      const etude = await budgetEtude(em, chantierId, 'code');
      const mouvements: Array<{ code_id: string | null; nature: string; montant: string }> =
        await em.query(
          `SELECT code_analytique_id AS code_id, nature, SUM(montant)::numeric(16,2) AS montant
             FROM chantier_budget_movement WHERE chantier_id = $1
            GROUP BY code_analytique_id, nature`,
          [chantierId],
        );
      const initial: Array<{ code_id: string | null; nature: string; montant: string }> =
        await em.query(
          `SELECT code_analytique_id AS code_id, nature, SUM(montant)::numeric(16,2) AS montant
             FROM chantier_budget_initial WHERE chantier_id = $1
            GROUP BY code_analytique_id, nature`,
          [chantierId],
        );
      const fige = (
        await em.query(
          `SELECT MAX(fixed_at) AS fixed_at FROM chantier_budget_initial WHERE chantier_id = $1`,
          [chantierId],
        )
      )[0];

      // Les frais de chantier vivent hors de l'axe analytique (lignes non vendables) : ils ont
      // leur propre branche, comme dans le tableau de bord analytique.
      const frais: Record<string, Decimal> = {
        etude: etude.fraisChantier,
        mouvements: new Decimal(0),
        global: etude.fraisChantier,
        initial: new Decimal(0),
      };
      const rows: MeasureRow[] = [];
      for (const [bucket, montant] of etude.parBucket) {
        rows.push(this.bucketRow(bucket, { etude: montant.toString(), global: montant.toString() }));
      }
      for (const m of mouvements) {
        const montant = new Decimal(m.montant ?? 0);
        if (!m.code_id && m.nature === 'site_overhead') {
          frais.mouvements = frais.mouvements.plus(montant);
          frais.global = frais.global.plus(montant);
          continue;
        }
        rows.push({
          codeId: m.code_id,
          nature: m.nature as MeasureRow['nature'],
          metrics: { mouvements: m.montant, global: m.montant } as Metrics,
        });
      }
      for (const i of initial) {
        const montant = new Decimal(i.montant ?? 0);
        if (!i.code_id && i.nature === 'site_overhead') {
          frais.initial = frais.initial.plus(montant);
          continue;
        }
        rows.push({
          codeId: i.code_id,
          nature: i.nature as MeasureRow['nature'],
          metrics: { initial: i.montant } as Metrics,
        });
      }

      const aggregate = aggregateAnalytical(tree, rows, [...METRICS]);
      const total: Record<string, string> = {};
      for (const m of METRICS) {
        total[m] = new Decimal(aggregate.total[m] ?? 0).plus(frais[m]).toString();
      }

      return {
        chantierId,
        fixedAt: fige?.fixed_at ?? null,
        natures: aggregate.natures,
        aVentiler: aggregate.aVentiler,
        fraisChantier: {
          label: 'Frais de chantier',
          metrics: Object.fromEntries(METRICS.map((m) => [m, frais[m].toString()])),
        },
        total,
      };
    });
  }

  /**
   * Ressources du chantier avec leur budget (étude + mouvements) : la liste dans laquelle on
   * choisit d'où l'on ripe et où l'on ripe. Sans le budget restant en face, le conducteur ripe à
   * l'aveugle et vide une ligne sans s'en rendre compte.
   */
  ressources(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const etude = await budgetEtude(em, chantierId, 'ressource');
      const ressources: RessourceRow[] = await em.query(
        `SELECT n.id, n.code, n.label, n.unit, n.nature, n.code_analytique_id,
                c.code AS code_analytique
           FROM nomenclature_resource n
           LEFT JOIN analytical_code c ON c.id = n.code_analytique_id
          WHERE n.chantier_id = $1
          ORDER BY n.label`,
        [chantierId],
      );
      const mvts: Array<{ resource_id: string; montant: string }> = await em.query(
        `SELECT nomenclature_resource_id AS resource_id, SUM(montant)::numeric(16,2) AS montant
           FROM chantier_budget_movement
          WHERE chantier_id = $1 AND nomenclature_resource_id IS NOT NULL
          GROUP BY nomenclature_resource_id`,
        [chantierId],
      );
      const parRessource = new Map(mvts.map((m) => [m.resource_id, new Decimal(m.montant ?? 0)]));

      return ressources.map((r) => {
        const e = etude.parBucket.get(r.id) ?? new Decimal(0);
        const m = parRessource.get(r.id) ?? new Decimal(0);
        return {
          id: r.id,
          code: r.code,
          label: r.label,
          unit: r.unit,
          nature: r.nature,
          codeAnalytiqueId: r.code_analytique_id,
          codeAnalytique: r.code_analytique,
          etude: e.toFixed(2),
          mouvements: m.toFixed(2),
          global: e.plus(m).toFixed(2),
        };
      });
    });
  }

  /** Une dotation (ou une reprise, montant négatif) saisie à la main sur un code analytique. */
  saisir(chantierId: string, input: SaisieBudget) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    const montant = new Decimal(input.montant ?? 0);
    if (montant.isZero()) throw new BadRequestException('Le montant du budget ne peut pas être nul.');
    if (!input.libelle?.trim()) throw new BadRequestException('Le libellé est obligatoire.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const cible = await this.resoudre(em, chantierId, input.ressourceId ?? null, input.codeAnalytiqueId);
      const [row] = await em.query(
        `INSERT INTO chantier_budget_movement
           (tenant_id, chantier_id, date, type, code_analytique_id, nomenclature_resource_id,
            nature, libelle, quantite, montant, motif, actor_user_id)
         VALUES (current_tenant(), $1, COALESCE($2::date, CURRENT_DATE), 'saisie', $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          chantierId, input.date ?? null, cible.codeId, cible.ressourceId, cible.nature,
          input.libelle.trim(), input.quantite ?? 0, montant.toFixed(2), input.motif ?? null, userId,
        ],
      );
      return { id: row.id };
    });
  }

  /**
   * Ripage : reprendre du budget ici pour le porter là. Deux mouvements opposés, un seul geste.
   *
   * Refusé si la source n'a pas le budget : un ripage qui creuse un trou ailleurs ne déplace rien,
   * il maquille. Refusé aussi sans motif — six mois plus tard, un ripage sans raison est
   * indéfendable en réunion de chantier.
   */
  riper(chantierId: string, input: RipageBudget) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    const montant = new Decimal(input.montant ?? 0);
    if (!montant.isPositive() || montant.isZero()) {
      throw new BadRequestException('Le montant à riper doit être positif : la source est déjà indiquée.');
    }
    if (!input.motif?.trim()) throw new BadRequestException('Le motif du ripage est obligatoire.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const source = await this.resoudre(
        em, chantierId, input.sourceRessourceId ?? null, input.sourceCodeAnalytiqueId ?? null,
      );
      const cible = await this.resoudre(
        em, chantierId, input.cibleRessourceId ?? null, input.cibleCodeAnalytiqueId ?? null,
      );
      if (source.ressourceId && source.ressourceId === cible.ressourceId) {
        throw new BadRequestException('La source et la cible du ripage sont identiques.');
      }
      if (!source.ressourceId && !cible.ressourceId && source.codeId === cible.codeId) {
        throw new BadRequestException('La source et la cible du ripage sont identiques.');
      }

      const disponible = await this.budgetDisponible(em, chantierId, source);
      if (montant.greaterThan(disponible)) {
        throw new BadRequestException(
          `Budget insuffisant sur la source : ${disponible.toFixed(2)} € disponibles.`,
        );
      }

      const [{ transfert }] = await em.query(`SELECT gen_random_uuid() AS transfert`);
      const libelle = `Ripage — ${input.motif.trim()}`;
      const insert = (c: Cible, signe: -1 | 1) =>
        em.query(
          `INSERT INTO chantier_budget_movement
             (tenant_id, chantier_id, date, type, code_analytique_id, nomenclature_resource_id,
              nature, libelle, quantite, montant, motif, transfer_group_id, actor_user_id)
           VALUES (current_tenant(), $1, COALESCE($2::date, CURRENT_DATE), 'ripage', $3, $4, $5, $6, 0, $7, $8, $9, $10)`,
          [
            chantierId, input.date ?? null, c.codeId, c.ressourceId, c.nature, libelle,
            montant.times(signe).toFixed(2), input.motif.trim(), transfert, userId,
          ],
        );
      await insert(source, -1);
      await insert(cible, 1);
      return { transfertId: transfert, montant: montant.toFixed(2) };
    });
  }

  /**
   * Fige le budget global du moment : c'est le budget « initial », la référence de comparaison.
   * Le refiger écrase la photo précédente — on ne garde qu'une référence, sinon « initial » ne
   * veut plus rien dire.
   */
  fixerBudgetInitial(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const etude = await budgetEtude(em, chantierId, 'code');
      const mouvements: Array<{ code_id: string | null; nature: string; montant: string }> =
        await em.query(
          `SELECT code_analytique_id AS code_id, nature, SUM(montant)::numeric(16,2) AS montant
             FROM chantier_budget_movement WHERE chantier_id = $1
            GROUP BY code_analytique_id, nature`,
          [chantierId],
        );
      const natures = await this.naturesParCode(em);

      const cumul = new Map<string, { codeId: string | null; nature: string; montant: Decimal }>();
      const ajoute = (codeId: string | null, nature: string, montant: Decimal) => {
        const cle = `${codeId ?? '-'}|${nature}`;
        const e = cumul.get(cle) ?? { codeId, nature, montant: new Decimal(0) };
        e.montant = e.montant.plus(montant);
        cumul.set(cle, e);
      };
      for (const [bucket, montant] of etude.parBucket) {
        if (bucket.startsWith(UNALLOC_PREFIX)) {
          ajoute(null, bucket.slice(UNALLOC_PREFIX.length), montant);
        } else {
          ajoute(bucket, natures.get(bucket) ?? 'material', montant);
        }
      }
      if (!etude.fraisChantier.isZero()) ajoute(null, 'site_overhead', etude.fraisChantier);
      for (const m of mouvements) ajoute(m.code_id, m.nature, new Decimal(m.montant ?? 0));

      await em.query(`DELETE FROM chantier_budget_initial WHERE chantier_id = $1`, [chantierId]);
      for (const e of cumul.values()) {
        if (e.montant.isZero()) continue;
        await em.query(
          `INSERT INTO chantier_budget_initial
             (tenant_id, chantier_id, code_analytique_id, nature, montant, actor_user_id)
           VALUES (current_tenant(), $1, $2, $3, $4, $5)`,
          [chantierId, e.codeId, e.nature, e.montant.toFixed(2), userId],
        );
      }
      const fige = (
        await em.query(
          `SELECT MAX(fixed_at) AS fixed_at FROM chantier_budget_initial WHERE chantier_id = $1`,
          [chantierId],
        )
      )[0];
      return { fixedAt: fige?.fixed_at ?? null, lignes: cumul.size };
    });
  }

  /** Journal horodaté : qui a bougé quel budget, quand, de combien et pourquoi. */
  historique(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      return em.query(
        `SELECT m.id, m.date::text AS date, m.type, m.libelle, m.motif,
                m.quantite::numeric(16,3) AS quantite, m.montant::numeric(16,2) AS montant,
                m.transfer_group_id, m.created_at,
                c.code AS code_analytique, c.label AS code_label,
                n.code AS ressource_code, n.label AS ressource_label,
                COALESCE(u.full_name, u.email) AS auteur
           FROM chantier_budget_movement m
           LEFT JOIN analytical_code c ON c.id = m.code_analytique_id
           LEFT JOIN nomenclature_resource n ON n.id = m.nomenclature_resource_id
           LEFT JOIN user_account u ON u.id = m.actor_user_id
          WHERE m.chantier_id = $1
          ORDER BY m.created_at DESC, m.montant DESC`,
        [chantierId],
      );
    });
  }

  /**
   * Annule un mouvement. Un ripage s'annule des DEUX côtés : n'en retirer qu'une jambe créerait
   * du budget (ou en détruirait) sans que personne ne l'ait décidé.
   */
  supprimerMouvement(chantierId: string, mouvementId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [m] = await em.query(
        `SELECT id, transfer_group_id FROM chantier_budget_movement
          WHERE id = $1 AND chantier_id = $2`,
        [mouvementId, chantierId],
      );
      if (!m) throw new NotFoundException('Mouvement de budget introuvable.');
      if (m.transfer_group_id) {
        await em.query(`DELETE FROM chantier_budget_movement WHERE transfer_group_id = $1`, [
          m.transfer_group_id,
        ]);
        return { supprimes: 2 };
      }
      await em.query(`DELETE FROM chantier_budget_movement WHERE id = $1`, [mouvementId]);
      return { supprimes: 1 };
    });
  }

  /* ─────────── interne ─────────── */

  /** Budget global disponible sur la source d'un ripage (étude + mouvements déjà passés). */
  private async budgetDisponible(em: EntityManager, chantierId: string, cible: Cible): Promise<Decimal> {
    if (cible.ressourceId) {
      const etude = await budgetEtude(em, chantierId, 'ressource');
      const [m] = await em.query(
        `SELECT COALESCE(SUM(montant), 0)::numeric(16,2) AS montant
           FROM chantier_budget_movement
          WHERE chantier_id = $1 AND nomenclature_resource_id = $2`,
        [chantierId, cible.ressourceId],
      );
      return (etude.parBucket.get(cible.ressourceId) ?? new Decimal(0)).plus(
        new Decimal(m?.montant ?? 0),
      );
    }
    const etude = await budgetEtude(em, chantierId, 'code');
    const [m] = await em.query(
      `SELECT COALESCE(SUM(montant), 0)::numeric(16,2) AS montant
         FROM chantier_budget_movement
        WHERE chantier_id = $1 AND code_analytique_id = $2`,
      [chantierId, cible.codeId],
    );
    return (etude.parBucket.get(cible.codeId!) ?? new Decimal(0)).plus(new Decimal(m?.montant ?? 0));
  }

  /**
   * Résout une extrémité de mouvement : une ressource porte son propre code analytique (et sa
   * nature) ; à défaut on accepte un code analytique seul, dont la nature vient de sa famille.
   */
  private async resoudre(
    em: EntityManager,
    chantierId: string,
    ressourceId: string | null,
    codeAnalytiqueId: string | null,
  ): Promise<Cible> {
    if (ressourceId) {
      const [r] = await em.query(
        `SELECT id, nature, code_analytique_id FROM nomenclature_resource
          WHERE id = $1 AND chantier_id = $2`,
        [ressourceId, chantierId],
      );
      if (!r) throw new NotFoundException('Ressource introuvable sur ce chantier.');
      const codeId = codeAnalytiqueId ?? r.code_analytique_id;
      if (!codeId) {
        throw new BadRequestException(
          'Cette ressource n’a pas de code analytique : ventilez-la avant de riper son budget.',
        );
      }
      return { codeId, ressourceId: r.id, nature: r.nature ?? 'material' };
    }
    if (!codeAnalytiqueId) {
      throw new BadRequestException('Indiquez une ressource ou un code analytique.');
    }
    const natures = await this.naturesParCode(em);
    const [c] = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [codeAnalytiqueId]);
    if (!c) throw new NotFoundException('Code analytique introuvable.');
    return { codeId: codeAnalytiqueId, ressourceId: null, nature: natures.get(codeAnalytiqueId) ?? 'material' };
  }

  /** Nature portée par la FAMILLE du code (repli sur le lot), comme le plan analytique. */
  private async naturesParCode(em: EntityManager): Promise<Map<string, string>> {
    const rows: Array<{ id: string; nature: string }> = await em.query(
      `SELECT c.id, COALESCE(f.nature, l.nature) AS nature
         FROM analytical_code c
         JOIN analytical_famille f ON f.id = c.famille_id
         JOIN analytical_lot l ON l.id = f.lot_id`,
    );
    return new Map(rows.map((r) => [r.id, r.nature]));
  }

  private bucketRow(bucket: string, metrics: Metrics): MeasureRow {
    if (bucket.startsWith(UNALLOC_PREFIX)) {
      return { codeId: null, nature: bucket.slice(UNALLOC_PREFIX.length) as MeasureRow['nature'], metrics };
    }
    return { codeId: bucket, nature: 'material', metrics };
  }

  private async assertChantier(em: EntityManager, chantierId: string): Promise<void> {
    const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
    if (c.length === 0) throw new NotFoundException(`Chantier "${chantierId}" introuvable.`);
  }
}

interface Cible {
  codeId: string | null;
  ressourceId: string | null;
  nature: string;
}
