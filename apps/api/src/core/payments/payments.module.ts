import { Module } from '@nestjs/common';
import { loadAppConfig } from '../../config/env.config';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PricingModule } from '../pricing/pricing.module';
import { PaymentProvider } from './payment-provider';
import { FakePaymentProvider } from './fake-payment.provider';
import { StripePaymentProvider } from './stripe-payment.provider';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

/**
 * Paiement des abonnements (cahier §3.7 A) — par REDIRECTION, jamais de carte saisie chez nous.
 *
 * Le prestataire est choisi à la configuration. Par défaut c'est l'implémentation de
 * substitution : développement et tests ne doivent dépendre d'aucun service externe ni d'aucune
 * clé. On ne bascule sur Stripe qu'en le demandant explicitement — et le démarrage échoue alors
 * si les secrets manquent, plutôt que de laisser croire que les paiements fonctionnent.
 */
@Module({
  // Le prix ne se recopie pas ici : il se demande au moteur de tarification et à la souscription,
  // pour qu'un montant affiché, un montant facturé et un MRR ne puissent jamais diverger.
  imports: [TenancyModule, SubscriptionsModule, PricingModule],
  providers: [
    {
      provide: PaymentProvider,
      useFactory: () => {
        const conf = loadAppConfig().payment;
        if (conf.provider !== 'stripe') return new FakePaymentProvider();
        if (!conf.secretKey || !conf.webhookSecret) {
          throw new Error(
            'PAYMENT_PROVIDER=stripe exige STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET. '
            + 'Ces secrets se placent dans l’environnement, jamais dans le dépôt.',
          );
        }
        return new StripePaymentProvider();
      },
    },
    PaymentsService,
  ],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
