import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthTokenModule } from './auth-token.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/** First-party authentication: login, password and TOTP MFA. */
@Module({
  imports: [TenancyModule, AuthTokenModule],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
