import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { toDataURL } from 'qrcode';
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

/** Écran de connexion : e-mail seul, pour peupler la liste des sociétés rattachées. */
class CompaniesDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email!: string;
}

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

  /**
   * Sociétés rattachées à un e-mail, pour l'écran de connexion : l'utilisateur saisit son e-mail
   * puis choisit sa société dans la liste renvoyée (au lieu de retaper un nom/slug). Tenant-less
   * par nature (exclu du middleware dans AppModule) : on ne connaît pas encore la société.
   */
  @Post('companies')
  companies(@Body() body: CompaniesDto) {
    return this.auth
      .companiesForEmail(body.email)
      .then((companies) => ({ companies }));
  }

  /** Tenant is resolved by the middleware (sub-domain / X-Tenant-Id); credentials in the body. */
  @Post('login')
  login(@Body() body: LoginDto) {
    // Plus de contrôle à la main : le ValidationPipe a déjà rejeté ce qui n'allait pas.
    const tenantId = this.context.requireTenantId();
    return this.auth.login(tenantId, body.email, body.password, body.totp);
  }

  /** État de la 2FA du compte connecté (activée ou non). */
  @Get('mfa/status')
  mfaStatus() {
    return this.auth.getMfaStatus(this.tenantId(), this.userId());
  }

  /**
   * Étape 1 de l'activation : génère un secret (pas encore actif) et renvoie l'URI otpauth + un
   * QR code (data-URI) prêt à scanner. Le QR est produit côté serveur — pas de dépendance au front.
   */
  @Post('mfa/setup')
  async mfaSetup() {
    const { secret, otpauthUri } = await this.auth.setupMfa(this.tenantId(), this.userId());
    const qrDataUri = await toDataURL(otpauthUri, { margin: 1, width: 220 });
    return { secret, otpauthUri, qrDataUri };
  }

  /** Étape 2 : confirme avec un code, active la 2FA et renvoie les codes de secours (une fois). */
  @Post('mfa/confirm')
  mfaConfirm(@Body() body: { code?: string }) {
    if (!body?.code) throw new BadRequestException('Le code est requis.');
    return this.auth.confirmMfa(this.tenantId(), this.userId(), body.code);
  }

  // La 2FA est obligatoire (exigée dès la souscription) : aucun endpoint de désactivation n'est
  // exposé. On peut seulement la reconfigurer (setup + confirm) pour changer d'appareil.

  private tenantId(): string {
    return this.context.requireTenantId();
  }

  private userId(): string {
    const userId = this.context.getUserId();
    if (!userId) throw new UnauthorizedException('Authentication required');
    return userId;
  }
}
