import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { AuthModule } from '../../src/core/auth/auth.module';
import { AuthService } from '../../src/core/auth/auth.service';
import { totp } from '../../src/core/auth/totp.util';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

describe('Auth — MFA (TOTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let auth: AuthService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), TenancyModule, AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    auth = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('activation en 2 temps, puis login par TOTP ou code de secours', async () => {
    const tenant = await createTenant(ds, 'Mfa');
    const userId = await createUser(ds, tenant.id, 'user@mfa.test');
    await auth.setPassword(tenant.id, userId, 'S3cret!');

    // Étape 1 : secret (pas encore actif) → le login ne réclame PAS de code.
    const { secret } = await auth.setupMfa(tenant.id, userId);
    expect(await auth.login(tenant.id, 'user@mfa.test', 'S3cret!')).toHaveProperty('accessToken');

    // Étape 2 : confirmation → 2FA active + 10 codes de secours.
    const { recoveryCodes } = await auth.confirmMfa(tenant.id, userId, totp(secret));
    expect(recoveryCodes).toHaveLength(10);

    // Sans code → défi MFA (pas de jeton).
    expect(await auth.login(tenant.id, 'user@mfa.test', 'S3cret!')).toEqual({ mfaRequired: true });

    // Code invalide → rejeté.
    await expect(
      auth.login(tenant.id, 'user@mfa.test', 'S3cret!', '000000'),
    ).rejects.toThrow();

    // TOTP valide → jeton.
    expect(await auth.login(tenant.id, 'user@mfa.test', 'S3cret!', totp(secret))).toHaveProperty(
      'accessToken',
    );

    // Code de secours : fonctionne une fois, puis rejeté (usage unique).
    expect(
      await auth.login(tenant.id, 'user@mfa.test', 'S3cret!', recoveryCodes[0]),
    ).toHaveProperty('accessToken');
    await expect(
      auth.login(tenant.id, 'user@mfa.test', 'S3cret!', recoveryCodes[0]),
    ).rejects.toThrow();
  });
});
