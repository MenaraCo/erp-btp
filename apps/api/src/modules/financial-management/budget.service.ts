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

interface LigneParCode {
  code_id: string | null;
  nature: string;
  categorie: string;
  montant: string;
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

  /**
   * Tableau des budgets : trois blocs (charges, frais généraux, produits) et deux résultats.
   *
   * La cohérence avec l'ÉTUDE DE PRIX est structurelle, pas déclarative : les charges viennent du
   * déboursé de l'étude d'exécution, les frais généraux des lignes non vendables reprises du devis
   * (FG + frais annexes), les produits du montant HT des marchés et de leurs avenants. Résultat
   * net = vente − déboursé − FG = le BÉNÉFICE de la feuille de vente. Aucune saisie n'est requise
   * pour que le chantier dise la même chose que le devis qui l'a vendu.
   */
  async tableau(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    await this.plan.ensurePlan(tenantId);
    const tree = await this.plan.getTree(tenantId);
    const sections = await this.plan.sections(tenantId);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);

      const etude = await budgetEtude(em, chantierId, 'code');
      const mouvements = await this.parCode(em, chantierId, 'chantier_budget_movement');
      const initial = await this.parCode(em, chantierId, 'chantier_budget_initial');
      const fige = (
        await em.query(
          `SELECT MAX(fixed_at) AS fixed_at FROM chantier_budget_initial WHERE chantier_id = $1`,
          [chantierId],
        )
      )[0];
      // Recettes de l'étude : ce que les marchés (devis gagnés) et leurs avenants ont vendu.
      const [vente] = await em.query(
        `SELECT COALESCE(SUM(m.total_ht), 0)::numeric(16,2) AS marches,
                COALESCE((SELECT SUM(a.total_ht) FROM avenant a
                           JOIN marche mm ON mm.id = a.marche_id
                          WHERE mm.chantier_id = $1 AND a.status <> 'cancelled'), 0)::numeric(16,2) AS avenants
           FROM marche m WHERE m.chantier_id = $1`,
        [chantierId],
      );
      const venteMarches = new Decimal(vente?.marches ?? 0);
      const venteAvenants = new Decimal(vente?.avenants ?? 0);

      /* ── Bloc CHARGES : l'axe analytique des 4 natures ── */
      const rows: MeasureRow[] = [];
      for (const [bucket, montant] of etude.parBucket) {
        rows.push(this.bucketRow(bucket, { etude: montant.toString(), global: montant.toString() }));
      }
      const fg = this.accumulateur();
      const parCodeFg = new Map<string, Record<string, Decimal>>();
      const parCodeProduit = new Map<string, Record<string, Decimal>>();
      const produits = this.accumulateur();
      // Frais de chantier repris du devis (lignes non vendables) NON ventilés : ils restent dans
      // les frais généraux, sans poste. Une fois ventilés, ils suivent leur code — c'est la
      // catégorie de ce code qui décide du bloc, exactement comme pour une saisie.
      const fraisNonVentiles = this.accumulateur();
      const categories = await this.categoriesParCode(em);

      for (const [bucket, montant] of etude.fraisParBucket) {
        if (bucket.startsWith(UNALLOC_PREFIX)) {
          for (const m of ['etude', 'global'] as const) {
            fraisNonVentiles[m] = fraisNonVentiles[m].plus(montant);
            fg[m] = fg[m].plus(montant);
          }
          continue;
        }
        const categorie = categories.get(bucket) ?? 'charge';
        if (categorie === 'charge') {
          rows.push(this.bucketRow(bucket, { etude: montant.toString(), global: montant.toString() }));
          continue;
        }
        const cible = categorie === 'produit' ? parCodeProduit : parCodeFg;
        const totalCible = categorie === 'produit' ? produits : fg;
        const acc = cible.get(bucket) ?? this.accumulateur();
        for (const m of ['etude', 'global'] as const) {
          acc[m] = acc[m].plus(montant);
          totalCible[m] = totalCible[m].plus(montant);
        }
        cible.set(bucket, acc);
      }

      const ranger = (
        ligne: LigneParCode,
        metriques: Array<'mouvements' | 'global' | 'initial'>,
      ) => {
        const montant = new Decimal(ligne.montant ?? 0);
        if (montant.isZero()) return;
        if (ligne.categorie === 'produit') {
          if (ligne.code_id) {
            const acc = parCodeProduit.get(ligne.code_id) ?? this.accumulateur();
            for (const m of metriques) acc[m] = acc[m].plus(montant);
            parCodeProduit.set(ligne.code_id, acc);
          }
          for (const m of metriques) produits[m] = produits[m].plus(montant);
          return;
        }
        if (ligne.categorie === 'frais_generaux' || (!ligne.code_id && ligne.nature === 'site_overhead')) {
          if (ligne.code_id) {
            const acc = parCodeFg.get(ligne.code_id) ?? this.accumulateur();
            for (const m of metriques) acc[m] = acc[m].plus(montant);
            parCodeFg.set(ligne.code_id, acc);
          }
          for (const m of metriques) fg[m] = fg[m].plus(montant);
          return;
        }
        const metrics: Metrics = {};
        for (const m of metriques) metrics[m] = ligne.montant;
        rows.push({ codeId: ligne.code_id, nature: ligne.nature as MeasureRow['nature'], metrics });
      };

      for (const m of mouvements) ranger(m, ['mouvements', 'global']);
      for (const i of initial) ranger(i, ['initial']);

      const aggregate = aggregateAnalytical(tree, rows, [...METRICS]);

      /* ── Bloc PRODUITS : la vente des marchés en « étude », les saisies par-dessus ── */
      const venteTotale = venteMarches.plus(venteAvenants);
      produits.etude = produits.etude.plus(venteTotale);
      produits.global = produits.global.plus(venteTotale);
      // La recette du budget INITIAL n'est pas recalculée ici : elle a été figée avec le reste
      // (voir fixerBudgetInitial), sinon un avenant signé plus tard réécrirait la référence.

      const lignesFg = await this.lignesParCode(em, sections.fraisGeneraux.codes, parCodeFg);
      const lignesProduits = await this.lignesParCode(em, sections.produits.codes, parCodeProduit);

      /* ── Totaux et résultats ── */
      const totalCharges: Record<string, string> = {};
      const resultatBrut: Record<string, string> = {};
      const resultatNet: Record<string, string> = {};
      for (const m of METRICS) {
        const charges = new Decimal(aggregate.total[m] ?? 0);
        totalCharges[m] = charges.toString();
        const brut = produits[m].minus(charges);
        resultatBrut[m] = brut.toString();
        resultatNet[m] = brut.minus(fg[m]).toString();
      }

      return {
        chantierId,
        fixedAt: fige?.fixed_at ?? null,
        charges: {
          label: 'Charges',
          natures: aggregate.natures,
          aVentiler: aggregate.aVentiler,
          total: totalCharges,
        },
        fraisGeneraux: {
          label: 'Frais généraux',
          // Repris du devis : la part FG de la feuille de vente, non saisie à la main.
          fraisChantier: {
            label: 'Frais du devis — non ventilés',
            metrics: this.rendu(fraisNonVentiles),
          },
          lignes: lignesFg,
          total: this.rendu(fg),
        },
        produits: {
          label: 'Produits',
          marches: {
            label: 'Recettes travaux — marchés',
            venteMarches: venteMarches.toFixed(2),
            venteAvenants: venteAvenants.toFixed(2),
            metrics: this.rendu({
              etude: venteTotale,
              mouvements: new Decimal(0),
              global: venteTotale,
              initial: new Decimal(0),
            }),
          },
          lignes: lignesProduits,
          total: this.rendu(produits),
        },
        resultatBrut,
        resultatNet,
        /** Total général des charges + frais généraux : la dépense autorisée, tous postes confondus. */
        total: Object.fromEntries(
          METRICS.map((m) => [m, new Decimal(totalCharges[m]).plus(fg[m]).toString()]),
        ),
      };
    });
  }

  /** Catégorie de chaque code analytique : c'est elle qui décide du bloc où le montant tombe. */
  private async categoriesParCode(em: EntityManager): Promise<Map<string, string>> {
    const rows: Array<{ id: string; categorie: string }> = await em.query(
      `SELECT id, COALESCE(categorie, 'charge') AS categorie FROM analytical_code`,
    );
    return new Map(rows.map((r) => [r.id, r.categorie]));
  }

  /**
   * Lignes d'un bloc : les codes du plan pour cette catégorie, PLUS tout code effectivement
   * mouvementé qui n'y figurerait pas (un frais du devis ventilé sur un poste d'une autre
   * famille, par exemple). Un montant qui existe doit toujours porter un nom.
   */
  private async lignesParCode(
    em: EntityManager,
    codesDuPlan: Array<{ id: string; code: string; label: string }>,
    valeurs: Map<string, Record<string, Decimal>>,
  ) {
    const connus = new Set(codesDuPlan.map((c) => c.id));
    const manquants = [...valeurs.keys()].filter((id) => !connus.has(id));
    const complement: Array<{ id: string; code: string; label: string }> = manquants.length
      ? await em.query(
        `SELECT id, code, label FROM analytical_code WHERE id = ANY($1::uuid[]) ORDER BY code`,
        [manquants],
      )
      : [];
    return [...codesDuPlan, ...complement]
      .map((c) => ({ ...c, metrics: this.rendu(valeurs.get(c.id)) }))
      .filter((l) => this.porteUneValeur(l.metrics))
      .sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
  }

  /** Mouvements (ou budget initial) agrégés par code, avec la catégorie du code. */
  private parCode(
    em: EntityManager,
    chantierId: string,
    table: 'chantier_budget_movement' | 'chantier_budget_initial',
  ): Promise<LigneParCode[]> {
    return em.query(
      `SELECT b.code_analytique_id AS code_id, b.nature,
              COALESCE(c.categorie,
                       CASE WHEN b.nature = 'produit' THEN 'produit'
                            WHEN b.nature = 'frais_generaux' THEN 'frais_generaux'
                            ELSE 'charge' END) AS categorie,
              SUM(b.montant)::numeric(16,2) AS montant
         FROM ${table} b
         LEFT JOIN analytical_code c ON c.id = b.code_analytique_id
        WHERE b.chantier_id = $1
        GROUP BY b.code_analytique_id, b.nature, c.categorie`,
      [chantierId],
    );
  }

  private accumulateur(): Record<string, Decimal> {
    return Object.fromEntries(METRICS.map((m) => [m, new Decimal(0)]));
  }
  private rendu(acc?: Record<string, Decimal>): Record<string, string> {
    return Object.fromEntries(METRICS.map((m) => [m, (acc?.[m] ?? new Decimal(0)).toString()]));
  }
  private porteUneValeur(metrics: Record<string, string>): boolean {
    return METRICS.some((m) => !new Decimal(metrics[m] ?? 0).isZero());
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

      // La RECETTE fait partie de la photo : figer les seules charges donnerait une référence
      // sans résultat, et un avenant signé plus tard réécrirait silencieusement la comparaison.
      const [vente] = await em.query(
        `SELECT COALESCE(SUM(m.total_ht), 0)::numeric(16,2) AS marches,
                COALESCE((SELECT SUM(a.total_ht) FROM avenant a
                           JOIN marche mm ON mm.id = a.marche_id
                          WHERE mm.chantier_id = $1 AND a.status <> 'cancelled'), 0)::numeric(16,2) AS avenants
           FROM marche m WHERE m.chantier_id = $1`,
        [chantierId],
      );
      const venteTotale = new Decimal(vente?.marches ?? 0).plus(vente?.avenants ?? 0);
      if (!venteTotale.isZero()) {
        const [codeRecette] = await em.query(
          `SELECT id FROM analytical_code WHERE categorie = 'produit' ORDER BY code LIMIT 1`,
        );
        ajoute(codeRecette?.id ?? null, 'produit', venteTotale);
      }

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
      // Le code choisi peut être un poste de FG ou de recette : sa catégorie l'emporte sur la
      // nature de la ressource, sinon le mouvement se rangerait du mauvais côté du résultat.
      const natures = await this.naturesParCode(em);
      return { codeId, ressourceId: r.id, nature: natures.get(codeId) ?? r.nature ?? 'material' };
    }
    if (!codeAnalytiqueId) {
      throw new BadRequestException('Indiquez une ressource ou un code analytique.');
    }
    const natures = await this.naturesParCode(em);
    const [c] = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [codeAnalytiqueId]);
    if (!c) throw new NotFoundException('Code analytique introuvable.');
    return { codeId: codeAnalytiqueId, ressourceId: null, nature: natures.get(codeAnalytiqueId) ?? 'material' };
  }

  /**
   * Nature d'un mouvement selon son code analytique.
   *
   * La CATÉGORIE prime sur la nature du plan : un poste de recette rangé dans une famille de
   * matériaux reste une recette. Sans cette priorité, un compte prorata saisi en négatif viendrait
   * diminuer le budget MATÉRIAUX du chantier — le contrôle de gestion mentirait de bout en bout.
   */
  private async naturesParCode(em: EntityManager): Promise<Map<string, string>> {
    const rows: Array<{ id: string; nature: string; categorie: string }> = await em.query(
      `SELECT c.id, COALESCE(c.nature, f.nature, l.nature, 'material') AS nature,
              COALESCE(c.categorie, 'charge') AS categorie
         FROM analytical_code c
         LEFT JOIN analytical_famille f ON f.id = c.famille_id
         LEFT JOIN analytical_lot l ON l.id = f.lot_id`,
    );
    return new Map(rows.map((r) => [r.id, natureDeCategorie(r.categorie, r.nature)]));
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

/** Une catégorie hors charges impose sa propre « nature » de mouvement. */
function natureDeCategorie(categorie: string, natureDuPlan: string): string {
  if (categorie === 'produit') return 'produit';
  if (categorie === 'frais_generaux') return 'frais_generaux';
  return natureDuPlan;
}

interface Cible {
  codeId: string | null;
  ressourceId: string | null;
  nature: string;
}
