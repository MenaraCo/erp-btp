import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';

export interface RegleValidation {
  id: string;
  chantierId: string | null;
  montantMin: string;
  validatorId: string;
  validateur: string | null;
}

/**
 * Validation des achats : qui engage l'entreprise, et jusqu'à quel montant.
 *
 * Sans seuil, une commande de 80 000 € part aussi facilement qu'une caisse de gants. Les règles
 * disent « au-delà de tel montant, telle personne doit approuver ». Elles se posent au niveau de
 * la société et se précisent chantier par chantier — un chantier sensible peut exiger davantage
 * sans qu'on refasse le paramétrage général.
 *
 * Règle de lecture : dès qu'un chantier a SES propres règles, elles remplacent celles de la
 * société. Cumuler les deux rendrait le paramétrage imprévisible — on ne saurait plus, en
 * regardant l'écran du chantier, qui doit signer.
 */
@Injectable()
export class ValidationAchatsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Règles d'un périmètre : celles du chantier, ou celles de la société à défaut. */
  regles(chantierId: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => this.reglesEnCours(em, chantierId));
  }

  /** Toutes les règles paramétrées, société et chantiers — pour l'écran de configuration. */
  toutesLesRegles(chantierId: string | null) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [];
      const filtre = chantierId
        ? (params.push(chantierId), `WHERE r.chantier_id = $1`)
        : `WHERE r.chantier_id IS NULL`;
      const rows = await em.query(
        `SELECT r.id, r.chantier_id, r.montant_min, r.validator_id,
                trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS validateur,
                u.email AS validateur_email
           FROM purchase_approval_rule r
           JOIN user_account u ON u.id = r.validator_id
           ${filtre}
          ORDER BY r.montant_min ASC`,
        params,
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        chantierId: (r.chantier_id as string | null) ?? null,
        montantMin: String(r.montant_min),
        validatorId: r.validator_id as string,
        validateur: (r.validateur as string)?.trim() || (r.validateur_email as string),
      }));
    });
  }

  ajouterRegle(input: { chantierId?: string | null; montantMin: string | number; validatorId: string }) {
    const tenantId = this.context.requireTenantId();
    const seuil = new Decimal(input.montantMin ?? 0);
    if (seuil.isNegative()) throw new BadRequestException('Le seuil ne peut pas être négatif.');
    if (!input.validatorId) throw new BadRequestException('Choisissez un validateur.');
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const u = await em.query(
        `SELECT id FROM user_account WHERE id = $1 AND deleted_at IS NULL`, [input.validatorId],
      );
      if (u.length === 0) throw new NotFoundException('Utilisateur introuvable.');
      const rows = await em.query(
        `INSERT INTO purchase_approval_rule (tenant_id, chantier_id, montant_min, validator_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, chantier_id, montant_min, validator_id) DO NOTHING
         RETURNING id`,
        [tenantId, input.chantierId ?? null, seuil.toFixed(2), input.validatorId],
      );
      if (rows.length === 0) {
        throw new ConflictException('Cette règle existe déjà.');
      }
      return { id: rows[0].id as string };
    });
  }

  supprimerRegle(id: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = returningRows<{ id: string }>(
        await em.query(`DELETE FROM purchase_approval_rule WHERE id = $1 RETURNING id`, [id]),
      );
      if (rows.length === 0) throw new NotFoundException('Règle introuvable.');
      return { deleted: true as const };
    });
  }

  /**
   * Soumet une commande : elle part directement si aucun seuil n'est franchi, sinon elle attend
   * ses validateurs. C'est le montant TOTAL de la commande qui décide — découper une commande
   * pour passer sous un seuil resterait possible, mais deviendrait visible dans le registre.
   */
  soumettre(orderId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const commande = await this.lire(em, orderId);
      if (commande.status !== 'draft') {
        throw new ConflictException('Seule une commande en brouillon peut être envoyée.');
      }
      const lignes = await em.query(
        `SELECT COUNT(*)::int AS n FROM purchase_order_line WHERE order_id = $1`, [orderId],
      );
      if (lignes[0].n === 0) {
        throw new BadRequestException('Une commande vide ne s’envoie pas.');
      }

      const requis = await this.validateursRequis(em, commande.chantier_id, commande.total_ht);
      if (requis.length === 0) {
        await em.query(
          `UPDATE purchase_order
              SET status = 'validated', validated_at = now(), submitted_at = now(), updated_at = now()
            WHERE id = $1`,
          [orderId],
        );
        await this.journal(em, tenantId, orderId, 'validated');
        return { statut: 'validated' as const, validateurs: [] as string[] };
      }

      await em.query(
        `UPDATE purchase_order
            SET status = 'pending_approval', submitted_at = now(), updated_at = now()
          WHERE id = $1`,
        [orderId],
      );
      await this.journal(em, tenantId, orderId, 'submitted');
      return { statut: 'pending_approval' as const, validateurs: requis.map((r) => r.validateur) };
    });
  }

  /** Approuve ou refuse. Un refus ramène la commande en brouillon, avec son motif. */
  decider(orderId: string, decision: 'approved' | 'rejected', motif: string | null) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId();
    if (!userId) throw new ForbiddenException('Authentification requise.');
    if (decision === 'rejected' && !(motif ?? '').trim()) {
      throw new BadRequestException('Indiquez pourquoi la commande est refusée.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const commande = await this.lire(em, orderId);
      if (commande.status !== 'pending_approval') {
        throw new ConflictException('Cette commande n’attend pas de validation.');
      }
      const requis = await this.validateursRequis(em, commande.chantier_id, commande.total_ht);
      if (!requis.some((r) => r.validatorId === userId)) {
        throw new ForbiddenException('Vous n’êtes pas désigné pour valider cette commande.');
      }

      await em.query(
        `INSERT INTO purchase_approval (tenant_id, order_id, validator_id, decision, motif)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, orderId, userId, decision, (motif ?? '').trim() || null],
      );

      if (decision === 'rejected') {
        await em.query(
          `UPDATE purchase_order SET status = 'draft', submitted_at = NULL, updated_at = now()
            WHERE id = $1`,
          [orderId],
        );
        await this.journal(em, tenantId, orderId, 'rejected', motif);
        return { statut: 'draft' as const, manquants: [] as string[] };
      }

      // Tous les validateurs requis doivent s'être prononcés depuis la dernière soumission.
      const approuves: Array<{ validator_id: string }> = await em.query(
        `SELECT DISTINCT a.validator_id
           FROM purchase_approval a
           JOIN purchase_order o ON o.id = a.order_id
          WHERE a.order_id = $1 AND a.decision = 'approved'
            AND (o.submitted_at IS NULL OR a.created_at >= o.submitted_at)`,
        [orderId],
      );
      const faits = new Set(approuves.map((a) => a.validator_id));
      const manquants = requis.filter((r) => !faits.has(r.validatorId));
      if (manquants.length > 0) {
        await this.journal(em, tenantId, orderId, 'approved', motif);
        return { statut: 'pending_approval' as const, manquants: manquants.map((m) => m.validateur) };
      }

      await em.query(
        `UPDATE purchase_order SET status = 'validated', validated_at = now(), updated_at = now()
          WHERE id = $1`,
        [orderId],
      );
      await this.journal(em, tenantId, orderId, 'approved', motif);
      await this.journal(em, tenantId, orderId, 'validated');
      return { statut: 'validated' as const, manquants: [] as string[] };
    });
  }

  /** Où en est la validation d'une commande : qui doit signer, qui a signé. */
  etat(orderId: string) {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const commande = await this.lire(em, orderId);
      const requis = await this.validateursRequis(em, commande.chantier_id, commande.total_ht);
      const decisions = await em.query(
        `SELECT a.validator_id, a.decision, a.motif, a.created_at,
                trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS validateur,
                u.email AS validateur_email
           FROM purchase_approval a
           JOIN user_account u ON u.id = a.validator_id
          WHERE a.order_id = $1
          ORDER BY a.created_at DESC`,
        [orderId],
      );
      const faits = new Set(
        decisions.filter((d: { decision: string }) => d.decision === 'approved')
          .map((d: { validator_id: string }) => d.validator_id),
      );
      return {
        requis,
        manquants: requis.filter((r) => !faits.has(r.validatorId)),
        decisions,
        peutValider: Boolean(userId) && requis.some((r) => r.validatorId === userId),
      };
    });
  }

  /**
   * Validateurs requis pour un montant : les règles du chantier si le chantier en a, sinon celles
   * de la société. Seuls les seuils atteints comptent.
   */
  private async validateursRequis(
    em: EntityManager,
    chantierId: string,
    total: string,
  ): Promise<Array<{ validatorId: string; validateur: string; montantMin: string }>> {
    const regles = await this.reglesEnCours(em, chantierId);
    const montant = new Decimal(total ?? 0);
    const atteintes = regles.filter((r) => montant.greaterThanOrEqualTo(r.montantMin));
    // Une même personne désignée à deux seuils ne signe qu'une fois.
    const parPersonne = new Map<string, { validatorId: string; validateur: string; montantMin: string }>();
    for (const r of atteintes) {
      parPersonne.set(r.validatorId, {
        validatorId: r.validatorId,
        validateur: r.validateur ?? '',
        montantMin: r.montantMin,
      });
    }
    return [...parPersonne.values()];
  }

  private async reglesEnCours(
    em: EntityManager,
    chantierId: string | null,
  ): Promise<RegleValidation[]> {
    const lire = async (filtre: string, params: unknown[]) => em.query(
      `SELECT r.id, r.chantier_id, r.montant_min, r.validator_id,
              trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS validateur,
              u.email AS validateur_email
         FROM purchase_approval_rule r
         JOIN user_account u ON u.id = r.validator_id AND u.deleted_at IS NULL
        ${filtre}
        ORDER BY r.montant_min ASC`,
      params,
    );

    let rows: Array<Record<string, unknown>> = [];
    if (chantierId) rows = await lire('WHERE r.chantier_id = $1', [chantierId]);
    if (rows.length === 0) rows = await lire('WHERE r.chantier_id IS NULL', []);

    return rows.map((r) => ({
      id: r.id as string,
      chantierId: (r.chantier_id as string | null) ?? null,
      montantMin: String(r.montant_min),
      validatorId: r.validator_id as string,
      validateur: ((r.validateur as string) || '').trim() || (r.validateur_email as string),
    }));
  }

  private async lire(em: EntityManager, orderId: string) {
    const rows = await em.query(
      `SELECT id, chantier_id, status, total_ht FROM purchase_order WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (rows.length === 0) throw new NotFoundException(`Unknown purchase order "${orderId}"`);
    return rows[0] as { id: string; chantier_id: string; status: string; total_ht: string };
  }

  private journal(
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
}
