import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { TenantMiddleware } from '../../src/core/tenancy/tenant.middleware';
import { AuthModule } from '../../src/core/auth/auth.module';
import { AuthService } from '../../src/core/auth/auth.service';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

@Module({
  imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), TenancyModule, AuthModule],
})
class AuthTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('Auth — login', () => {
  let app: INestApplication;
  let ds: DataSource;
  let auth: AuthService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [AuthTestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    auth = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('renvoie un access token avec des identifiants valides', async () => {
    const tenant = await createTenant(ds, 'Login');
    const userId = await createUser(ds, tenant.id, 'user@login.test');
    await auth.setPassword(tenant.id, userId, 'S3cret!');

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenant.id)
      .send({ email: 'user@login.test', password: 'S3cret!' })
      .expect(201);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.split('.')).toHaveLength(3);
  });

  it('rejette (401) un mot de passe incorrect', async () => {
    const tenant = await createTenant(ds, 'LoginBad');
    const userId = await createUser(ds, tenant.id, 'user@loginbad.test');
    await auth.setPassword(tenant.id, userId, 'S3cret!');

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenant.id)
      .send({ email: 'user@loginbad.test', password: 'wrong' })
      .expect(401);
  });

  it('rejette (400) sans tenant résolu', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'localhost')
      .send({ email: 'x@y.z', password: 'x' })
      .expect(400);
  });
});
