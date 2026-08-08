import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthTokenModule } from './auth-token.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { RbacModule } from '../rbac/rbac.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromoModule } from '../promo/promo.module';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { AuthController } from './auth.controller';

/**
 * First-party authentication: public sign-up (two doors), login, password and TOTP MFA.
 *
 * Seul module à porter une limitation de débit, parce qu'il est le seul VRAIMENT public :
 * connexion et inscription s'atteignent sans jeton ni tenant. Sans plafond, rien n'empêche
 * d'éprouver des mots de passe en boucle ni de créer des sociétés à la chaîne.
 *
 * Le plafond est déclaré ici plutôt qu'au niveau de l'application : l'appliquer partout
 * étranglerait les écrans denses (data-grids, tableaux analytiques) qui tirent légitimement
 * beaucoup de requêtes.
 */
@Module({
  imports: [
    // 5 requêtes par minute et par IP — de quoi se tromper deux fois de mot de passe sans gêne,
    // pas de quoi en essayer mille.
    ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 5 }]),
    TenancyModule,
    AuthTokenModule,
    SubscriptionsModule,
    RbacModule,
    EntitlementsModule,
    PricingModule,
    PromoModule,
  ],
  providers: [AuthService, RegistrationService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
