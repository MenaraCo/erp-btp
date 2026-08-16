import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { NumberingService } from '../../core/numbering/numbering.service';

export interface LigneSaisie {
  orderLineId: string;
  quantite?: string | number;
  puFacture?: string | number;
  commentaire?: string | null;
}

/** Où en est une commande, côté livraison comme côté facture. */
export type EtatAvancement = 'aucune' | 'partielle' | 'complete';

/**
 * Rapprochement commande / réception / facture, ligne à ligne.
 *
 * C'est ici que se joue la vraie question d'un achat : « qu'est-ce qui reste à recevoir, et
 * qu'est-ce qui m'est facturé en trop ? ». Une réception globale ne répond ni à l'une ni à
 * l'autre. On compare donc chaque ligne commandée à ce qui a été livré, puis à ce qui a été
 * facturé — quantité ET prix, car un prix qui glisse entre la commande et la facture coûte aussi
 * cher qu'une quantité en trop.
 *
 * Les états (partielle, complète) se DÉDUISENT des quantités : aucun statut stocké ne peut
 * dériver de la réalité des lignes.
 */
@Injectable()
export class RapprochementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly numbering: NumberingService,
  ) {}

  /** Tableau de rapprochement d'une commande : commandé, reçu, facturé, restes et écarts. */
  tableau(orderId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => this.lire(em, orderId));
  }

  /**
   * Enregistre une réception : un bon de livraison, et les quantités reçues ligne par ligne.
   *
   * Livrer plus que commandé est refusé — c'est presque toujours une erreur de saisie, et le
   * laisser passer fausserait le reste à recevoir de toutes les lignes suivantes.
   */
  receptionner(orderId: string, input: { code?: string | null; date?: string | null; lignes: LigneSaisie[] }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const commande = await this.commande(em, orderId);
      if (commande.status !== 'validated') {
        throw new ConflictException('Seule une commande envoyée peut être réceptionnée.');
      }
      const saisies = (input.lignes ?? []).filter((l) => new Decimal(l.quantite ?? 0).greaterThan(0));
      if (saisies.length === 0) {
        throw new BadRequestException('Indiquez au moins une quantité reçue.');
      }

      const etat = await this.lire(em, orderId);
      for (const s of saisies) {
        const ligne = etat.lignes.find((l) => l.orderLineId === s.orderLineId);
        if (!ligne) throw new BadRequestException('Ligne étrangère à cette commande.');
        const quantite = new Decimal(s.quantite ?? 0);
        if (quantite.greaterThan(ligne.resteARecevoir)) {
          throw new BadRequestException(
            `« ${ligne.designation} » : ${quantite} reçus pour ${ligne.resteARecevoir} attendus. `
            + 'Corrigez la commande si le fournisseur a livré davantage.',
          );
        }
      }

      const code = (input.code ?? '').trim() || (await this.numbering.next(em, 'delivery_note'));
      const bl = (await em.query(
        `INSERT INTO delivery_note (tenant_id, order_id, code, received_at)
         VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE)) RETURNING id, code`,
        [tenantId, orderId, code, input.date || null],
      ))[0];

      for (const s of saisies) {
        await em.query(
          `INSERT INTO delivery_note_line
             (tenant_id, delivery_note_id, order_line_id, quantite_livree, commentaire)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, bl.id, s.orderLineId, new Decimal(s.quantite ?? 0).toString(),
            (s.commentaire ?? '').trim() || null],
        );
      }

      const apres = await this.lire(em, orderId);
      await this.journal(em, tenantId, orderId, 'received',
        apres.receptionEtat === 'complete' ? 'Livraison complète' : 'Livraison partielle');
      return { id: bl.id as string, code: bl.code as string, etat: apres.receptionEtat };
    });
  }

  /**
   * Enregistre une facture fournisseur ligne à ligne : quantité ET prix facturés.
   * Le montant de la facture est la somme de ses lignes — pas un total ressaisi à côté.
   */
  facturer(
    orderId: string,
    input: { code: string; date?: string | null; lignes: LigneSaisie[] },
  ) {
    const tenantId = this.context.requireTenantId();
    const code = (input.code ?? '').trim();
    if (!code) throw new BadRequestException('Le numéro de facture est requis.');
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const commande = await this.commande(em, orderId);
      if (commande.status !== 'validated') {
        throw new ConflictException('Seule une commande envoyée peut être facturée.');
      }
      const saisies = (input.lignes ?? []).filter((l) => new Decimal(l.quantite ?? 0).greaterThan(0));
      if (saisies.length === 0) {
        throw new BadRequestException('Indiquez au moins une quantité facturée.');
      }

      const etat = await this.lire(em, orderId);
      const details = saisies.map((s) => {
        const ligne = etat.lignes.find((l) => l.orderLineId === s.orderLineId);
        if (!ligne) throw new BadRequestException('Ligne étrangère à cette commande.');
        const quantite = new Decimal(s.quantite ?? 0);
        const pu = new Decimal(s.puFacture ?? ligne.puCommande);
        return {
          ligne,
          quantite,
          pu,
          montant: quantite.times(pu).toDecimalPlaces(2),
        };
      });

      // Une facture porte une seule nature côté comptabilité : on garde celle de la ligne
      // majoritaire en montant, et l'imputation analytique suit la même ligne.
      const principale = [...details].sort((a, b) => b.montant.comparedTo(a.montant))[0];
      const total = details.reduce((t, d) => t.plus(d.montant), new Decimal(0)).toDecimalPlaces(2);

      const facture = (await em.query(
        `INSERT INTO supplier_invoice
           (tenant_id, chantier_id, order_id, execution_line_id, code, nature, amount_ht,
            invoice_date, code_analytique_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9)
         RETURNING id, code`,
        [tenantId, commande.chantier_id, orderId, principale.ligne.executionLineId, code,
          principale.ligne.nature, total.toString(), input.date || null,
          principale.ligne.codeAnalytiqueId],
      ))[0];

      for (const d of details) {
        await em.query(
          `INSERT INTO supplier_invoice_line
             (tenant_id, invoice_id, order_line_id, designation, quantite_facturee, pu_facture, montant_ht)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, facture.id, d.ligne.orderLineId, d.ligne.designation,
            d.quantite.toString(), d.pu.toString(), d.montant.toString()],
        );
      }

      const apres = await this.lire(em, orderId);
      await this.journal(em, tenantId, orderId, 'invoiced',
        apres.factureEtat === 'complete' ? 'Facturation complète' : 'Facturation partielle');
      return {
        id: facture.id as string, code: facture.code as string,
        montantHt: total.toString(), etat: apres.factureEtat,
      };
    });
  }

  /** Lecture commune : c'est elle qui définit « reste à recevoir » et « écart de prix ». */
  private async lire(em: EntityManager, orderId: string) {
    const commande = await this.commande(em, orderId);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT l.id, l.designation, l.nature, l.quantity, l.unit_price, l.amount_ht,
              l.execution_line_id, l.code_analytique_id,
              n.unite_achat, ac.code AS code_analytique, el.designation AS ouvrage,
              COALESCE(recu.qte, 0)      AS qte_recue,
              COALESCE(fact.qte, 0)      AS qte_facturee,
              COALESCE(fact.montant, 0)  AS montant_facture
         FROM purchase_order_line l
         LEFT JOIN nomenclature_resource n ON n.id = l.nomenclature_resource_id
         LEFT JOIN analytical_code ac ON ac.id = l.code_analytique_id
         LEFT JOIN execution_line el ON el.id = l.execution_line_id
         LEFT JOIN (
           SELECT order_line_id, SUM(quantite_livree) AS qte
             FROM delivery_note_line GROUP BY order_line_id
         ) recu ON recu.order_line_id = l.id
         LEFT JOIN (
           SELECT order_line_id, SUM(quantite_facturee) AS qte, SUM(montant_ht) AS montant
             FROM supplier_invoice_line GROUP BY order_line_id
         ) fact ON fact.order_line_id = l.id
        WHERE l.order_id = $1 AND l.kind <> 'comment'
        ORDER BY l.sort_order ASC, l.created_at ASC`,
      [orderId],
    );

    const lignes = rows.map((r) => {
      const commandee = new Decimal(String(r.quantity ?? 0));
      const recue = new Decimal(String(r.qte_recue ?? 0));
      const facturee = new Decimal(String(r.qte_facturee ?? 0));
      const puCommande = new Decimal(String(r.unit_price ?? 0));
      const montantFacture = new Decimal(String(r.montant_facture ?? 0));
      // PU facturé moyen : c'est lui qu'on compare au PU commandé, pas la dernière facture.
      const puFacture = facturee.isZero() ? null : montantFacture.dividedBy(facturee);
      return {
        orderLineId: r.id as string,
        designation: r.designation as string,
        nature: r.nature as string,
        ouvrage: (r.ouvrage as string | null) ?? null,
        uniteAchat: (r.unite_achat as string | null) ?? null,
        executionLineId: (r.execution_line_id as string | null) ?? null,
        codeAnalytiqueId: (r.code_analytique_id as string | null) ?? null,
        codeAnalytique: (r.code_analytique as string | null) ?? null,
        quantiteCommandee: commandee.toString(),
        puCommande: puCommande.toString(),
        montantCommande: new Decimal(String(r.amount_ht ?? 0)).toString(),
        quantiteRecue: recue.toString(),
        resteARecevoir: Decimal.max(commandee.minus(recue), 0).toString(),
        quantiteFacturee: facturee.toString(),
        resteAFacturer: Decimal.max(commandee.minus(facturee), 0).toString(),
        puFacture: puFacture ? puFacture.toDecimalPlaces(4).toString() : null,
        montantFacture: montantFacture.toString(),
        // Écart de prix : ce que la facture coûte en plus (ou en moins) du prix commandé.
        ecartPrix: puFacture
          ? puFacture.minus(puCommande).times(facturee).toDecimalPlaces(2).toString()
          : '0.00',
      };
    });

    const etat = (fait: (l: (typeof lignes)[number]) => Decimal): EtatAvancement => {
      if (lignes.length === 0) return 'aucune';
      const total = lignes.reduce((t, l) => t.plus(fait(l)), new Decimal(0));
      if (total.isZero()) return 'aucune';
      return lignes.every((l) => fait(l).greaterThanOrEqualTo(l.quantiteCommandee))
        ? 'complete' : 'partielle';
    };

    const receptionEtat = etat((l) => new Decimal(l.quantiteRecue));
    const factureEtat = etat((l) => new Decimal(l.quantiteFacturee));

    return {
      orderId,
      statut: commande.status as string,
      lignes,
      receptionEtat,
      factureEtat,
      /** « Soldée » : tout est arrivé ET tout est facturé. C'est la fin de vie d'une commande. */
      soldee: receptionEtat === 'complete' && factureEtat === 'complete',
      ecartPrixTotal: lignes
        .reduce((t, l) => t.plus(l.ecartPrix), new Decimal(0)).toDecimalPlaces(2).toString(),
    };
  }

  private async commande(em: EntityManager, orderId: string) {
    const rows = await em.query(
      `SELECT id, chantier_id, status, total_ht FROM purchase_order WHERE id = $1`, [orderId],
    );
    if (rows.length === 0) throw new NotFoundException(`Unknown purchase order "${orderId}"`);
    return rows[0] as { id: string; chantier_id: string; status: string; total_ht: string };
  }

  private journal(
    em: EntityManager,
    tenantId: string,
    orderId: string,
    action: string,
    motif: string | null,
  ): Promise<unknown> {
    return em.query(
      `INSERT INTO purchase_order_event (tenant_id, order_id, action, actor_user_id, motif)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, orderId, action, this.context.getUserId() ?? null, motif],
    );
  }
}
