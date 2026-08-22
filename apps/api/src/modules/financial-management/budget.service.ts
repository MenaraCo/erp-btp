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

/**
 * Les moments qu'une photo de budget peut immortaliser. Ce ne sont pas des états successifs d'un
 * même objet mais trois références qui coexistent : on compare volontiers l'exécution du moment
 * au budget d'étude ET à la contre-étude, pour voir ce que chaque étape a coûté ou rapporté.
 */
export const NIVEAUX_BUDGET = {
  etude: 'Budget d’étude',
  contre_etude: 'Budget de contre-étude',
  execution: 'Budget d’exécution',
} as const;
export type NiveauBudget = keyof typeof NIVEAUX_BUDGET;

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
  async tableau(chantierId: string, baselineId?: string | null) {
    const tenantId = this.context.requireTenantId();
    await this.plan.ensurePlan(tenantId);
    const tree = await this.plan.getTree(tenantId);
    const sections = await this.plan.sections(tenantId);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);

      const etude = await budgetEtude(em, chantierId, 'code');
      const mouvements = await this.parCode(em, chantierId, 'chantier_budget_movement');
      // La colonne de référence est une PHOTO : celle demandée, sinon la dernière figée. Comparer
      // à « la dernière » par défaut est ce qu'on veut neuf fois sur dix ; comparer à celle du
      // départ reste possible d'un clic, et c'est tout l'intérêt de les garder toutes.
      const [reference] = await em.query(
        `SELECT id, niveau, version, fixed_at, commentaire FROM chantier_budget_baseline
          WHERE chantier_id = $1 AND ($2::uuid IS NULL OR id = $2)
          ORDER BY fixed_at DESC LIMIT 1`,
        [chantierId, baselineId ?? null],
      );
      const initial: LigneParCode[] = reference
        ? await em.query(
          `SELECT l.code_analytique_id AS code_id, l.nature,
                  COALESCE(c.categorie,
                           CASE WHEN l.nature = 'produit' THEN 'produit'
                                WHEN l.nature = 'frais_generaux' THEN 'frais_generaux'
                                ELSE 'charge' END) AS categorie,
                  SUM(l.montant)::numeric(16,2) AS montant
             FROM chantier_budget_baseline_line l
             LEFT JOIN analytical_code c ON c.id = l.code_analytique_id
            WHERE l.baseline_id = $1
            GROUP BY l.code_analytique_id, l.nature, c.categorie`,
          [reference.id],
        )
        : [];
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
      // Un code sans famille n'apparaît dans aucune branche de l'arbre : il tomberait dans
      // « à ventiler » alors qu'il EST ventilé. On le sort à part, sous son propre nom.
      const codesDuPlan = new Set<string>();
      for (const n of tree) {
        for (const l of n.lots) for (const f of l.familles) for (const c of f.codes) codesDuPlan.add(c.id);
      }
      const parCodeHorsPlan = new Map<string, Record<string, Decimal>>();
      const pousseCharge = (bucket: string, metriques: Array<'etude' | 'mouvements' | 'global' | 'initial'>, montant: Decimal) => {
        if (!bucket.startsWith(UNALLOC_PREFIX) && !codesDuPlan.has(bucket)) {
          const acc = parCodeHorsPlan.get(bucket) ?? this.accumulateur();
          for (const m of metriques) acc[m] = acc[m].plus(montant);
          parCodeHorsPlan.set(bucket, acc);
          return;
        }
        const metrics: Metrics = {};
        for (const m of metriques) metrics[m] = montant.toString();
        rows.push(this.bucketRow(bucket, metrics));
      };

      for (const [bucket, montant] of etude.parBucket) {
        pousseCharge(bucket, ['etude', 'global'], montant);
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
          pousseCharge(bucket, ['etude', 'global'], montant);
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
        if (ligne.code_id) {
          pousseCharge(ligne.code_id, metriques, montant);
          return;
        }
        const metrics: Metrics = {};
        for (const m of metriques) metrics[m] = ligne.montant;
        rows.push({ codeId: null, nature: ligne.nature as MeasureRow['nature'], metrics });
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
      const lignesHorsPlan = await this.lignesParCode(em, [], parCodeHorsPlan);

      /* ── Totaux et résultats ── */
      const totalCharges: Record<string, string> = {};
      const resultatBrut: Record<string, string> = {};
      const resultatNet: Record<string, string> = {};
      for (const m of METRICS) {
        const horsPlan = [...parCodeHorsPlan.values()].reduce(
          (t, acc) => t.plus(acc[m] ?? 0), new Decimal(0),
        );
        const charges = new Decimal(aggregate.total[m] ?? 0).plus(horsPlan);
        totalCharges[m] = charges.toString();
        const brut = produits[m].minus(charges);
        resultatBrut[m] = brut.toString();
        resultatNet[m] = brut.minus(fg[m]).toString();
      }

      return {
        chantierId,
        fixedAt: reference?.fixed_at ?? null,
        reference: reference
          ? {
            id: reference.id, niveau: reference.niveau, version: reference.version,
            fixedAt: reference.fixed_at, commentaire: reference.commentaire,
            label: `${NIVEAUX_BUDGET[reference.niveau as NiveauBudget] ?? reference.niveau} v${reference.version}`,
          }
          : null,
        charges: {
          label: 'Charges',
          natures: aggregate.natures,
          aVentiler: aggregate.aVentiler,
          /** Postes réellement imputés mais absents de l'arbre : codes sans famille. */
          horsPlan: lignesHorsPlan,
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
    table: 'chantier_budget_movement',
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
        WHERE b.chantier_id = $1 AND b.statut = 'traite'
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
          WHERE chantier_id = $1 AND statut = 'traite' AND nomenclature_resource_id IS NOT NULL
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
  figerBudget(chantierId: string, niveau: NiveauBudget, commentaire?: string | null) {
    if (!NIVEAUX_BUDGET[niveau]) {
      throw new BadRequestException(`Niveau de budget inconnu : ${niveau}`);
    }
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const etude = await budgetEtude(em, chantierId, 'code');
      const mouvements: Array<{ code_id: string | null; nature: string; montant: string }> =
        await em.query(
          `SELECT code_analytique_id AS code_id, nature, SUM(montant)::numeric(16,2) AS montant
             FROM chantier_budget_movement
            WHERE chantier_id = $1 AND statut = 'traite'
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

      // Une nouvelle VERSION, jamais un écrasement : la photo précédente reste consultable, et
      // l'on peut toujours dire ce qu'on visait au départ.
      const [{ version }] = await em.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM chantier_budget_baseline
          WHERE chantier_id = $1 AND niveau = $2`,
        [chantierId, niveau],
      );
      const categories = await this.categoriesParCode(em);
      const totaux = { charge: new Decimal(0), frais_generaux: new Decimal(0), produit: new Decimal(0) };
      const blocDe = (codeId: string | null, nature: string): keyof typeof totaux => {
        if (codeId) return (categories.get(codeId) ?? 'charge') as keyof typeof totaux;
        if (nature === 'produit') return 'produit';
        if (nature === 'site_overhead' || nature === 'frais_generaux') return 'frais_generaux';
        return 'charge';
      };
      for (const e of cumul.values()) totaux[blocDe(e.codeId, e.nature)] = totaux[blocDe(e.codeId, e.nature)].plus(e.montant);
      const resultatNet = totaux.produit.minus(totaux.charge).minus(totaux.frais_generaux);

      const [baseline] = await em.query(
        `INSERT INTO chantier_budget_baseline
           (tenant_id, chantier_id, niveau, version, commentaire,
            total_charges, total_frais_generaux, total_produits, resultat_net, actor_user_id)
         VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, niveau, version, fixed_at`,
        [
          chantierId, niveau, version, commentaire ?? null,
          totaux.charge.toFixed(2), totaux.frais_generaux.toFixed(2),
          totaux.produit.toFixed(2), resultatNet.toFixed(2), userId,
        ],
      );
      for (const e of cumul.values()) {
        if (e.montant.isZero()) continue;
        await em.query(
          `INSERT INTO chantier_budget_baseline_line
             (tenant_id, baseline_id, code_analytique_id, nature, montant)
           VALUES (current_tenant(), $1, $2, $3, $4)`,
          [baseline.id, e.codeId, e.nature, e.montant.toFixed(2)],
        );
      }
      return {
        id: baseline.id, niveau: baseline.niveau, version: baseline.version,
        fixedAt: baseline.fixed_at, lignes: cumul.size, resultatNet: resultatNet.toFixed(2),
      };
    });
  }

  /** Toutes les photos du chantier, la plus récente en tête ; la dernière d'un niveau fait référence. */
  baselines(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const rows = await em.query(
        `SELECT b.id, b.niveau, b.version, b.commentaire, b.fixed_at,
                b.total_charges::numeric(16,2) AS total_charges,
                b.total_frais_generaux::numeric(16,2) AS total_frais_generaux,
                b.total_produits::numeric(16,2) AS total_produits,
                b.resultat_net::numeric(16,2) AS resultat_net,
                COALESCE(u.full_name, u.email) AS auteur,
                (b.version = MAX(b.version) OVER (PARTITION BY b.niveau)) AS en_vigueur
           FROM chantier_budget_baseline b
           LEFT JOIN user_account u ON u.id = b.actor_user_id
          WHERE b.chantier_id = $1
          ORDER BY b.fixed_at DESC`,
        [chantierId],
      );
      return rows.map((r: { niveau: string }) => ({
        ...r,
        niveauLabel: NIVEAUX_BUDGET[r.niveau as NiveauBudget] ?? r.niveau,
      }));
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
          WHERE m.chantier_id = $1 AND m.statut = 'traite'
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

  /* ─────────── bons de budget (à traiter) ─────────── */

  /**
   * Les bons de budget : ce qui attend une décision.
   *
   * Un bon repris du devis arrive avec ses montants mais SANS poste analytique et sans signe
   * arrêté — c'est au conducteur de dire si ce compte prorata est une dépense de plus ou une
   * recette de moins. Tant qu'une ligne n'est pas traitée, elle ne pèse sur aucun total.
   */
  bons(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const documents = await em.query(
        `SELECT d.id, d.numero, d.date::text AS date, d.libelle, d.source, d.statut,
                d.created_at, d.traite_at, m.code AS marche_code
           FROM chantier_budget_document d
           LEFT JOIN marche m ON m.id = d.marche_id
          WHERE d.chantier_id = $1
          ORDER BY (d.statut = 'a_traiter') DESC, d.created_at DESC`,
        [chantierId],
      );
      if (documents.length === 0) return [];
      const lignes = await em.query(
        `SELECT b.id, b.document_id, b.libelle, b.montant::numeric(16,2) AS montant,
                b.quantite::numeric(16,3) AS quantite, b.nature, b.statut, b.accepte,
                b.code_analytique_id, c.code AS code_analytique, c.label AS code_label,
                COALESCE(c.categorie, 'charge') AS categorie
           FROM chantier_budget_movement b
           LEFT JOIN analytical_code c ON c.id = b.code_analytique_id
          WHERE b.document_id = ANY($1::uuid[])
          ORDER BY b.created_at ASC`,
        [documents.map((d: { id: string }) => d.id)],
      );
      return documents.map((d: { id: string }) => ({
        ...d,
        lignes: lignes.filter((l: { document_id: string }) => l.document_id === d.id),
      }));
    });
  }

  /** Règle une ligne en attente : son poste, son libellé, son montant (signé), sa quantité. */
  majLigneBon(
    chantierId: string,
    ligneId: string,
    input: { codeAnalytiqueId?: string | null; libelle?: string; montant?: string | number; quantite?: string | number },
  ) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ligne = await this.ligneEnAttente(em, chantierId, ligneId);
      let nature = ligne.nature as string;
      if (input.codeAnalytiqueId !== undefined && input.codeAnalytiqueId !== null) {
        const natures = await this.naturesParCode(em);
        if (!natures.has(input.codeAnalytiqueId)) {
          throw new NotFoundException('Code analytique introuvable.');
        }
        nature = natures.get(input.codeAnalytiqueId)!;
      }
      await em.query(
        `UPDATE chantier_budget_movement
            SET code_analytique_id = COALESCE($2, code_analytique_id),
                libelle = COALESCE($3, libelle),
                montant = COALESCE($4, montant),
                quantite = COALESCE($5, quantite),
                nature = $6
          WHERE id = $1`,
        [
          ligneId, input.codeAnalytiqueId ?? null, input.libelle ?? null,
          input.montant != null ? String(input.montant) : null,
          input.quantite != null ? String(input.quantite) : null,
          nature,
        ],
      );
      return { maj: true };
    });
  }

  /** Accepte (ou remet en attente) une ligne : c'est le geste qui la présente au traitement. */
  accepterLigneBon(chantierId: string, ligneId: string, accepte: boolean) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.ligneEnAttente(em, chantierId, ligneId);
      await em.query(`UPDATE chantier_budget_movement SET accepte = $2 WHERE id = $1`, [
        ligneId, accepte,
      ]);
      return { accepte };
    });
  }

  /** Retire une ligne d'un bon : tout ce qui arrive du devis n'est pas forcément à budgéter. */
  supprimerLigneBon(chantierId: string, ligneId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.ligneEnAttente(em, chantierId, ligneId);
      await em.query(`DELETE FROM chantier_budget_movement WHERE id = $1`, [ligneId]);
      return { supprime: true };
    });
  }

  /**
   * Traite un bon : les lignes ACCEPTÉES et correctement renseignées deviennent du budget.
   *
   * Les autres restent en attente et sont rendues à l'appelant comme ANOMALIES, à la manière de
   * l'écran de contrôle du guide (§5.11) : un traitement muet laisserait croire que tout est passé.
   */
  traiterBon(chantierId: string, documentId: string) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [doc] = await em.query(
        `SELECT id, statut FROM chantier_budget_document WHERE id = $1 AND chantier_id = $2`,
        [documentId, chantierId],
      );
      if (!doc) throw new NotFoundException('Bon de budget introuvable.');
      if (doc.statut === 'traite') throw new BadRequestException('Ce bon est déjà traité.');

      const lignes = await em.query(
        `SELECT id, libelle, montant, accepte, code_analytique_id
           FROM chantier_budget_movement
          WHERE document_id = $1 AND statut = 'a_traiter'`,
        [documentId],
      );
      const anomalies: Array<{ ligne: string; raison: string }> = [];
      const aTraiter: string[] = [];
      for (const l of lignes) {
        if (!l.accepte) {
          anomalies.push({ ligne: l.libelle, raison: 'Ligne non acceptée : elle reste en attente.' });
          continue;
        }
        if (!l.code_analytique_id) {
          anomalies.push({ ligne: l.libelle, raison: 'Aucun poste analytique : impossible de la budgéter.' });
          continue;
        }
        if (new Decimal(l.montant ?? 0).isZero()) {
          anomalies.push({ ligne: l.libelle, raison: 'Montant nul : rien à budgéter.' });
          continue;
        }
        aTraiter.push(l.id);
      }
      if (aTraiter.length > 0) {
        await em.query(
          `UPDATE chantier_budget_movement SET statut = 'traite' WHERE id = ANY($1::uuid[])`,
          [aTraiter],
        );
      }
      const [reste] = await em.query(
        `SELECT count(*)::int AS n FROM chantier_budget_movement
          WHERE document_id = $1 AND statut = 'a_traiter'`,
        [documentId],
      );
      if (reste.n === 0) {
        await em.query(
          `UPDATE chantier_budget_document
              SET statut = 'traite', traite_at = now(), actor_user_id = COALESCE(actor_user_id, $2)
            WHERE id = $1`,
          [documentId, userId],
        );
      }
      return { traitees: aTraiter.length, enAttente: reste.n, anomalies };
    });
  }

  private async ligneEnAttente(em: EntityManager, chantierId: string, ligneId: string) {
    const [ligne] = await em.query(
      `SELECT id, nature, statut FROM chantier_budget_movement
        WHERE id = $1 AND chantier_id = $2`,
      [ligneId, chantierId],
    );
    if (!ligne) throw new NotFoundException('Ligne de budget introuvable.');
    if (ligne.statut !== 'a_traiter') {
      throw new BadRequestException(
        'Cette ligne est déjà traitée : elle se corrige par un mouvement de budget, pas en la réécrivant.',
      );
    }
    return ligne as { id: string; nature: string; statut: string };
  }

  /* ─────────── interne ─────────── */

  /** Budget global disponible sur la source d'un ripage (étude + mouvements déjà passés). */
  private async budgetDisponible(em: EntityManager, chantierId: string, cible: Cible): Promise<Decimal> {
    if (cible.ressourceId) {
      const etude = await budgetEtude(em, chantierId, 'ressource');
      const [m] = await em.query(
        `SELECT COALESCE(SUM(montant), 0)::numeric(16,2) AS montant
           FROM chantier_budget_movement
          WHERE chantier_id = $1 AND statut = 'traite' AND nomenclature_resource_id = $2`,
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
        WHERE chantier_id = $1 AND statut = 'traite' AND code_analytique_id = $2`,
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
