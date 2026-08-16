import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';
import { NumberingService } from '../../core/numbering/numbering.service';
import {
  assertTransition,
  InvalidPoTransitionError,
  PurchaseOrderStatus,
} from './purchase-order-status';

export interface OrderLineInput {
  executionLineId?: string | null;
  /** Ressource du chantier approvisionnée — c'est elle qui donne le reste à commander. */
  nomenclatureResourceId?: string | null;
  nature: string;
  designation: string;
  quantity: string | number;
  unitPrice: string | number;
  /** Imputation analytique au code analytique du plan partagé (engagé, cahier §5.8). Optionnel. */
  codeAnalytiqueId?: string | null;
}

export interface SupplierInvoiceInput {
  code: string;
  nature: string;
  amountHt: string | number;
  invoiceDate?: string;
  /** Imputation structurelle à un ouvrage (réalisé par ouvrage, cahier §5.8). Optionnel. */
  executionLineId?: string | null;
  /** Imputation analytique au code analytique du plan partagé (réalisé, cahier §5.8). Optionnel. */
  codeAnalytiqueId?: string | null;
}

@Injectable()
export class PurchasingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    // Les codes ne se tapent plus : ils viennent de la numérotation société, comme les affaires
    // et les devis. Un numéro de commande saisi à la main finit toujours par se dupliquer.
    private readonly numbering: NumberingService,
  ) {}

  // --- DDP (demande de prix) ---

  createRequest(chantierId: string, input: { code?: string | null; supplierId?: string | null }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const code = input.code?.trim() || (await this.numbering.next(em, 'purchase_request'));
      return (
        await em.query(
          `INSERT INTO purchase_request (tenant_id, chantier_id, supplier_id, code)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [tenantId, chantierId, input.supplierId ?? null, code],
        )
      )[0];
    });
  }

  convertRequest(requestId: string, code?: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const req = await em.query(`SELECT * FROM purchase_request WHERE id = $1`, [requestId]);
      if (req.length === 0) {
        throw new NotFoundException(`Unknown purchase request "${requestId}"`);
      }
      const numero = code?.trim() || (await this.numbering.next(em, 'purchase_order'));
      const order = (
        await em.query(
          `INSERT INTO purchase_order (tenant_id, chantier_id, request_id, supplier_id, code)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [tenantId, req[0].chantier_id, requestId, req[0].supplier_id, numero],
        )
      )[0];
      await em.query(`UPDATE purchase_request SET status = 'converted', updated_at = now() WHERE id = $1`, [requestId]);
      return order;
    });
  }

  // --- BC (bon de commande) ---

  createOrder(chantierId: string, input: { code?: string | null; supplierId?: string | null }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const code = input.code?.trim() || (await this.numbering.next(em, 'purchase_order'));
      return (
        await em.query(
          `INSERT INTO purchase_order (tenant_id, chantier_id, supplier_id, code)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [tenantId, chantierId, input.supplierId ?? null, code],
        )
      )[0];
    });
  }

  addLine(orderId: string, input: OrderLineInput) {
    const tenantId = this.context.requireTenantId();
    const qty = new Decimal(input.quantity ?? 0);
    const price = new Decimal(input.unitPrice ?? 0);
    const amount = qty.times(price).toDecimalPlaces(2);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(`SELECT chantier_id, status FROM purchase_order WHERE id = $1`, [orderId]);
      if (order.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      if (order[0].status !== 'draft') {
        throw new ConflictException(
          'Cette commande est envoyée : elle ne se modifie plus. Un administrateur peut la rouvrir.',
        );
      }
      if (input.executionLineId != null) {
        await this.assertExecutionLineInChantier(em, input.executionLineId, order[0].chantier_id);
      }
      if (input.codeAnalytiqueId != null) {
        await this.assertCodeAnalytiqueExists(em, input.codeAnalytiqueId);
      }
      const line = (
        await em.query(
          `INSERT INTO purchase_order_line
             (tenant_id, order_id, execution_line_id, nature, designation, quantity, unit_price, amount_ht,
              code_analytique_id, nomenclature_resource_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [tenantId, orderId, input.executionLineId ?? null, input.nature, input.designation,
            qty.toString(), price.toString(), amount.toString(), input.codeAnalytiqueId ?? null,
            input.nomenclatureResourceId ?? null],
        )
      )[0];
      await em.query(
        `UPDATE purchase_order SET total_ht = (SELECT COALESCE(SUM(amount_ht),0) FROM purchase_order_line WHERE order_id = $1),
           updated_at = now() WHERE id = $1`,
        [orderId],
      );
      return line;
    });
  }

  /**
   * Modifie l'en-tête d'une commande : fournisseur, livraison, conditions.
   *
   * Ouvert tant que la commande n'est pas partie. Une fois envoyée, l'en-tête fait partie de ce
   * que le fournisseur a reçu : le changer en douce donnerait deux versions du même document.
   */
  updateOrder(
    orderId: string,
    patch: {
      supplierId?: string | null;
      deliveryAddress?: string | null;
      deliveryDate?: string | null;
      deliveryConditions?: string | null;
      paymentTerms?: string | null;
      contact?: string | null;
      notes?: string | null;
    },
  ) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT status FROM purchase_order WHERE id = $1`, [orderId]);
      if (rows.length === 0) throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      if (rows[0].status !== 'draft') {
        throw new ConflictException(
          'Cette commande n’est plus en brouillon : son en-tête ne se modifie plus.',
        );
      }
      if (patch.supplierId) {
        const s = await em.query(
          `SELECT id FROM supplier WHERE id = $1 AND deleted_at IS NULL`, [patch.supplierId],
        );
        if (s.length === 0) throw new NotFoundException('Fournisseur introuvable.');
      }
      if (patch.deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(patch.deliveryDate)) {
        throw new BadRequestException('Date de livraison attendue au format AAAA-MM-JJ.');
      }

      // COALESCE sur les seuls champs fournis : un formulaire partiel ne doit rien effacer.
      const texte = (v: string | null | undefined) =>
        v === undefined ? undefined : ((v ?? '').trim() || null);
      const rowsMaj = returningRows<Record<string, unknown>>(
        await em.query(
          `UPDATE purchase_order
              SET supplier_id         = COALESCE($2, supplier_id),
                  delivery_address    = CASE WHEN $3::boolean THEN $4 ELSE delivery_address END,
                  delivery_date       = CASE WHEN $5::boolean THEN $6::date ELSE delivery_date END,
                  delivery_conditions = CASE WHEN $7::boolean THEN $8 ELSE delivery_conditions END,
                  payment_terms       = CASE WHEN $9::boolean THEN $10 ELSE payment_terms END,
                  contact             = CASE WHEN $11::boolean THEN $12 ELSE contact END,
                  notes               = CASE WHEN $13::boolean THEN $14 ELSE notes END,
                  updated_at = now()
            WHERE id = $1
        RETURNING *`,
          [
            orderId, patch.supplierId ?? null,
            patch.deliveryAddress !== undefined, texte(patch.deliveryAddress) ?? null,
            patch.deliveryDate !== undefined, patch.deliveryDate || null,
            patch.deliveryConditions !== undefined, texte(patch.deliveryConditions) ?? null,
            patch.paymentTerms !== undefined, texte(patch.paymentTerms) ?? null,
            patch.contact !== undefined, texte(patch.contact) ?? null,
            patch.notes !== undefined, texte(patch.notes) ?? null,
          ],
        ),
      );
      return rowsMaj[0];
    });
  }

  /** Corrige une ligne de commande — tant que la commande est en brouillon. */
  updateLine(lineId: string, patch: {
    designation?: string; quantity?: string | number; unitPrice?: string | number;
    nature?: string; executionLineId?: string | null; codeAnalytiqueId?: string | null;
  }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ligne = (await em.query(
        `SELECT l.*, o.status, o.chantier_id
           FROM purchase_order_line l JOIN purchase_order o ON o.id = l.order_id
          WHERE l.id = $1`,
        [lineId],
      ))[0];
      if (!ligne) throw new NotFoundException('Ligne introuvable.');
      if (ligne.status !== 'draft') {
        throw new ConflictException('Cette commande n’est plus modifiable.');
      }
      if (patch.executionLineId) {
        await this.assertExecutionLineInChantier(em, patch.executionLineId, ligne.chantier_id);
      }
      if (patch.codeAnalytiqueId) {
        await this.assertCodeAnalytiqueExists(em, patch.codeAnalytiqueId);
      }

      const qty = new Decimal(patch.quantity ?? String(ligne.quantity));
      const price = new Decimal(patch.unitPrice ?? String(ligne.unit_price));
      if (qty.isNegative()) throw new BadRequestException('La quantité ne peut pas être négative.');
      const amount = qty.times(price).toDecimalPlaces(2);

      const rows = returningRows<Record<string, unknown>>(
        await em.query(
          `UPDATE purchase_order_line
              SET designation = COALESCE($2, designation),
                  nature = COALESCE($3, nature),
                  quantity = $4, unit_price = $5, amount_ht = $6,
                  execution_line_id = CASE WHEN $7::boolean THEN $8 ELSE execution_line_id END,
                  code_analytique_id = CASE WHEN $9::boolean THEN $10 ELSE code_analytique_id END
            WHERE id = $1
        RETURNING *`,
          [
            lineId,
            patch.designation?.trim() || null,
            patch.nature ?? null,
            qty.toString(), price.toString(), amount.toString(),
            patch.executionLineId !== undefined, patch.executionLineId || null,
            patch.codeAnalytiqueId !== undefined, patch.codeAnalytiqueId || null,
          ],
        ),
      );
      await this.recalculerTotal(em, ligne.order_id as string);
      return rows[0];
    });
  }

  /** Retire une ligne d'une commande en brouillon. */
  removeLine(lineId: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const ligne = (await em.query(
        `SELECT l.order_id, o.status FROM purchase_order_line l
           JOIN purchase_order o ON o.id = l.order_id WHERE l.id = $1`,
        [lineId],
      ))[0];
      if (!ligne) throw new NotFoundException('Ligne introuvable.');
      if (ligne.status !== 'draft') {
        throw new ConflictException('Cette commande n’est plus modifiable.');
      }
      await em.query(`DELETE FROM purchase_order_line WHERE id = $1`, [lineId]);
      await this.recalculerTotal(em, ligne.order_id as string);
      return { deleted: true as const };
    });
  }

  private recalculerTotal(em: EntityManager, orderId: string): Promise<unknown> {
    return em.query(
      `UPDATE purchase_order
          SET total_ht = (SELECT COALESCE(SUM(amount_ht),0) FROM purchase_order_line WHERE order_id = $1),
              updated_at = now()
        WHERE id = $1`,
      [orderId],
    );
  }

  /**
   * Fiche complète d'une commande : en-tête, lignes, réceptions et factures.
   * C'est ce que la page dédiée affiche — une commande ne se lit plus dans une liste dépliée.
   */
  getOrder(orderId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT o.*, o.delivery_date::text AS delivery_date,
                s.name AS fournisseur, s.id AS supplier_id,
                c.code AS chantier_code, c.name AS chantier_nom, c.color AS chantier_couleur
           FROM purchase_order o
           LEFT JOIN supplier s ON s.id = o.supplier_id
           LEFT JOIN chantier c ON c.id = o.chantier_id
          WHERE o.id = $1`,
        [orderId],
      );
      if (rows.length === 0) throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      const [lines, deliveries, invoices] = await Promise.all([
        em.query(
          `SELECT l.*, el.designation AS ouvrage, ac.code AS code_analytique,
                  n.code AS ressource_code, n.unite_achat
             FROM purchase_order_line l
             LEFT JOIN execution_line el ON el.id = l.execution_line_id
             LEFT JOIN analytical_code ac ON ac.id = l.code_analytique_id
             LEFT JOIN nomenclature_resource n ON n.id = l.nomenclature_resource_id
            WHERE l.order_id = $1 ORDER BY l.created_at ASC`,
          [orderId],
        ),
        em.query(
          `SELECT id, code, received_at FROM delivery_note WHERE order_id = $1 ORDER BY created_at ASC`,
          [orderId],
        ),
        em.query(
          `SELECT id, code, nature, amount_ht, invoice_date FROM supplier_invoice
            WHERE order_id = $1 ORDER BY created_at ASC`,
          [orderId],
        ),
      ]);
      return { commande: rows[0], lignes: lines, receptions: deliveries, factures: invoices };
    });
  }

  /** Lignes d'une commande, avec ce à quoi elles sont imputées (ouvrage, code, ressource). */
  listLines(orderId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(`SELECT id FROM purchase_order WHERE id = $1`, [orderId]);
      if (order.length === 0) throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      return em.query(
        `SELECT l.*, el.designation AS ouvrage, ac.code AS code_analytique,
                n.code AS ressource_code, n.label AS ressource_label, n.unite_achat
           FROM purchase_order_line l
           LEFT JOIN execution_line el ON el.id = l.execution_line_id
           LEFT JOIN analytical_code ac ON ac.id = l.code_analytique_id
           LEFT JOIN nomenclature_resource n ON n.id = l.nomenclature_resource_id
          WHERE l.order_id = $1
          ORDER BY l.created_at ASC`,
        [orderId],
      );
    });
  }

  validateOrder(orderId: string) {
    return this.transition(orderId, 'validated', true);
  }

  cancelOrder(orderId: string) {
    return this.transition(orderId, 'cancelled', false);
  }

  /**
   * Rouvre une commande envoyée, pour corriger une erreur.
   *
   * Réservé à l'administrateur (garde de permission côté contrôleur) et jamais silencieux : le
   * motif est exigé et le journal garde qui a rouvert quoi. Une commande déjà reçue ou facturée
   * ne se rouvre PAS : ses lignes servent de référence au rapprochement, les changer après coup
   * rendrait la comparaison fausse — il faut alors annuler et refaire.
   */
  reopenOrder(orderId: string, motif: string) {
    const tenantId = this.context.requireTenantId();
    const raison = (motif ?? '').trim();
    if (raison.length < 3) {
      throw new BadRequestException('Indiquez le motif de la réouverture.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT status FROM purchase_order WHERE id = $1 FOR UPDATE`, [orderId],
      );
      if (rows.length === 0) throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      if (rows[0].status !== 'validated') {
        throw new ConflictException('Seule une commande envoyée peut être rouverte.');
      }
      const attaches = await em.query(
        `SELECT (SELECT COUNT(*)::int FROM delivery_note WHERE order_id = $1) AS bl,
                (SELECT COUNT(*)::int FROM supplier_invoice WHERE order_id = $1) AS factures`,
        [orderId],
      );
      if (attaches[0].bl > 0 || attaches[0].factures > 0) {
        throw new ConflictException(
          'Cette commande a déjà une réception ou une facture : annulez-la et refaites-en une.',
        );
      }

      await em.query(
        `UPDATE purchase_order
            SET status = 'draft', validated_at = NULL,
                reopened_count = reopened_count + 1, updated_at = now()
          WHERE id = $1`,
        [orderId],
      );
      await this.journaliser(em, tenantId, orderId, 'reopened', raison);
      return (await em.query(`SELECT * FROM purchase_order WHERE id = $1`, [orderId]))[0];
    });
  }

  /** Journal d'une commande : validation, annulation, réouverture — avec leur auteur. */
  listEvents(orderId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT e.id, e.action, e.motif, e.created_at,
                trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS auteur,
                u.email AS auteur_email
           FROM purchase_order_event e
           LEFT JOIN user_account u ON u.id = e.actor_user_id
          WHERE e.order_id = $1
          ORDER BY e.created_at DESC`,
        [orderId],
      ),
    );
  }

  private journaliser(
    em: EntityManager,
    tenantId: string,
    orderId: string,
    action: string,
    motif: string | null = null,
  ): Promise<unknown> {
    return em.query(
      `INSERT INTO purchase_order_event (tenant_id, order_id, action, actor_user_id, motif)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, orderId, action, this.context.getUserId() ?? null, motif],
    );
  }

  private transition(orderId: string, to: PurchaseOrderStatus, setValidatedAt: boolean) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT status FROM purchase_order WHERE id = $1 FOR UPDATE`, [orderId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      try {
        assertTransition(rows[0].status, to);
      } catch (e) {
        if (e instanceof InvalidPoTransitionError) {
          throw new ConflictException(e.message);
        }
        throw e;
      }
      await em.query(
        `UPDATE purchase_order SET status = $1${setValidatedAt ? ', validated_at = now()' : ''}, updated_at = now() WHERE id = $2`,
        [to, orderId],
      );
      await this.journaliser(em, tenantId, orderId, to === 'validated' ? 'validated' : 'cancelled');
      return (await em.query(`SELECT * FROM purchase_order WHERE id = $1`, [orderId]))[0];
    });
  }

  // --- BL (bon de livraison) ---

  receiveDelivery(orderId: string, code?: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(`SELECT status FROM purchase_order WHERE id = $1`, [orderId]);
      if (order.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      if (order[0].status !== 'validated') {
        throw new ConflictException('Deliveries require a validated order.');
      }
      return (
        await em.query(
          `INSERT INTO delivery_note (tenant_id, order_id, code) VALUES ($1,$2,$3) RETURNING *`,
          [tenantId, orderId, code?.trim() || (await this.numbering.next(em, 'delivery_note'))],
        )
      )[0];
    });
  }

  // --- Facture fournisseur ---

  addSupplierInvoice(orderId: string, input: SupplierInvoiceInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(`SELECT chantier_id, status FROM purchase_order WHERE id = $1`, [orderId]);
      if (order.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      if (order[0].status !== 'validated') {
        throw new ConflictException('Supplier invoices require a validated order.');
      }
      if (input.executionLineId != null) {
        await this.assertExecutionLineInChantier(em, input.executionLineId, order[0].chantier_id);
      }
      if (input.codeAnalytiqueId != null) {
        await this.assertCodeAnalytiqueExists(em, input.codeAnalytiqueId);
      }
      return (
        await em.query(
          `INSERT INTO supplier_invoice
             (tenant_id, chantier_id, order_id, execution_line_id, code, nature, amount_ht, invoice_date, code_analytique_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now()), $9) RETURNING *`,
          [tenantId, order[0].chantier_id, orderId, input.executionLineId ?? null, input.code, input.nature,
            new Decimal(input.amountHt ?? 0).toDecimalPlaces(2).toString(), input.invoiceDate ?? null,
            input.codeAnalytiqueId ?? null],
        )
      )[0];
    });
  }

  private async assertCodeAnalytiqueExists(em: EntityManager, codeId: string): Promise<void> {
    const rows = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [codeId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Unknown code analytique "${codeId}"`);
    }
  }

  private async assertExecutionLineInChantier(em: EntityManager, lineId: string, chantierId: string): Promise<void> {
    const rows = await em.query(
      `SELECT id FROM execution_line WHERE id = $1 AND chantier_id = $2`,
      [lineId, chantierId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Execution line "${lineId}" not found on this chantier`);
    }
  }


  /** Engagé (validated orders) and réalisé achats (supplier invoices), by nature, for a chantier. */
  summary(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const engageByNature = await em.query(
        `SELECT l.nature, SUM(l.amount_ht)::numeric(16,2) AS montant
           FROM purchase_order_line l JOIN purchase_order o ON o.id = l.order_id
          WHERE o.chantier_id = $1 AND o.status = 'validated'
          GROUP BY l.nature ORDER BY l.nature`,
        [chantierId],
      );
      const realiseByNature = await em.query(
        `SELECT nature, SUM(amount_ht)::numeric(16,2) AS montant
           FROM supplier_invoice WHERE chantier_id = $1 GROUP BY nature ORDER BY nature`,
        [chantierId],
      );
      const engageTotal = engageByNature.reduce((a: Decimal, r: { montant: string }) => a.plus(r.montant), new Decimal(0));
      const realiseTotal = realiseByNature.reduce((a: Decimal, r: { montant: string }) => a.plus(r.montant), new Decimal(0));
      return {
        engageByNature,
        realiseByNature,
        engageTotal: engageTotal.toFixed(2),
        realiseTotal: realiseTotal.toFixed(2),
      };
    });
  }

  /**
   * Chaîne des achats d'un chantier, pour l'écran de suivi : demandes de prix et commandes avec
   * leurs lignes, leur statut, leurs bons de livraison et leurs factures fournisseur.
   * L'engagé n'est compté qu'à partir d'une commande validée (cahier §5.8).
   */
  listChain(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);

      const requests = await em.query(
        `SELECT r.id, r.code, r.status, s.name AS supplier_name
           FROM purchase_request r
           LEFT JOIN supplier s ON s.id = r.supplier_id
          WHERE r.chantier_id = $1
          ORDER BY r.created_at DESC`,
        [chantierId],
      );

      const orders = await em.query(
        `SELECT o.id, o.code, o.status, s.name AS supplier_name,
                COALESCE(SUM(l.amount_ht), 0)::numeric(16,2) AS total_ht,
                COUNT(l.id)::int AS lines_count
           FROM purchase_order o
           LEFT JOIN supplier s ON s.id = o.supplier_id
           LEFT JOIN purchase_order_line l ON l.order_id = o.id
          WHERE o.chantier_id = $1
          GROUP BY o.id, o.code, o.status, s.name
          ORDER BY o.created_at DESC`,
        [chantierId],
      );

      const lines = await em.query(
        `SELECT l.id, l.order_id, l.nature, l.designation, l.quantity, l.unit_price, l.amount_ht,
                c.code AS code_analytique
           FROM purchase_order_line l
           JOIN purchase_order o ON o.id = l.order_id
           LEFT JOIN analytical_code c ON c.id = l.code_analytique_id
          WHERE o.chantier_id = $1
          ORDER BY l.created_at`,
        [chantierId],
      );

      const deliveries = await em.query(
        `SELECT d.id, d.order_id, d.code
           FROM delivery_note d
           JOIN purchase_order o ON o.id = d.order_id
          WHERE o.chantier_id = $1
          ORDER BY d.created_at`,
        [chantierId],
      );

      const invoices = await em.query(
        `SELECT i.id, i.order_id, i.code, i.nature, i.amount_ht, i.invoice_date
           FROM supplier_invoice i
          WHERE i.chantier_id = $1
          ORDER BY i.created_at`,
        [chantierId],
      );

      const byOrder = <T extends { order_id: string }>(rows: T[], id: string) =>
        rows.filter((r) => r.order_id === id);

      return {
        requests,
        orders: orders.map((o: { id: string }) => ({
          ...o,
          lines: byOrder(lines, o.id),
          deliveries: byOrder(deliveries, o.id),
          invoices: byOrder(invoices, o.id),
        })),
      };
    });
  }

  private async assertChantier(em: EntityManager, chantierId: string): Promise<void> {
    const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
    if (c.length === 0) {
      throw new NotFoundException(`Unknown chantier "${chantierId}"`);
    }
  }
}
