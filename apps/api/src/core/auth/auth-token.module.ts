import { Module } from '@nestjs/common';
import { AuthTokenService } from './auth-token.service';

/** Leaf module: token sign/verify only, no tenancy dependency (avoids a DI cycle). */
@Module({
  providers: [AuthTokenService],
  exports: [AuthTokenService],
})
export class AuthTokenModule {}
