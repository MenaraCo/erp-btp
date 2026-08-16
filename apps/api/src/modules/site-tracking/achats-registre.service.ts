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

  /** Réceptions (bons de livraison) de toute la société. */
  receptions(filtre: FiltreRegistre) {
    const tenantId = this.context.requireTenantId();
    const { limit, offset, page } = this.pagination(filtre);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [];
      const conds: string[] = ['1 = 1'];
      if (filtre.q) {
        params.push(`%${filtre.q.trim()}%`);
        conds.push(`(d.code ILIKE $${params.length} OR o.code ILIKE $${params.length}
                     OR s.name ILIKE $${params.length} OR c.code ILIKE $${params.length})`);
      }
      if (filtre.chantierId) { params.push(filtre.chantierId); conds.push(`o.chantier_id = $${params.length}`); }
      if (filtre.supplierId) { params.push(filtre.supplierId); conds.push(`o.supplier_id = $${params.length}`); }
      if (filtre.du && ISO.test(filtre.du)) { params.push(filtre.du); conds.push(`d.received_at >= $${params.length}`); }
      if (filtre.au && ISO.test(filtre.au)) { params.push(filtre.au); conds.push(`d.received_at <= $${params.length}`); }
      const where = `WHERE ${conds.join(' AND ')}`;
      const base = `
        FROM delivery_note d
        JOIN purchase_order o ON o.id = d.order_id
        LEFT JOIN supplier s ON s.id = o.supplier_id
        LEFT JOIN chantier c ON c.id = o.chantier_id
        ${where}`;

      const total = Number((await em.query(`SELECT COUNT(*)::int AS n ${base}`, params))[0]?.n ?? 0);
      const lignes = await em.query(
        `SELECT d.id, d.code, d.received_at, d.created_at,
                o.id AS order_id, o.code AS commande, o.chantier_id,
                c.code AS chantier_code, s.name AS fournisseur
         ${base}
         ORDER BY COALESCE(d.received_at, d.created_at::date) DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { lignes, total, page, parPage: limit };
    });
  }

  /** Factures fournisseur de toute la société. */
  factures(filtre: FiltreRegistre) {
    const tenantId = this.context.requireTenantId();
    const { limit, offset, page } = this.pagination(filtre);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [];
      const conds: string[] = ['1 = 1'];
      if (filtre.q) {
        params.push(`%${filtre.q.trim()}%`);
        conds.push(`(f.code ILIKE $${params.length} OR o.code ILIKE $${params.length}
                     OR s.name ILIKE $${params.length} OR c.code ILIKE $${params.length})`);
      }
      if (filtre.chantierId) { params.push(filtre.chantierId); conds.push(`f.chantier_id = $${params.length}`); }
      if (filtre.du && ISO.test(filtre.du)) { params.push(filtre.du); conds.push(`f.invoice_date >= $${params.length}`); }
      if (filtre.au && ISO.test(filtre.au)) { params.push(filtre.au); conds.push(`f.invoice_date <= $${params.length}`); }
      if (filtre.montantMin != null && filtre.montantMin !== '') {
        params.push(filtre.montantMin); conds.push(`f.amount_ht >= $${params.length}`);
      }
      if (filtre.montantMax != null && filtre.montantMax !== '') {
        params.push(filtre.montantMax); conds.push(`f.amount_ht <= $${params.length}`);
      }
      const where = `WHERE ${conds.join(' AND ')}`;
      // La jointure du code analytique fait partie de la BASE : la placer après le WHERE
      // produisait un SQL invalide, et l'écran restait vide sans dire pourquoi.
      const base = `
        FROM supplier_invoice f
        LEFT JOIN purchase_order o ON o.id = f.order_id
        LEFT JOIN supplier s ON s.id = o.supplier_id
        LEFT JOIN chantier c ON c.id = f.chantier_id
        LEFT JOIN analytical_code ac ON ac.id = f.code_analytique_id
        ${where}`;

      const total = Number((await em.query(`SELECT COUNT(*)::int AS n ${base}`, params))[0]?.n ?? 0);
      const montant = (await em.query(
        `SELECT COALESCE(SUM(f.amount_ht), 0)::numeric(16,2) AS m ${base}`, params,
      ))[0]?.m ?? '0.00';
      const lignes = await em.query(
        `SELECT f.id, f.code, f.amount_ht, f.invoice_date, f.nature, f.created_at,
                f.chantier_id, c.code AS chantier_code,
                o.id AS order_id, o.code AS commande, s.name AS fournisseur,
                ac.code AS code_analytique
         ${base}
         ORDER BY COALESCE(f.invoice_date, f.created_at::date) DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { lignes, total, montantTotal: String(montant), page, parPage: limit };
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
