import {
  Body,
  Controller,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TenantContext } from '../tenancy/tenant-context';
import { AuthService } from './auth.service';
import {
  RegistrationService,
  type RegisterInput,
} from './registration.service';

/**
 * Premier DTO réellement validé (class-validator + ValidationPipe global).
 *
 * Une CLASSE, pas une interface : les décorateurs ont besoin d'exister à l'exécution. Le pipe
 * rejette la requête avant qu'elle n'atteigne le contrôleur, et le message dit précisément quel
 * champ cloche — là où le contrôle à la main renvoyait « email and password are required ».
 */
class LoginDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email!: string;

  // Pas de longueur minimale ICI : c'est une règle de CRÉATION de mot de passe. L'imposer à la
  // connexion rejetterait les comptes antérieurs à la règle, et renseignerait un attaquant sur
  // la politique en vigueur.
  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est requis.' })
  password!: string;

  /** Code TOTP, seulement si la double authentification est activée sur le compte. */
  @IsOptional()
  @IsString()
  totp?: string;
}

type RegisterDto = Partial<RegisterInput>;

/**
 * Routes publiques par nature : elles s'atteignent sans jeton. La garde de débit s'applique donc
 * ici, et seulement ici — voir AuthModule pour le plafond retenu.
 */
@UseGuards(ThrottlerGuard)
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
      packCode: body.packCode,
      packSeats: body.packSeats,
      addons: body.addons,
      billingTerm: body.billingTerm === 'annual' ? 'annual' : 'monthly',
      billingInterval: body.billingInterval === 'yearly' ? 'yearly' : 'monthly',
      promoCode: body.promoCode ?? null,
    });
  }

  /** Tenant is resolved by the middleware (sub-domain / X-Tenant-Id); credentials in the body. */
  @Post('login')
  login(@Body() body: LoginDto) {
    // Plus de contrôle à la main : le ValidationPipe a déjà rejeté ce qui n'allait pas.
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
