import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantContext } from '../tenancy/tenant-context';
import { AuthService } from './auth.service';

interface LoginDto {
  email?: string;
  password?: string;
  totp?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly context: TenantContext,
  ) {}

  /** Tenant is resolved by the middleware (sub-domain / X-Tenant-Id); credentials in the body. */
  @Post('login')
  login(@Body() body: LoginDto) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password are required');
    }
    const tenantId = this.context.requireTenantId();
    return this.auth.login(tenantId, body.email, body.password, body.totp);
  }

  /** Enables MFA for the authenticated user (Bearer token sets the user in context). */
  @Post('mfa/enable')
  enableMfa() {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.auth.enableMfa(tenantId, userId);
  }
}
