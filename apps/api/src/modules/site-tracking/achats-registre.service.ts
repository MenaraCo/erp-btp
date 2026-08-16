import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface FiltreRegistre {
  /** Recherche libre : numéro de pièce, fournisseur, chantier. */
  q?: string | null;
  chantierId?: string | null;
  supplierId?: string | null;
  statut?: string | null;
  du?: string | null;
  au?: string | null;
  montantMin?: string | number | null;
  montantMax?: string | number | null;
  page?: number;
  parPage?: number;
}

/** Au-delà, la page devient illisible et la requête coûteuse ; en deçà, on pagine pour rien. */
const PAR_PAGE_DEFAUT = 25;
const PAR_PAGE_MAX = 200;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Registre des achats — la vue d'ENTREPRISE, tous chantiers confondus.
 *
 * L'écran par chantier montrait chaque commande dépliée avec ses lignes : lisible à trois
 * commandes, illisible à cinquante. Une commande passée ne se relit pas, elle se RETROUVE — par
 * son numéro, son fournisseur, sa période ou son montant. D'où ce registre paginé, où la commande
 * n'est qu'une ligne, et où le détail s'ouvre sur sa propre page.
 */
@Injectable()
export class AchatsRegistreService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Bons de commande de toute la société, filtrés et paginés. */
  commandes(filtre: FiltreRegistre) {
    const tenantId = this.context.requireTenantId();
    const { limit, offset, page } = this.pagination(filtre);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [];
      const conds: string[] = ['1 = 1'];
      this.commun(filtre, params, conds, 'o');
      if (filtre.statut) { params.push(filtre.statut); conds.push(`o.status = $${params.length}`); }
      const where = `WHERE ${conds.join(' AND ')}`;

      const base = `
        FROM purchase_order o
        LEFT JOIN supplier s ON s.id = o.supplier_id
        LEFT JOIN chantier c ON c.id = o.chantier_id
        ${where}`;

      const total = Number((await em.query(`SELECT COUNT(*)::int AS n ${base}`, params))[0]?.n ?? 0);
      const montant = (await em.query(
        `SELECT COALESCE(SUM(o.total_ht), 0)::numeric(16,2) AS m ${base}`, params,
      ))[0]?.m ?? '0.00';

      const lignes = await em.query(
        `SELECT o.id, o.code, o.status, o.total_ht, o.validated_at, o.created_at,
                o.chantier_id, c.code AS chantier_code, c.name AS chantier_nom, c.color AS chantier_couleur,
                o.supplier_id, s.name AS fournisseur,
                (SELECT COUNT(*)::int FROM purchase_order_line l WHERE l.order_id = o.id) AS nb_lignes,
                (SELECT COUNT(*)::int FROM delivery_note d WHERE d.order_id = o.id) AS nb_receptions,
                (SELECT COUNT(*)::int FROM supplier_invoice f WHERE f.order_id = o.id) AS nb_factures
         ${base}
         ORDER BY COALESCE(o.validated_at, o.created_at) DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );

      return {
        lignes: lignes.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          code: r.code as string,
          statut: r.status as string,
          totalHt: String(r.total_ht ?? '0.00'),
          valideLe: r.validated_at ? String(r.validated_at) : null,
          creeLe: String(r.created_at),
          chantierId: r.chantier_id as string,
          chantierCode: (r.chantier_code as string | null) ?? null,
          chantierNom: (r.chantier_nom as string | null) ?? null,
          chantierCouleur: (r.chantier_couleur as string | null) ?? null,
          supplierId: (r.supplier_id as string | null) ?? null,
          fournisseur: (r.fournisseur as string | null) ?? null,
          nbLignes: Number(r.nb_lignes ?? 0),
          nbReceptions: Number(r.nb_receptions ?? 0),
          nbFactures: Number(r.nb_factures ?? 0),
        })),
        total,
        montantTotal: String(montant),
        page,
        parPage: limit,
      };
    });
  }

  /**
   * Réceptions, REGROUPÉES PAR COMMANDE.
   *
   * Une même commande reçoit trois ou quatre livraisons ; à cinquante commandes, la liste à plat
   * des bons noyait la question qu'on se pose vraiment : cette commande, est-elle arrivée ? On
   * pagine donc sur les COMMANDES, et les bons de livraison se déplient dessous.
   */
  receptions(filtre: FiltreRegistre) {
    const tenantId = this.context.requireTenantId();
    const { limit, offset, page } = this.pagination(filtre);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [];
      const conds: string[] = ['1 = 1'];
      if (filtre.q) {
        params.push(`%${filtre.q.trim()}%`);
        conds.push(`(d.code ILIKE $${params.length} OR o.code ILIKE $${params.length}
                     OR s.name ILIKE $${params.length} OR c.code ILIKE $${params.length}
                     OR c.name ILIKE $${params.length})`);
      }
      if (filtre.chantierId) { params.push(filtre.chantierId); conds.push(`o.chantier_id = $${params.length}`); }
      if (filtre.supplierId) { params.push(filtre.supplierId); conds.push(`o.supplier_id = $${params.length}`); }
      if (filtre.du && ISO.test(filtre.du)) { params.push(filtre.du); conds.push(`d.received_at >= $${params.length}`); }
      if (filtre.au && ISO.test(filtre.au)) { params.push(filtre.au); conds.push(`d.received_at <= $${params.length}`); }

      // Un bon de livraison ne porte pas de prix : on le valorise au prix de la commande.
      const source = `
        WITH bl AS (
          SELECT d.id, d.code, d.received_at, d.created_at, d.order_id,
                 (SELECT COUNT(*)::int FROM delivery_note_line x WHERE x.delivery_note_id = d.id)
                   AS nb_lignes,
                 COALESCE((SELECT SUM(x.quantite_livree * pl.unit_price)
                             FROM delivery_note_line x
                             JOIN purchase_order_line pl ON pl.id = x.order_line_id
                            WHERE x.delivery_note_id = d.id), 0)::numeric(16,2) AS montant
            FROM delivery_note d
            JOIN purchase_order o ON o.id = d.order_id
            LEFT JOIN supplier s ON s.id = o.supplier_id
            LEFT JOIN chantier c ON c.id = o.chantier_id
           WHERE ${conds.join(' AND ')}
        )`;

      const entete = (await em.query(
        `${source}
         SELECT COUNT(DISTINCT bl.order_id)::int AS commandes,
                COUNT(*)::int AS bons,
                COALESCE(SUM(bl.montant), 0)::numeric(16,2) AS montant
           FROM bl`,
        params,
      ))[0] ?? { commandes: 0, bons: 0, montant: '0.00' };

      const lignes = await em.query(
        `${source}
         SELECT o.id AS order_id, o.code AS commande, o.status, o.total_ht,
                o.chantier_id, c.code AS chantier_code, c.name AS chantier_nom,
                c.color AS chantier_couleur, o.supplier_id, s.name AS fournisseur,
                COUNT(bl.id)::int AS nb_bl,
                MAX(COALESCE(bl.received_at, bl.created_at::date))::text AS derniere_reception,
                COALESCE(SUM(bl.montant), 0)::numeric(16,2) AS montant_recu,
                NOT EXISTS (
                  SELECT 1 FROM purchase_order_line pl
                   WHERE pl.order_id = o.id AND pl.kind <> 'comment'
                     AND pl.quantity > COALESCE((SELECT SUM(dl.quantite_livree)
                                                   FROM delivery_note_line dl
                                                  WHERE dl.order_line_id = pl.id), 0)
                ) AS reception_complete,
                json_agg(json_build_object(
                  'id', bl.id, 'code', bl.code,
                  'recuLe', COALESCE(bl.received_at::text, bl.created_at::date::text),
                  'nbLignes', bl.nb_lignes, 'montant', bl.montant
                ) ORDER BY COALESCE(bl.received_at, bl.created_at::date) DESC, bl.code DESC) AS bons
           FROM bl
           JOIN purchase_order o ON o.id = bl.order_id
           LEFT JOIN supplier s ON s.id = o.supplier_id
           LEFT JOIN chantier c ON c.id = o.chantier_id
          GROUP BY o.id, o.code, o.status, o.total_ht, o.chantier_id,
                   c.code, c.name, c.color, o.supplier_id, s.name
          ORDER BY MAX(COALESCE(bl.received_at, bl.created_at::date)) DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );

      return {
        lignes: lignes.map((r: Record<string, unknown>) => ({
          orderId: r.order_id as string,
          commande: r.commande as string,
          statut: r.status as string,
          totalHt: String(r.total_ht ?? '0.00'),
          chantierId: r.chantier_id as string,
          chantierCode: (r.chantier_code as string | null) ?? null,
          chantierNom: (r.chantier_nom as string | null) ?? null,
          chantierCouleur: (r.chantier_couleur as string | null) ?? null,
          supplierId: (r.supplier_id as string | null) ?? null,
          fournisseur: (r.fournisseur as string | null) ?? null,
          nbBl: Number(r.nb_bl ?? 0),
          derniereReception: (r.derniere_reception as string | null) ?? null,
          montantRecu: String(r.montant_recu ?? '0.00'),
          // Soldée ou non : l'état se DÉDUIT des quantités, il n'est jamais stocké.
          etat: r.reception_complete ? 'complete' : 'partielle',
          bons: (r.bons as Array<Record<string, unknown>>) ?? [],
        })),
        total: Number(entete.commandes ?? 0),
        totalBons: Number(entete.bons ?? 0),
        montantTotal: String(entete.montant ?? '0.00'),
        page,
        parPage: limit,
      };
    });
  }

  /**
   * Factures fournisseur, REGROUPÉES PAR COMMANDE — même raison que les réceptions.
   *
   * Une facture sans commande (saisie directe sur un chantier) n'a pas de bon de commande où se
   * ranger : elle se regroupe alors par chantier, sous un intitulé qui le dit. Rien ne disparaît
   * du registre au prétexte qu'il manque un rattachement.
   */
  factures(filtre: FiltreRegistre) {
    const tenantId = this.context.requireTenantId();
    const { limit, offset, page } = this.pagination(filtre);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [];
      const conds: string[] = ['1 = 1'];
      if (filtre.q) {
        params.push(`%${filtre.q.trim()}%`);
        conds.push(`(f.code ILIKE $${params.length} OR o.code ILIKE $${params.length}
                     OR s.name ILIKE $${params.length} OR c.code ILIKE $${params.length}
                     OR c.name ILIKE $${params.length})`);
      }
      if (filtre.chantierId) { params.push(filtre.chantierId); conds.push(`f.chantier_id = $${params.length}`); }
      if (filtre.supplierId) { params.push(filtre.supplierId); conds.push(`o.supplier_id = $${params.length}`); }
      if (filtre.du && ISO.test(filtre.du)) { params.push(filtre.du); conds.push(`f.invoice_date >= $${params.length}`); }
      if (filtre.au && ISO.test(filtre.au)) { params.push(filtre.au); conds.push(`f.invoice_date <= $${params.length}`); }
      if (filtre.montantMin != null && filtre.montantMin !== '') {
        params.push(filtre.montantMin); conds.push(`f.amount_ht >= $${params.length}`);
      }
      if (filtre.montantMax != null && filtre.montantMax !== '') {
        params.push(filtre.montantMax); conds.push(`f.amount_ht <= $${params.length}`);
      }

      // La jointure du code analytique fait partie de la BASE : la placer après le WHERE
      // produisait un SQL invalide, et l'écran restait vide sans dire pourquoi.
      const source = `
        WITH fact AS (
          SELECT f.id, f.code, f.amount_ht, f.invoice_date, f.created_at, f.nature,
                 f.order_id, f.chantier_id, ac.code AS code_analytique
            FROM supplier_invoice f
            LEFT JOIN purchase_order o ON o.id = f.order_id
            LEFT JOIN supplier s ON s.id = o.supplier_id
            LEFT JOIN chantier c ON c.id = f.chantier_id
            LEFT JOIN analytical_code ac ON ac.id = f.code_analytique_id
           WHERE ${conds.join(' AND ')}
        )`;
      const cle = `COALESCE(fact.order_id::text, 'hors-commande:' || fact.chantier_id::text)`;

      const entete = (await em.query(
        `${source}
         SELECT COUNT(DISTINCT ${cle})::int AS groupes,
                COUNT(*)::int AS pieces,
                COALESCE(SUM(fact.amount_ht), 0)::numeric(16,2) AS montant
           FROM fact`,
        params,
      ))[0] ?? { groupes: 0, pieces: 0, montant: '0.00' };

      const lignes = await em.query(
        `${source}
         SELECT ${cle} AS cle,
                MAX(o.id::text) AS order_id, MAX(o.code) AS commande,
                MAX(o.total_ht)::numeric(16,2) AS total_commande,
                MAX(fact.chantier_id::text) AS chantier_id,
                MAX(c.code) AS chantier_code, MAX(c.name) AS chantier_nom,
                MAX(c.color) AS chantier_couleur, MAX(s.name) AS fournisseur,
                COUNT(*)::int AS nb_factures,
                COALESCE(SUM(fact.amount_ht), 0)::numeric(16,2) AS montant_facture,
                MAX(COALESCE(fact.invoice_date, fact.created_at::date))::text AS derniere_facture,
                json_agg(json_build_object(
                  'id', fact.id, 'code', fact.code, 'montantHt', fact.amount_ht,
                  'date', COALESCE(fact.invoice_date::text, fact.created_at::date::text),
                  'nature', fact.nature, 'codeAnalytique', fact.code_analytique
                ) ORDER BY COALESCE(fact.invoice_date, fact.created_at::date) DESC, fact.code DESC)
                  AS factures
           FROM fact
           LEFT JOIN purchase_order o ON o.id = fact.order_id
           LEFT JOIN supplier s ON s.id = o.supplier_id
           LEFT JOIN chantier c ON c.id = fact.chantier_id
          GROUP BY ${cle}
          ORDER BY MAX(COALESCE(fact.invoice_date, fact.created_at::date)) DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );

      return {
        lignes: lignes.map((r: Record<string, unknown>) => ({
          cle: r.cle as string,
          orderId: (r.order_id as string | null) ?? null,
          commande: (r.commande as string | null) ?? null,
          totalCommande: r.total_commande != null ? String(r.total_commande) : null,
          chantierId: (r.chantier_id as string | null) ?? null,
          chantierCode: (r.chantier_code as string | null) ?? null,
          chantierNom: (r.chantier_nom as string | null) ?? null,
          chantierCouleur: (r.chantier_couleur as string | null) ?? null,
          fournisseur: (r.fournisseur as string | null) ?? null,
          nbFactures: Number(r.nb_factures ?? 0),
          montantFacture: String(r.montant_facture ?? '0.00'),
          derniereFacture: (r.derniere_facture as string | null) ?? null,
          factures: (r.factures as Array<Record<string, unknown>>) ?? [],
        })),
        total: Number(entete.groupes ?? 0),
        totalPieces: Number(entete.pieces ?? 0),
        montantTotal: String(entete.montant ?? '0.00'),
        page,
        parPage: limit,
      };
    });
  }

  /** Filtres partagés par les registres qui portent sur une commande. */
  private commun(
    filtre: FiltreRegistre,
    params: unknown[],
    conds: string[],
    alias: string,
  ): void {
    if (filtre.q) {
      params.push(`%${filtre.q.trim()}%`);
      conds.push(`(${alias}.code ILIKE $${params.length} OR s.name ILIKE $${params.length}
                   OR c.code ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    if (filtre.chantierId) { params.push(filtre.chantierId); conds.push(`${alias}.chantier_id = $${params.length}`); }
    if (filtre.supplierId) { params.push(filtre.supplierId); conds.push(`${alias}.supplier_id = $${params.length}`); }
    if (filtre.du && ISO.test(filtre.du)) {
      params.push(filtre.du);
      conds.push(`COALESCE(${alias}.validated_at::date, ${alias}.created_at::date) >= $${params.length}`);
    }
    if (filtre.au && ISO.test(filtre.au)) {
      params.push(filtre.au);
      conds.push(`COALESCE(${alias}.validated_at::date, ${alias}.created_at::date) <= $${params.length}`);
    }
    if (filtre.montantMin != null && filtre.montantMin !== '') {
      params.push(filtre.montantMin); conds.push(`${alias}.total_ht >= $${params.length}`);
    }
    if (filtre.montantMax != null && filtre.montantMax !== '') {
      params.push(filtre.montantMax); conds.push(`${alias}.total_ht <= $${params.length}`);
    }
  }

  private pagination(filtre: FiltreRegistre): { limit: number; offset: number; page: number } {
    const parPage = Math.min(Math.max(Number(filtre.parPage) || PAR_PAGE_DEFAUT, 1), PAR_PAGE_MAX);
    const page = Math.max(Number(filtre.page) || 1, 1);
    return { limit: parPage, offset: (page - 1) * parPage, page };
  }
}
