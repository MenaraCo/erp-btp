import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantContext } from '../tenancy/tenant-context';
import { AuthService } from './auth.service';
import {
  RegistrationService,
  type RegisterInput,
} from './registration.service';

interface LoginDto {
  email?: string;
  password?: string;
  totp?: string;
}

type RegisterDto = Partial<RegisterInput>;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
    private readonly context: TenantContext,
  ) {}

  /**
   * Public sign-up (cahier §3.3) — two entry doors. `mode: 'trial'` starts the 30-day trial
   * (all modules); `mode: 'direct'` creates a paid subscription for the chosen modules. Creates
   * the tenant + admin user and returns an access token (auto-login). Tenant-less by design —
   * excluded from the tenant middleware in AppModule.
   */
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.registration.register({
      companyName: body.companyName ?? '',
      fullName: body.fullName ?? '',
      email: body.email ?? '',
      password: body.password ?? '',
      mode: body.mode === 'direct' ? 'direct' : 'trial',
      modules: body.modules,
    });
  }

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
