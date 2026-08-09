import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { loadAppConfig } from '../../config/env.config';
import { TenantContext } from '../tenancy/tenant-context';
import { runInTenant } from '../tenancy/tenant-transaction';
import { EvenementPaiement, PaymentProvider, SessionPaiement } from './payment-provider';

/** Ce que l'abonné a choisi, et que l'on s'apprête à faire payer. */
export interface DemandeSouscription {
  intitule: string;
  montantCentimes: number;
  periode: 'month' | 'year';
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly provider: PaymentProvider,
    private readonly context: TenantContext,
  ) {}

  /**
   * Ouvre une page de paiement pour la société courante et renvoie l'adresse de redirection.
   *
   * Rien n'est modifié ici : tant que le prestataire n'a pas confirmé par webhook, l'abonnement
   * reste dans l'état où il était. Un client qui abandonne la page de paiement ne doit pas
   * repartir avec un abonnement actif.
   */
  async creerSession(demande: DemandeSouscription): Promise<SessionPaiement> {
    if (!Number.isInteger(demande.montantCentimes) || demande.montantCentimes <= 0) {
      throw new BadRequestException('Montant de souscription invalide.');
    }
    const tenantId = this.context.requireTenantId();
    const email = this.context.getEmail() ?? '';

    const [abo] = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT provider_customer_id FROM subscription WHERE tenant_id = $1`, [tenantId]),
    );

    return this.provider.creerSession({
      tenantId,
      email,
      intitule: demande.intitule,
      montantCentimes: demande.montantCentimes,
      periode: demande.periode,
      providerCustomerId: abo?.provider_customer_id ?? null,
    });
  }

  /**
   * Applique un événement du prestataire.
   *
   * Deux garde-fous. L'IDEMPOTENCE d'abord : le prestataire rejoue ses webhooks, et un
   * « paiement réussi » traité deux fois prolongerait l'abonnement en double. L'insertion du
   * journal sert de verrou — si l'identifiant existe déjà, on s'arrête là.
   *
   * L'écriture ensuite : journal et changement d'état dans la MÊME transaction. Autrement un
   * incident entre les deux laisserait l'événement marqué comme traité alors qu'il ne l'est pas,
   * et le renvoi du prestataire serait ignoré — l'abonnement resterait bloqué.
   */
  async appliquer(evt: EvenementPaiement, corps: unknown): Promise<{ applique: boolean }> {
    const provider = loadAppConfig().payment.provider;

    // Hors contexte de société : le webhook arrive sans en-tête de tenant, c'est son contenu qui
    // le désigne. On travaille donc sur une connexion sans RLS, table de plateforme.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const insere = await runner.query(
        `INSERT INTO payment_event (provider, provider_event_id, type, type_brut, tenant_id, corps)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (provider_event_id) DO NOTHING
         RETURNING id`,
        [provider, evt.id, evt.type, evt.typeBrut, evt.tenantId, JSON.stringify(corps ?? null)],
      );
      if (insere.length === 0) {
        await runner.commitTransaction();
        this.logger.log(`Événement ${evt.id} déjà traité — ignoré.`);
        return { applique: false };
      }

      if (evt.type !== 'ignore' && evt.tenantId) {
        // `subscription` est sous Row-Level Security, et le webhook arrive SANS contexte de
        // société. On pose donc le tenant désigné par l'événement signé, sur cette transaction
        // uniquement (`set_config(..., true)`), sinon la mise à jour ne verrait aucune ligne et
        // échouerait en silence — l'abonnement resterait bloqué malgré un paiement encaissé.
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [evt.tenantId]);
        await this.appliquerEtat(runner, evt);
      }
      await runner.commitTransaction();
      return { applique: evt.type !== 'ignore' };
    } catch (e) {
      await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }
  }

  /**
   * Traduit l'événement en changement d'état de l'abonnement.
   *
   * Un échec de prélèvement met en `past_due`, il NE COUPE PAS l'accès : une carte expirée est un
   * incident courant, et fermer le chantier d'un client pour cela serait disproportionné. La
   * coupure relève d'une décision, prise depuis le back-office éditeur.
   */
  private async appliquerEtat(
    runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    evt: EvenementPaiement,
  ): Promise<void> {
    if (evt.type === 'paiement_reussi') {
      await runner.query(
        `UPDATE subscription
            SET status = 'active',
                provider_customer_id     = COALESCE($2, provider_customer_id),
                provider_subscription_id = COALESCE($3, provider_subscription_id),
                current_period_end       = COALESCE($4, current_period_end),
                updated_at = now()
          WHERE tenant_id = $1`,
        [evt.tenantId, evt.providerCustomerId, evt.providerSubscriptionId, evt.periodeFin],
      );
      return;
    }
    if (evt.type === 'paiement_echoue') {
      await runner.query(
        `UPDATE subscription SET status = 'past_due', updated_at = now() WHERE tenant_id = $1`,
        [evt.tenantId],
      );
      return;
    }
    if (evt.type === 'abonnement_annule') {
      await runner.query(
        `UPDATE subscription SET status = 'canceled', updated_at = now() WHERE tenant_id = $1`,
        [evt.tenantId],
      );
    }
  }
}
