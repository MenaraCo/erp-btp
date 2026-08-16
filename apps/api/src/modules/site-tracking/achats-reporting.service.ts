import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export type AxeConsommation =
  | 'fournisseur' | 'ressource' | 'code' | 'famille' | 'lot' | 'chantier' | 'nature';

export interface FiltreConsommation {
  du?: string | null;
  au?: string | null;
  chantierId?: string | null;
  supplierId?: string | null;
  nature?: string | null;
  codeAnalytiqueId?: string | null;
  q?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NATURES = ['labor', 'material', 'equipment', 'subcontract', 'site_overhead'];
const NATURE_LABELS: Record<string, string> = {
  labor: 'Main d’œuvre',
  material: 'Matériaux',
  equipment: 'Matériel',
  subcontract: 'Sous-traitance',
  site_overhead: 'Frais de chantier',
};

/** Une ligne du regroupement, avant mise en forme. */
interface LigneBrute {
  cle: string;
  code: string;
  label: string | null;
  couleur: string | null;
  unite: string | null;
  unites_multiples: boolean;
  nb_commandes: number;
  nb_lignes: number;
  nb_chantiers: number;
  quantite_commandee: string;
  quantite_recue: string;
  quantite_facturee: string;
  commande: string;
  receptionne: string;
  facture: string;
  facture_au_prix_commande: string;
}

/** Définition SQL d'un axe : ce qui identifie un groupe, et comment on le nomme. */
interface DefinitionAxe {
  cle: string;
  code: string;
  label: string;
  couleur: string;
  jointures: string;
  /** Les quantités ne s'additionnent que si l'axe désigne une même chose achetée. */
  quantites: boolean;
}

const AXES: Record<AxeConsommation, DefinitionAxe> = {
  fournisseur: {
    cle: `COALESCE(l.supplier_id::text, 'sans')`,
    code: `COALESCE(MAX(s.name), 'Sans fournisseur')`,
    label: `NULL`,
    couleur: `NULL`,
    jointures: `LEFT JOIN supplier s ON s.id = l.supplier_id`,
    quantites: false,
  },
  ressource: {
    cle: `COALESCE(NULLIF(l.code, ''), NULLIF(l.code_produit, ''), 'Sans code')`,
    code: `COALESCE(NULLIF(l.code, ''), NULLIF(l.code_produit, ''), 'Sans code')`,
    label: `MODE() WITHIN GROUP (ORDER BY l.designation)`,
    couleur: `NULL`,
    jointures: '',
    quantites: true,
  },
  code: {
    cle: `COALESCE(l.code_analytique_id::text, 'sans')`,
    code: `COALESCE(MAX(ac.code), 'Sans code analytique')`,
    label: `MAX(ac.label)`,
    couleur: `NULL`,
    jointures: `LEFT JOIN analytical_code ac ON ac.id = l.code_analytique_id`,
    quantites: false,
  },
  famille: {
    cle: `COALESCE(ac.famille_id::text, 'sans')`,
    code: `COALESCE(MAX(fa.code), 'Sans famille')`,
    label: `MAX(fa.label)`,
    couleur: `NULL`,
    jointures: `LEFT JOIN analytical_code ac ON ac.id = l.code_analytique_id
                LEFT JOIN analytical_famille fa ON fa.id = ac.famille_id`,
    quantites: false,
  },
  lot: {
    cle: `COALESCE(fa.lot_id::text, 'sans')`,
    code: `COALESCE(MAX(lo.code), 'Sans lot')`,
    label: `MAX(lo.label)`,
    couleur: `NULL`,
    jointures: `LEFT JOIN analytical_code ac ON ac.id = l.code_analytique_id
                LEFT JOIN analytical_famille fa ON fa.id = ac.famille_id
                LEFT JOIN analytical_lot lo ON lo.id = fa.lot_id`,
    quantites: false,
  },
  chantier: {
    cle: `l.chantier_id::text`,
    code: `MAX(c.code)`,
    label: `MAX(c.name)`,
    couleur: `MAX(c.color)`,
    jointures: `LEFT JOIN chantier c ON c.id = l.chantier_id`,
    quantites: false,
  },
  nature: {
    cle: `l.nature`,
    code: `l.nature`,
    label: `NULL`,
    couleur: `NULL`,
    jointures: '',
    quantites: false,
  },
};

/**
 * Reporting Direction des achats — la consommation de TOUTE l'entreprise, tous chantiers confondus.
 *
 * Le registre répond à « où est cette commande ? ». Ici la question est autre : « combien
 * dépense-t-on, chez qui, sur quoi ? ». On regarde donc les LIGNES, pas les pièces, et on les
 * regroupe le long d'un axe au choix — fournisseur, ressource, code analytique, famille, lot,
 * chantier ou nature.
 *
 * Ce qu'on mesure, dans l'ordre du cycle : commandé (engagé dès la validation, cahier §5.8),
 * réceptionné (valorisé au prix de la commande — le BL ne porte pas de prix) et facturé. L'écart
 * de prix compare le facturé au prix commandé À QUANTITÉ ÉGALE : un fournisseur qui livre moins
 * n'est pas un fournisseur moins cher.
 *
 * Les factures saisies sans détail de lignes n'entrent dans aucun axe — elles sont reportées à
 * part plutôt que passées sous silence : un total qui ne se réconcilie pas doit se voir.
 */
@Injectable()
export class AchatsReportingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  consommation(axe: AxeConsommation, filtre: FiltreConsommation) {
    const def = AXES[axe] ?? AXES.fournisseur;
    const tenantId = this.context.requireTenantId();

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [];
      const conds: string[] = [
        `l.kind <> 'comment'`,
        // L'engagé naît à la validation : ni brouillon, ni en attente, ni annulée.
        `o.status = 'validated'`,
      ];
      if (filtre.du && ISO.test(filtre.du)) {
        params.push(filtre.du);
        conds.push(`COALESCE(o.validated_at::date, o.created_at::date) >= $${params.length}`);
      }
      if (filtre.au && ISO.test(filtre.au)) {
        params.push(filtre.au);
        conds.push(`COALESCE(o.validated_at::date, o.created_at::date) <= $${params.length}`);
      }
      if (filtre.chantierId) { params.push(filtre.chantierId); conds.push(`o.chantier_id = $${params.length}`); }
      if (filtre.supplierId) { params.push(filtre.supplierId); conds.push(`o.supplier_id = $${params.length}`); }
      if (filtre.nature && NATURES.includes(filtre.nature)) {
        params.push(filtre.nature); conds.push(`l.nature = $${params.length}`);
      }
      if (filtre.codeAnalytiqueId) {
        params.push(filtre.codeAnalytiqueId); conds.push(`l.code_analytique_id = $${params.length}`);
      }
      if (filtre.q && filtre.q.trim()) {
        params.push(`%${filtre.q.trim()}%`);
        conds.push(`(l.designation ILIKE $${params.length} OR l.code ILIKE $${params.length}
                     OR l.code_produit ILIKE $${params.length})`);
      }

      // Réception et facturation sont des agrégats PAR LIGNE : les additionner dans la même
      // requête que le regroupement multiplierait les montants (produit cartésien).
      const source = `
        WITH ligne AS (
          SELECT l.id, l.order_id, o.chantier_id, o.supplier_id, l.nature,
                 l.code, l.code_produit, l.designation, l.unite_achat,
                 l.code_analytique_id, l.quantity, l.unit_price, l.amount_ht,
                 COALESCE(bl.q, 0) AS q_recue,
                 COALESCE(fa.q, 0) AS q_facturee,
                 COALESCE(fa.m, 0) AS m_facture
            FROM purchase_order_line l
            JOIN purchase_order o ON o.id = l.order_id
            LEFT JOIN LATERAL (
              SELECT SUM(d.quantite_livree) AS q FROM delivery_note_line d
               WHERE d.order_line_id = l.id
            ) bl ON TRUE
            LEFT JOIN LATERAL (
              SELECT SUM(f.quantite_facturee) AS q, SUM(f.montant_ht) AS m
                FROM supplier_invoice_line f WHERE f.order_line_id = l.id
            ) fa ON TRUE
           WHERE ${conds.join(' AND ')}
        )`;

      const lignes: LigneBrute[] = await em.query(
        `${source}
         SELECT ${def.cle} AS cle,
                ${def.code} AS code,
                ${def.label} AS label,
                ${def.couleur} AS couleur,
                MODE() WITHIN GROUP (ORDER BY COALESCE(l.unite_achat, '')) AS unite,
                COUNT(DISTINCT COALESCE(l.unite_achat, '')) > 1 AS unites_multiples,
                COUNT(DISTINCT l.order_id)::int AS nb_commandes,
                COUNT(*)::int AS nb_lignes,
                COUNT(DISTINCT l.chantier_id)::int AS nb_chantiers,
                COALESCE(SUM(l.quantity), 0)::numeric(16,4) AS quantite_commandee,
                COALESCE(SUM(l.q_recue), 0)::numeric(16,4) AS quantite_recue,
                COALESCE(SUM(l.q_facturee), 0)::numeric(16,4) AS quantite_facturee,
                COALESCE(SUM(l.amount_ht), 0)::numeric(16,2) AS commande,
                COALESCE(SUM(l.q_recue * l.unit_price), 0)::numeric(16,2) AS receptionne,
                COALESCE(SUM(l.m_facture), 0)::numeric(16,2) AS facture,
                COALESCE(SUM(l.q_facturee * l.unit_price), 0)::numeric(16,2) AS facture_au_prix_commande
           FROM ligne l
           ${def.jointures}
          GROUP BY ${def.cle}
          ORDER BY COALESCE(SUM(l.amount_ht), 0) DESC`,
        params,
      );

      const horsLignes = (await em.query(
        `${source}
         SELECT COALESCE(SUM(sf.amount_ht), 0)::numeric(16,2) AS m, COUNT(*)::int AS n
           FROM supplier_invoice sf
          WHERE sf.order_id IN (SELECT DISTINCT order_id FROM ligne)
            AND NOT EXISTS (SELECT 1 FROM supplier_invoice_line sl WHERE sl.invoice_id = sf.id)`,
        params,
      ))[0] ?? { m: '0.00', n: 0 };

      const total = {
        commande: new Decimal(0), receptionne: new Decimal(0),
        facture: new Decimal(0), ecartPrix: new Decimal(0),
        nbLignes: 0,
      };
      for (const r of lignes) {
        total.commande = total.commande.plus(r.commande);
        total.receptionne = total.receptionne.plus(r.receptionne);
        total.facture = total.facture.plus(r.facture);
        total.ecartPrix = total.ecartPrix
          .plus(new Decimal(r.facture).minus(r.facture_au_prix_commande));
        total.nbLignes += Number(r.nb_lignes ?? 0);
      }

      return {
        axe,
        lignes: lignes.map((r) => {
          const commande = new Decimal(r.commande);
          const ecartPrix = new Decimal(r.facture).minus(r.facture_au_prix_commande);
          return {
            cle: r.cle,
            code: axe === 'nature' ? (NATURE_LABELS[r.code] ?? r.code) : r.code,
            label: axe === 'nature' ? null : r.label,
            couleur: r.couleur,
            unite: def.quantites ? (r.unite || null) : null,
            unitesMultiples: def.quantites ? Boolean(r.unites_multiples) : false,
            nbCommandes: Number(r.nb_commandes ?? 0),
            nbLignes: Number(r.nb_lignes ?? 0),
            nbChantiers: Number(r.nb_chantiers ?? 0),
            quantiteCommandee: def.quantites ? String(r.quantite_commandee) : null,
            quantiteRecue: def.quantites ? String(r.quantite_recue) : null,
            quantiteFacturee: def.quantites ? String(r.quantite_facturee) : null,
            commande: commande.toFixed(2),
            receptionne: new Decimal(r.receptionne).toFixed(2),
            facture: new Decimal(r.facture).toFixed(2),
            resteARecevoir: commande.minus(r.receptionne).toFixed(2),
            ecartPrix: ecartPrix.toFixed(2),
            part: total.commande.isZero() ? '0' : commande.div(total.commande).toFixed(4),
          };
        }),
        total: {
          commande: total.commande.toFixed(2),
          receptionne: total.receptionne.toFixed(2),
          facture: total.facture.toFixed(2),
          resteARecevoir: total.commande.minus(total.receptionne).toFixed(2),
          ecartPrix: total.ecartPrix.toFixed(2),
          nbLignes: total.nbLignes,
          nbGroupes: lignes.length,
        },
        factureHorsLignes: {
          montant: String(horsLignes.m ?? '0.00'),
          nombre: Number(horsLignes.n ?? 0),
        },
      };
    });
  }
}
