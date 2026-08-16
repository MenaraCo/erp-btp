import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface FiltreAppro {
  supplierId?: string | null;
  lotId?: string | null;
  familleId?: string | null;
  codeAnalytiqueId?: string | null;
  nature?: string | null;
  /** Ne proposer que ce qui reste à commander — le cas courant en cours de chantier. */
  resteSeulement?: boolean;
}

export interface SuggestionAppro {
  resourceId: string;
  code: string;
  label: string;
  nature: string;
  unite: string | null;
  uniteAchat: string | null;
  coeffConversion: string;
  puDebourse: string;
  puAchat: string;
  supplierId: string | null;
  fournisseur: string | null;
  refFournisseur: string | null;
  codeAnalytiqueId: string | null;
  codeAnalytique: string | null;
  familleId: string | null;
  famille: string | null;
  lotId: string | null;
  lot: string | null;
  executionLineId: string | null;
  ouvrage: string | null;
  /** Quantités en unité d'EMPLOI (celle du budget). */
  quantiteBudget: string;
  quantiteAvancement: string;
  quantiteCommandee: string;
  quantiteRestante: string;
}

type ModeQuantite = 'total' | 'avancement' | 'reste';

/**
 * Approvisionnement d'un chantier : passer du budget à la commande sans ressaisie.
 *
 * Commander à la main, désignation par désignation, c'est retaper ce que l'étude a déjà chiffré —
 * avec les fautes de frappe, les unités confondues (le sac et la tonne) et, surtout, aucune idée
 * de ce qui reste à commander. Ici, chaque ligne part de la ressource du chantier : on connaît sa
 * quantité budgétée, ce qui a déjà été commandé, et donc le CRÉDIT restant.
 *
 * Les regroupements (fournisseur, lot, famille) répondent au geste réel : on ne commande pas « une
 * ressource », on commande « tout ce qu'il faut chez ce fournisseur » ou « le lot peinture ».
 */
@Injectable()
export class ApprovisionnementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Ce qu'il reste à approvisionner sur un chantier, ressource par ressource. */
  suggestions(chantierId: string, filtre: FiltreAppro = {}) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const lignes = await this.lire(em, chantierId, filtre);
      return {
        chantierId,
        lignes,
        totaux: {
          budget: somme(lignes.map((l) => new Decimal(l.quantiteBudget).times(l.puAchat === '0' ? 0 : 1))),
          resteMontant: somme(lignes.map((l) =>
            new Decimal(l.quantiteRestante).dividedBy(l.coeffConversion).times(l.puAchat))),
        },
      };
    });
  }

  /**
   * Insère dans une commande les ressources choisies, converties en unité d'ACHAT.
   *
   * `mode` décide de la quantité : tout le budget, la part débloquée par l'avancement, ou le reste
   * à commander. Un mode n'est jamais deviné — approvisionner tout un chantier le premier jour ou
   * suivre l'avancement sont deux politiques d'achat différentes, c'est à l'acheteur de trancher.
   */
  insererDepuisNomenclature(
    orderId: string,
    input: { resourceIds?: string[]; mode?: ModeQuantite; filtre?: FiltreAppro },
  ) {
    const tenantId = this.context.requireTenantId();
    const mode: ModeQuantite = input.mode ?? 'reste';
    if (!['total', 'avancement', 'reste'].includes(mode)) {
      throw new BadRequestException('Mode de quantité inconnu (total, avancement ou reste).');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(
        `SELECT id, chantier_id, status FROM purchase_order WHERE id = $1`, [orderId],
      );
      if (order.length === 0) throw new NotFoundException('Commande introuvable.');
      if (order[0].status !== 'draft') {
        throw new BadRequestException('Seule une commande en brouillon accepte de nouvelles lignes.');
      }

      const choisies = new Set(input.resourceIds ?? []);
      const lignes = (await this.lire(em, order[0].chantier_id, input.filtre ?? {}))
        .filter((l) => choisies.size === 0 || choisies.has(l.resourceId));

      let inserees = 0;
      for (const l of lignes) {
        const quantiteEmploi = mode === 'total' ? new Decimal(l.quantiteBudget)
          : mode === 'avancement' ? new Decimal(l.quantiteAvancement).minus(l.quantiteCommandee)
            : new Decimal(l.quantiteRestante);
        // Une quantité nulle ou négative signifie « déjà couvert » : on ne crée pas de ligne vide.
        if (quantiteEmploi.lessThanOrEqualTo(0)) continue;

        // Passage en unité d'achat : on commande des sacs, pas des kilos.
        const quantiteAchat = quantiteEmploi.dividedBy(l.coeffConversion).toDecimalPlaces(4);
        const puAchat = new Decimal(l.puAchat);
        const montant = quantiteAchat.times(puAchat).toDecimalPlaces(2);

        await em.query(
          `INSERT INTO purchase_order_line
             (tenant_id, order_id, execution_line_id, nature, designation, quantity, unit_price,
              amount_ht, code_analytique_id, nomenclature_resource_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tenantId, orderId, l.executionLineId, l.nature,
            `${l.code} — ${l.label}${l.uniteAchat ? ` (${l.uniteAchat})` : ''}`,
            quantiteAchat.toString(), puAchat.toString(), montant.toString(),
            l.codeAnalytiqueId, l.resourceId],
        );
        inserees += 1;
      }

      await em.query(
        `UPDATE purchase_order
            SET total_ht = (SELECT COALESCE(SUM(amount_ht),0) FROM purchase_order_line WHERE order_id = $1),
                updated_at = now()
          WHERE id = $1`,
        [orderId],
      );
      return { inserees, mode };
    });
  }

  /**
   * Insère des articles de la BIBLIOTHÈQUE GÉNÉRALE du module chantier.
   *
   * À ne pas confondre avec l'approvisionnement depuis la nomenclature : là, on reprend ce qui a
   * été BUDGÉTÉ sur ce chantier, avec ses quantités et son reste à commander. Ici, on pioche dans
   * le catalogue de l'entreprise ce qui n'était pas prévu au budget — un consommable, un article
   * de dernière minute — et la quantité est forcément saisie à la main.
   */
  insererDepuisBibliotheque(
    orderId: string,
    input: { articles?: Array<{ resourceId: string; quantite?: string | number }> },
  ) {
    const tenantId = this.context.requireTenantId();
    const articles = (input.articles ?? []).filter(
      (a) => a.resourceId && new Decimal(a.quantite ?? 0).greaterThan(0),
    );
    if (articles.length === 0) {
      throw new BadRequestException('Choisissez au moins un article et sa quantité.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(
        `SELECT id, status FROM purchase_order WHERE id = $1`, [orderId],
      );
      if (order.length === 0) throw new NotFoundException('Commande introuvable.');
      if (order[0].status !== 'draft') {
        throw new BadRequestException('Seule une commande en brouillon accepte de nouvelles lignes.');
      }

      const ids = articles.map((a) => a.resourceId);
      const rows: Array<Record<string, unknown>> = await em.query(
        `SELECT r.id, r.code, r.label, r.unit, r.nature, r.unit_cost, r.code_analytique_id,
                r.code_produit, r.ref_fournisseur, r.unite_achat,
                COALESCE(r.coeff_conversion, 1) AS coeff_conversion
           FROM resource r
          WHERE r.id = ANY($1::uuid[]) AND r.deleted_at IS NULL`,
        [ids],
      );
      const parId = new Map(rows.map((r) => [r.id as string, r]));

      let inserees = 0;
      for (const a of articles) {
        const r = parId.get(a.resourceId);
        if (!r) continue;
        const coeff = new Decimal(String(r.coeff_conversion ?? 1));
        const quantite = new Decimal(a.quantite ?? 0);
        // Le catalogue chiffre à l'unité d'EMPLOI : le prix d'achat suit le conditionnement.
        const puAchat = new Decimal(String(r.unit_cost ?? 0)).times(coeff).toDecimalPlaces(4);
        const montant = quantite.times(puAchat).toDecimalPlaces(2);
        await em.query(
          `INSERT INTO purchase_order_line
             (tenant_id, order_id, nature, designation, quantity, unit_price, amount_ht,
              code_analytique_id, library_resource_id, ref_fournisseur, unite_achat,
              coeff_conversion, code_produit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [tenantId, orderId, r.nature, `${r.code} — ${r.label}`,
            quantite.toString(), puAchat.toString(), montant.toString(),
            r.code_analytique_id ?? null, r.id, r.ref_fournisseur ?? null,
            (r.unite_achat as string | null) ?? (r.unit as string | null), coeff.toString(),
            r.code_produit ?? null],
        );
        inserees += 1;
      }

      await em.query(
        `UPDATE purchase_order
            SET total_ht = (SELECT COALESCE(SUM(amount_ht),0) FROM purchase_order_line WHERE order_id = $1),
                updated_at = now()
          WHERE id = $1`,
        [orderId],
      );
      return { inserees };
    });
  }

  /** Fournisseurs, lots et familles réellement présents sur le chantier — pour les filtres. */
  regroupements(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const rows = await em.query(
        `SELECT DISTINCT n.supplier_id, s.name AS fournisseur,
                ac.id AS code_id, ac.code AS code_analytique,
                f.id AS famille_id, f.label AS famille,
                lo.id AS lot_id, lo.label AS lot
           FROM nomenclature_resource n
           LEFT JOIN supplier s ON s.id = n.supplier_id
           LEFT JOIN analytical_code ac ON ac.id = n.code_analytique_id
           LEFT JOIN analytical_famille f ON f.id = ac.famille_id
           LEFT JOIN analytical_lot lo ON lo.id = f.lot_id
          WHERE n.chantier_id = $1`,
        [chantierId],
      );
      const uniques = <T extends { id: string }>(liste: T[]) =>
        [...new Map(liste.map((x) => [x.id, x])).values()]
          .sort((a, b) => String((a as { label?: string }).label ?? '')
            .localeCompare(String((b as { label?: string }).label ?? '')));
      return {
        fournisseurs: uniques(rows.filter((r: Record<string, unknown>) => r.supplier_id)
          .map((r: Record<string, unknown>) => ({ id: r.supplier_id as string, label: r.fournisseur as string }))),
        lots: uniques(rows.filter((r: Record<string, unknown>) => r.lot_id)
          .map((r: Record<string, unknown>) => ({ id: r.lot_id as string, label: r.lot as string }))),
        familles: uniques(rows.filter((r: Record<string, unknown>) => r.famille_id)
          .map((r: Record<string, unknown>) => ({ id: r.famille_id as string, label: r.famille as string }))),
        codes: uniques(rows.filter((r: Record<string, unknown>) => r.code_id)
          .map((r: Record<string, unknown>) => ({ id: r.code_id as string, label: r.code_analytique as string }))),
      };
    });
  }

  /**
   * Lecture commune aux suggestions et à l'insertion : mêmes quantités des deux côtés, sinon
   * l'écran promettrait une chose et la commande en écrirait une autre.
   */
  private async lire(
    em: EntityManager,
    chantierId: string,
    filtre: FiltreAppro,
  ): Promise<SuggestionAppro[]> {
    const params: unknown[] = [chantierId];
    const conds: string[] = [];
    if (filtre.supplierId) { params.push(filtre.supplierId); conds.push(`n.supplier_id = $${params.length}`); }
    if (filtre.codeAnalytiqueId) { params.push(filtre.codeAnalytiqueId); conds.push(`n.code_analytique_id = $${params.length}`); }
    if (filtre.familleId) { params.push(filtre.familleId); conds.push(`f.id = $${params.length}`); }
    if (filtre.lotId) { params.push(filtre.lotId); conds.push(`lo.id = $${params.length}`); }
    if (filtre.nature) { params.push(filtre.nature); conds.push(`n.nature = $${params.length}`); }
    const filtres = conds.length ? `AND ${conds.join(' AND ')}` : '';

    const rows: Array<Record<string, unknown>> = await em.query(
      `WITH avancement AS (
         SELECT DISTINCT ON (execution_line_id) execution_line_id, pct
           FROM execution_line_advancement WHERE chantier_id = $1
          ORDER BY execution_line_id, recorded_at DESC
       ),
       besoin AS (
         SELECT ec.nomenclature_resource_id AS resource_id,
                -- Une ressource peut servir dans plusieurs ouvrages : on garde le plus gros
                -- pour l'imputation par défaut, et on somme les quantités.
                (array_agg(el.id ORDER BY ec.quantite_objectif * COALESCE(el.quantite_objectif,0) DESC))[1] AS execution_line_id,
                SUM(ec.quantite_objectif * COALESCE(el.quantite_objectif, 0)) AS qte_budget,
                -- L'avancement est une FRACTION 0..1 (voir advancement.service) : pas de division par 100.
                SUM(ec.quantite_objectif * COALESCE(el.quantite_objectif, 0)
                    * COALESCE(a.pct, 0)) AS qte_avancement
           FROM execution_component ec
           JOIN execution_line el ON el.id = ec.execution_line_id
           LEFT JOIN avancement a ON a.execution_line_id = el.id
          WHERE el.chantier_id = $1 AND ec.kind = 'resource'
            AND ec.nomenclature_resource_id IS NOT NULL
          GROUP BY ec.nomenclature_resource_id
       ),
       commande AS (
         SELECT l.nomenclature_resource_id AS resource_id,
                SUM(l.quantity * COALESCE(n2.coeff_conversion, 1)) AS qte_commandee
           FROM purchase_order_line l
           JOIN purchase_order o ON o.id = l.order_id
           JOIN nomenclature_resource n2 ON n2.id = l.nomenclature_resource_id
          WHERE o.chantier_id = $1 AND o.status <> 'cancelled'
          GROUP BY l.nomenclature_resource_id
       )
       SELECT n.id, n.code, n.label, n.nature, n.unit, n.unite_achat,
              COALESCE(n.coeff_conversion, 1) AS coeff_conversion,
              n.unit_cost_objectif, n.supplier_id, n.ref_fournisseur,
              s.name AS fournisseur,
              n.code_analytique_id, ac.code AS code_analytique,
              f.id AS famille_id, f.label AS famille,
              lo.id AS lot_id, lo.label AS lot,
              b.execution_line_id, el.designation AS ouvrage,
              COALESCE(b.qte_budget, 0) AS qte_budget,
              COALESCE(b.qte_avancement, 0) AS qte_avancement,
              COALESCE(c.qte_commandee, 0) AS qte_commandee
         FROM nomenclature_resource n
         LEFT JOIN besoin b ON b.resource_id = n.id
         LEFT JOIN commande c ON c.resource_id = n.id
         LEFT JOIN execution_line el ON el.id = b.execution_line_id
         LEFT JOIN supplier s ON s.id = n.supplier_id
         LEFT JOIN analytical_code ac ON ac.id = n.code_analytique_id
         LEFT JOIN analytical_famille f ON f.id = ac.famille_id
         LEFT JOIN analytical_lot lo ON lo.id = f.lot_id
        WHERE n.chantier_id = $1 AND n.nature <> 'labor' ${filtres}
        ORDER BY s.name NULLS LAST, lo.label NULLS LAST, f.label NULLS LAST, n.code`,
      params,
    );

    const lignes = rows.map((r) => {
      const coeff = new Decimal(String(r.coeff_conversion ?? 1));
      const budget = new Decimal(String(r.qte_budget ?? 0));
      const commandee = new Decimal(String(r.qte_commandee ?? 0));
      return {
        resourceId: r.id as string,
        code: r.code as string,
        label: r.label as string,
        nature: r.nature as string,
        unite: (r.unit as string | null) ?? null,
        uniteAchat: (r.unite_achat as string | null) ?? null,
        coeffConversion: coeff.toString(),
        puDebourse: new Decimal(String(r.unit_cost_objectif ?? 0)).toString(),
        // PU d'achat = déboursé de l'unité d'emploi × ce que contient l'unité d'achat.
        puAchat: new Decimal(String(r.unit_cost_objectif ?? 0)).times(coeff).toDecimalPlaces(4).toString(),
        supplierId: (r.supplier_id as string | null) ?? null,
        fournisseur: (r.fournisseur as string | null) ?? null,
        refFournisseur: (r.ref_fournisseur as string | null) ?? null,
        codeAnalytiqueId: (r.code_analytique_id as string | null) ?? null,
        codeAnalytique: (r.code_analytique as string | null) ?? null,
        familleId: (r.famille_id as string | null) ?? null,
        famille: (r.famille as string | null) ?? null,
        lotId: (r.lot_id as string | null) ?? null,
        lot: (r.lot as string | null) ?? null,
        executionLineId: (r.execution_line_id as string | null) ?? null,
        ouvrage: (r.ouvrage as string | null) ?? null,
        quantiteBudget: budget.toDecimalPlaces(4).toString(),
        quantiteAvancement: new Decimal(String(r.qte_avancement ?? 0)).toDecimalPlaces(4).toString(),
        quantiteCommandee: commandee.toDecimalPlaces(4).toString(),
        quantiteRestante: Decimal.max(budget.minus(commandee), 0).toDecimalPlaces(4).toString(),
      };
    });

    return filtre.resteSeulement
      ? lignes.filter((l) => new Decimal(l.quantiteRestante).greaterThan(0))
      : lignes;
  }

  private async assertChantier(em: EntityManager, chantierId: string): Promise<void> {
    const rows = await em.query(
      `SELECT id FROM chantier WHERE id = $1 AND deleted_at IS NULL`, [chantierId],
    );
    if (rows.length === 0) throw new NotFoundException(`Chantier introuvable (${chantierId}).`);
  }
}

function somme(valeurs: Decimal[]): string {
  return valeurs.reduce((a, b) => a.plus(b), new Decimal(0)).toDecimalPlaces(2).toString();
}
