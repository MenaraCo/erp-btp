import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthTokenModule } from './auth-token.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { RbacModule } from '../rbac/rbac.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { AuthController } from './auth.controller';

/** First-party authentication: public sign-up (two doors), login, password and TOTP MFA. */
@Module({
  imports: [
    TenancyModule,
    AuthTokenModule,
    SubscriptionsModule,
    RbacModule,
    EntitlementsModule,
  ],
  providers: [AuthService, RegistrationService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
