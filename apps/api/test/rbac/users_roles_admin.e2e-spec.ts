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
import { UsersModule } from '../../src/core/users/users.module';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

@Module({
  imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), TenancyModule, UsersModule],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('Console utilisateurs & rôles (cahier §3.2)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let rbac: RbacService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rbac = app.get(RbacService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function as(tenantId: string, userId: string) {
    return { tenantId, userId };
  }
  function get(path: string, ctx: { tenantId: string; userId?: string }) {
    const req = request(app.getHttpServer()).get(path).set('Host', 'localhost').set('X-Tenant-Id', ctx.tenantId);
    return ctx.userId ? req.set('X-User-Id', ctx.userId) : req;
  }
  function post(path: string, ctx: { tenantId: string; userId?: string }, body?: unknown) {
    const req = request(app.getHttpServer()).post(path).set('Host', 'localhost').set('X-Tenant-Id', ctx.tenantId).send(body ?? {});
    return ctx.userId ? req.set('X-User-Id', ctx.userId) : req;
  }
  function del(path: string, ctx: { tenantId: string; userId?: string }) {
    const req = request(app.getHttpServer()).delete(path).set('Host', 'localhost').set('X-Tenant-Id', ctx.tenantId);
    return ctx.userId ? req.set('X-User-Id', ctx.userId) : req;
  }

  async function seedAdmin(name: string) {
    const tenant = await createTenant(ds, name);
    const adminId = await createUser(ds, tenant.id, `admin@${name}.test`);
    await rbac.provisionSystemRoles(tenant.id);
    await rbac.assignRole(tenant.id, adminId, 'admin');
    return { tenantId: tenant.id, adminId };
  }

  it('un admin liste les rôles du catalogue', async () => {
    const { tenantId, adminId } = await seedAdmin('RolesList');
    const res = await get('/roles', as(tenantId, adminId)).expect(200);
    const codes = (res.body as Array<{ code: string }>).map((r) => r.code).sort();
    expect(codes).toEqual([
      'admin', 'conducteur', 'direction', 'estimator', 'referentiel_valideur', 'viewer',
    ]);
    const admin = res.body.find((r: { code: string }) => r.code === 'admin');
    expect(admin.permissions).toContain('rbac.user_role.assign');
  });

  it('un admin crée un utilisateur puis lui affecte et retire des rôles', async () => {
    const { tenantId, adminId } = await seedAdmin('RolesCycle');

    const created = await post('/admin/users', as(tenantId, adminId), {
      email: 'marie@rolescycle.test',
      fullName: 'Marie',
      password: 'motdepasse1',
      roleCode: 'estimator',
    }).expect(201);
    const newId = created.body.id as string;
    expect(created.body.roles).toEqual(['estimator']);

    // cumul d'un second rôle
    const afterAssign = await post(`/admin/users/${newId}/roles`, as(tenantId, adminId), { roleCode: 'viewer' }).expect(201);
    expect(afterAssign.body.sort()).toEqual(['estimator', 'viewer']);

    // retrait d'un rôle
    const afterRevoke = await del(`/admin/users/${newId}/roles/estimator`, as(tenantId, adminId)).expect(200);
    expect(afterRevoke.body).toEqual(['viewer']);

    // l'utilisateur apparaît dans la liste avec son rôle courant
    const list = await get('/admin/users', as(tenantId, adminId)).expect(200);
    const marie = list.body.find((u: { id: string }) => u.id === newId);
    expect(marie.roles).toEqual(['viewer']);
  });

  it('sépare le prénom et le nom, et recompose le nom complet pour l’affichage', async () => {
    const { tenantId, adminId } = await seedAdmin('NomPrenom');

    const created = await post('/admin/users', as(tenantId, adminId), {
      email: 'amelie@nomprenom.test',
      firstName: 'Amélie',
      lastName: 'Lefebvre-Martin',
      password: 'motdepasse1',
    }).expect(201);
    expect(created.body.firstName).toBe('Amélie');
    expect(created.body.lastName).toBe('Lefebvre-Martin');
    expect(created.body.fullName).toBe('Amélie Lefebvre-Martin');

    // La liste renvoie les trois champs, cohérents entre eux.
    const list = await get('/admin/users', as(tenantId, adminId)).expect(200);
    const u = list.body.find((x: { email: string }) => x.email === 'amelie@nomprenom.test');
    expect(u).toMatchObject({
      firstName: 'Amélie',
      lastName: 'Lefebvre-Martin',
      fullName: 'Amélie Lefebvre-Martin',
    });
  });

  it('refuse un e-mail en doublon (409)', async () => {
    const { tenantId, adminId } = await seedAdmin('RolesDup');
    const body = { email: 'dup@rolesdup.test', fullName: 'Dup', password: 'motdepasse1' };
    await post('/admin/users', as(tenantId, adminId), body).expect(201);
    await post('/admin/users', as(tenantId, adminId), body).expect(409);
  });

  it('refuse (403) un utilisateur sans la permission rbac.user_role.assign', async () => {
    const { tenantId } = await seedAdmin('RolesForbidden');
    const viewerId = await createUser(ds, tenantId, 'viewer@rolesforbidden.test');
    await rbac.assignRole(tenantId, viewerId, 'viewer');
    await get('/admin/users', as(tenantId, viewerId)).expect(403);
    await post('/admin/users', as(tenantId, viewerId), {
      email: 'x@rolesforbidden.test', fullName: 'X', password: 'motdepasse1',
    }).expect(403);
  });
});
