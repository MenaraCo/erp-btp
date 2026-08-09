import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { loadAppConfig } from '../../config/env.config';
import { TenantContext } from '../tenancy/tenant-context';
import { runInTenant } from '../tenancy/tenant-transaction';
import { PackSubscriptionService } from '../subscriptions/pack-subscription.service';
import { PricingService } from '../pricing/pricing.service';
import type { BillingInterval, BillingTerm } from '../pricing/pricing.calc';
import { EvenementPaiement, PaymentProvider, SessionPaiement } from './payment-provider';
import { FakePaymentProvider } from './fake-payment.provider';

/** Ce qui va être prélevé, tel que l'application le calcule — jamais tel que le client l'annonce. */
export interface DevisPaiement {
  /** Intitulé présenté sur la page de paiement. */
  intitule: string;
  /** Montant de la prochaine échéance, en CENTIMES. */
  montantCentimes: number;
  /** Rythme du prélèvement chez le prestataire. */
  periode: 'month' | 'year';
  lignes: Array<{ libelle: string; jetons: number; prixUnitaire: number; total: number }>;
  /** Mensuel catalogue avant remise d'engagement. */
  mensuelBase: number;
  remisePct: number;
  /** Mensuel réellement facturé (le MRR). */
  mensuelNet: number;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly provider: PaymentProvider,
    private readonly context: TenantContext,
    private readonly packs: PackSubscriptionService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Ce que la société doit payer, calculé À PARTIR DE SA SOUSCRIPTION.
   *
   * Le montant n'est jamais dicté par le navigateur : sinon n'importe quel client pourrait
   * s'abonner à un centime en modifiant la requête. Le prix se déduit du palier, des options et
   * de la formule d'engagement enregistrés en base, par le moteur de tarification — source unique
   * de vérité, partagée avec l'affichage du catalogue.
   */
  async calculerDevis(tenantId: string): Promise<DevisPaiement> {
    const [etat, packs, addons] = await Promise.all([
      this.packs.getState(tenantId),
      this.packs.listPacks(),
      this.packs.listAddons(tenantId),
    ]);
    if (!etat.packCode || etat.packSeats <= 0) {
      throw new BadRequestException(
        'Choisissez d’abord une formule et un nombre de jetons : il n’y a rien à payer.',
      );
    }

    const pack = packs.find((p) => p.code === etat.packCode);
    const lignes: DevisPaiement['lignes'] = [];
    const ajouter = (libelle: string, jetons: number, prixUnitaire: number | null) => {
      if (prixUnitaire == null || jetons <= 0) return;
      lignes.push({
        libelle,
        jetons,
        prixUnitaire,
        total: Math.round(jetons * prixUnitaire * 100) / 100,
      });
    };
    ajouter(pack?.label ?? etat.packCode, etat.packSeats, pack?.priceMonthly ?? null);
    for (const a of addons.filter((x) => x.seats > 0)) {
      ajouter(a.label, a.seats, a.priceMonthly);
    }
    if (lignes.length === 0) {
      // Palier « sur devis » : rien de chiffré, donc rien à prélever automatiquement.
      throw new BadRequestException(
        'Votre formule est tarifée sur devis : le paiement en ligne ne s’applique pas.',
      );
    }

    const [abo] = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT billing_term, billing_interval FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      ),
    );
    const billingTerm = (abo?.billing_term ?? 'monthly') as BillingTerm;
    const billingInterval = (abo?.billing_interval ?? 'monthly') as BillingInterval;

    const prix = await this.pricing.compute({
      lines: lignes.map((l) => ({ seats: l.jetons, unitPrice: l.prixUnitaire })),
      billingTerm,
      billingInterval,
    });
    const periode: 'month' | 'year' = billingInterval === 'yearly' ? 'year' : 'month';
    const jetonsTotal = lignes.reduce((n, l) => n + l.jetons, 0);

    return {
      intitule: `${pack?.label ?? etat.packCode} — ${jetonsTotal} jeton${jetonsTotal > 1 ? 's' : ''}`,
      // L'argent se compte en centimes entiers : jamais de flottant transmis au prestataire.
      montantCentimes: Math.round(prix.amountPerInvoice * 100),
      periode,
      lignes,
      mensuelBase: prix.monthlyBase,
      remisePct: prix.termDiscountPct,
      mensuelNet: prix.monthlyNet,
    };
  }

  /**
   * Ouvre une page de paiement pour la société courante et renvoie l'adresse de redirection.
   *
   * Rien n'est modifié ici : tant que le prestataire n'a pas confirmé par webhook, l'abonnement
   * reste dans l'état où il était. Un client qui abandonne la page de paiement ne doit pas
   * repartir avec un abonnement actif.
   */
  async creerSession(): Promise<SessionPaiement & { devis: DevisPaiement }> {
    const tenantId = this.context.requireTenantId();
    const email = this.context.getEmail() ?? '';
    const devis = await this.calculerDevis(tenantId);

    const [abo] = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT provider_customer_id FROM subscription WHERE tenant_id = $1`, [tenantId]),
    );

    const session = await this.provider.creerSession({
      tenantId,
      email,
      intitule: devis.intitule,
      montantCentimes: devis.montantCentimes,
      periode: devis.periode,
      providerCustomerId: abo?.provider_customer_id ?? null,
    });
    return { ...session, devis };
  }

  /** Le prestataire réellement actif — l'écran d'abonnement en dépend pour s'annoncer honnêtement. */
  estFictif(): boolean {
    return loadAppConfig().payment.provider !== 'stripe';
  }

  /**
   * Banc d'essai : fabrique l'événement que le prestataire enverrait, et le fait passer par le
   * CHEMIN RÉEL — signature comprise. Sans cela, on ne pourrait éprouver le retour de paiement
   * qu'avec un vrai compte, une vraie carte et un tunnel vers la machine locale.
   *
   * Deux verrous, car un tel raccourci ouvrirait l'abonnement gratuit à qui le trouverait :
   * il n'existe qu'avec le prestataire de substitution, et jamais en production.
   */
  async simuler(type: 'paiement_reussi' | 'paiement_echoue' | 'abonnement_annule') {
    const conf = loadAppConfig().payment;
    if (conf.provider === 'stripe' || process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'La simulation de paiement n’existe qu’avec le prestataire de substitution, hors production.',
      );
    }
    const tenantId = this.context.requireTenantId();
    const dansUnMois = new Date();
    dansUnMois.setMonth(dansUnMois.getMonth() + 1);

    const corps = {
      // Identifiant unique : rejouer deux fois le même serait ignoré par l'idempotence.
      id: `fake_evt_${randomUUID()}`,
      type,
      tenantId,
      providerCustomerId: `cus_fictif_${tenantId.slice(0, 8)}`,
      providerSubscriptionId: `sub_fictif_${tenantId.slice(0, 8)}`,
      periodeFin: type === 'paiement_reussi' ? dansUnMois.toISOString() : null,
    };
    const brut = Buffer.from(JSON.stringify(corps), 'utf8');
    const signature = FakePaymentProvider.signer(brut, conf.webhookSecret || undefined);

    // On repasse par la vérification de signature : c'est le chemin de production qui est
    // éprouvé, pas un raccourci parallèle qui pourrait diverger sans qu'on le voie.
    const evt = await this.provider.lireEvenement(brut, signature);
    const { applique } = await this.appliquer(evt, corps);
    return { applique, evenement: evt.id, type: evt.type };
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

      let etaitIncomplete = false;
      if (evt.type !== 'ignore' && evt.tenantId) {
        // `subscription` est sous Row-Level Security, et le webhook arrive SANS contexte de
        // société. On pose donc le tenant désigné par l'événement signé, sur cette transaction
        // uniquement (`set_config(..., true)`), sinon la mise à jour ne verrait aucune ligne et
        // échouerait en silence — l'abonnement resterait bloqué malgré un paiement encaissé.
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [evt.tenantId]);
        const avant = (await runner.query(
          `SELECT status FROM subscription WHERE tenant_id = $1`,
          [evt.tenantId],
        )) as Array<{ status: string }>;
        etaitIncomplete = avant[0]?.status === 'incomplete';
        await this.appliquerEtat(runner, evt);
      }
      await runner.commitTransaction();
      // Une souscription née d'une inscription attendait ce paiement pour s'ouvrir : c'est ici,
      // et nulle part ailleurs, que ses modules deviennent réellement accessibles.
      if (evt.type === 'paiement_reussi' && evt.tenantId) {
        await this.ouvrirLesModules(evt.tenantId, etaitIncomplete);
      }
      return { applique: evt.type !== 'ignore' };
    } catch (e) {
      await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }
  }

  /**
   * Ouvre les droits après un paiement encaissé.
   *
   * La projection commerciale → droits reste l'affaire de `reproject`, seule écriture autorisée
   * de `tenant_module` : on ne recopie pas sa logique ici, on la rappelle une fois l'abonnement
   * passé en `active`.
   *
   * Au TOUT PREMIER paiement seulement, le compte fondateur reçoit un jeton sur chaque module
   * ouvert — sans quoi le client vient de payer et se retrouve devant une application vide. Aux
   * renouvellements, rien à faire : les jetons sont déjà répartis, et y toucher écraserait les
   * décisions de l'administrateur.
   */
  private async ouvrirLesModules(tenantId: string, premierPaiement: boolean): Promise<void> {
    await runInTenant(this.dataSource, tenantId, async (em) => {
      await this.packs.reproject(em, tenantId);
      if (!premierPaiement) return;
      await em.query(
        `INSERT INTO seat_assignment (tenant_id, module_code, user_id)
         SELECT $1, tm.module_code, f.id
           FROM tenant_module tm
           CROSS JOIN (
             SELECT id FROM user_account
              WHERE tenant_id = $1 AND deleted_at IS NULL
              ORDER BY created_at LIMIT 1
           ) f
          WHERE tm.active = true
            AND tm.seats_purchased > 0
            AND NOT EXISTS (
              SELECT 1 FROM seat_assignment sa
               WHERE sa.module_code = tm.module_code AND sa.user_id = f.id
            )`,
        [tenantId],
      );
    });
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
