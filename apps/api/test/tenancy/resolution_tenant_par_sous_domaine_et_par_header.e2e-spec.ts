import {
  Controller,
  Get,
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
import { TenantContext } from '../../src/core/tenancy/tenant-context';
import { createTestDataSource, createTenant } from '../support/datasource';

@Controller()
class ProbeController {
  constructor(private readonly ctx: TenantContext) {}

  @Get('whoami')
  whoami() {
    return { tenantId: this.ctx.getTenantId() ?? null };
  }

  @Get('public/ping')
  ping() {
    return { ok: true };
  }
}

@Module({
  imports: [TypeOrmModule.forRoot(buildTypeOrmOptions()), TenancyModule],
  controllers: [ProbeController],
})
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).exclude('public/ping').forRoutes('*');
  }
}

describe('Résolution du tenant (sous-domaine + header)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenant: { id: string; slug: string };
  let other: { id: string; slug: string };

  beforeAll(async () => {
    ds = await createTestDataSource();
    tenant = await createTenant(ds, 'Acme');
    other = await createTenant(ds, 'Other');

    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('résout le tenant par sous-domaine', async () => {
    const res = await request(app.getHttpServer())
      .get('/whoami')
      .set('Host', `${tenant.slug}.localhost`)
      .expect(200);
    expect(res.body.tenantId).toBe(tenant.id);
  });

  it('résout le tenant par header X-Tenant-Id', async () => {
    const res = await request(app.getHttpServer())
      .get('/whoami')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', other.id)
      .expect(200);
    expect(res.body.tenantId).toBe(other.id);
  });

  it('le sous-domaine est prioritaire sur le header', async () => {
    const res = await request(app.getHttpServer())
      .get('/whoami')
      .set('Host', `${tenant.slug}.localhost`)
      .set('X-Tenant-Id', other.id)
      .expect(200);
    expect(res.body.tenantId).toBe(tenant.id);
  });

  it('résout l’entreprise par son NOM, pas seulement par le slug', async () => {
    // À l'inscription, le slug est DÉRIVÉ du nom de société (normalisé) et jamais choisi :
    // au login, l'utilisateur ne connaît que le nom. La résolution doit donc l'accepter.
    const [row] = await ds.query(
      `INSERT INTO tenant (slug, name) VALUES ('ma-societe-btp', 'Ma Société BTP') RETURNING id`,
    );
    for (const saisie of ['Ma Société BTP', 'ma societe btp', 'ma-societe-btp']) {
      const res = await request(app.getHttpServer())
        .get('/whoami')
        .set('Host', 'localhost')
        .set('X-Tenant-Slug', saisie)
        .expect(200);
      expect(res.body.tenantId).toBe(row.id);
    }
  });

  it('rejette 400 quand aucun tenant n’est fourni', async () => {
    await request(app.getHttpServer())
      .get('/whoami')
      .set('Host', 'localhost')
      .expect(400);
  });

  it('une route exclue répond sans exiger de tenant', async () => {
    await request(app.getHttpServer())
      .get('/public/ping')
      .set('Host', 'localhost')
      .expect(200);
  });
});
