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

  it('quand la MFA est activée, le login exige un code TOTP valide', async () => {
    const tenant = await createTenant(ds, 'Mfa');
    const userId = await createUser(ds, tenant.id, 'user@mfa.test');
    await auth.setPassword(tenant.id, userId, 'S3cret!');
    const { secret } = await auth.enableMfa(tenant.id, userId);

    // Without a code -> rejected.
    await expect(
      auth.login(tenant.id, 'user@mfa.test', 'S3cret!'),
    ).rejects.toThrow();

    // With a valid code -> token issued.
    const result = await auth.login(
      tenant.id,
      'user@mfa.test',
      'S3cret!',
      totp(secret),
    );
    expect(typeof result.accessToken).toBe('string');
  });
});
