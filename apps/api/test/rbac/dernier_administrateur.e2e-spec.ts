import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { RbacModule } from '../../src/core/rbac/rbac.module';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

/**
 * Verrou anti-impasse : une société doit toujours garder au moins une personne capable de gérer
 * les comptes. Sans cela, retirer son profil au dernier administrateur enferme définitivement le
 * client hors de sa propre administration — plus personne ne peut rendre les droits, et il faut
 * une intervention en base pour réparer.
 */
describe('RBAC — on ne peut pas supprimer le dernier administrateur', () => {
  let app: INestApplication;
  let ds: DataSource;
  let rbac: RbacService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), TenancyModule, RbacModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rbac = app.get(RbacService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('refuse de retirer son profil au SEUL administrateur', async () => {
    const t = await createTenant(ds, 'DernierAdmin');
    await rbac.provisionSystemRoles(t.id);
    const admin = await createUser(ds, t.id, 'admin@dernier.test');
    await rbac.assignRole(t.id, admin, 'admin');

    await expect(rbac.setSingleRole(t.id, admin, 'viewer')).rejects.toThrow(/administrateur/i);
    await expect(rbac.setSingleRole(t.id, admin, null)).rejects.toThrow(/administrateur/i);
    await expect(rbac.revokeRole(t.id, admin, 'admin')).rejects.toThrow(/administrateur/i);

    // Le profil est resté intact : la société n'est pas enfermée dehors.
    expect(await rbac.listUserRoles(t.id, admin)).toEqual(['admin']);
  });

  it('autorise le changement dès qu’un SECOND administrateur existe', async () => {
    const t = await createTenant(ds, 'DeuxAdmins');
    await rbac.provisionSystemRoles(t.id);
    const a1 = await createUser(ds, t.id, 'a1@deux.test');
    const a2 = await createUser(ds, t.id, 'a2@deux.test');
    await rbac.assignRole(t.id, a1, 'admin');
    await rbac.assignRole(t.id, a2, 'admin');

    // Il en reste un : le premier peut redevenir simple deviseur.
    await expect(rbac.setSingleRole(t.id, a1, 'estimator')).resolves.toBeUndefined();
    expect(await rbac.listUserRoles(t.id, a1)).toEqual(['estimator']);

    // Mais le dernier, lui, reste protégé.
    await expect(rbac.setSingleRole(t.id, a2, 'estimator')).rejects.toThrow(/administrateur/i);
  });

  it('n’entrave pas les autres utilisateurs', async () => {
    const t = await createTenant(ds, 'AutresUsers');
    await rbac.provisionSystemRoles(t.id);
    const admin = await createUser(ds, t.id, 'admin@autres.test');
    const marie = await createUser(ds, t.id, 'marie@autres.test');
    await rbac.assignRole(t.id, admin, 'admin');
    await rbac.assignRole(t.id, marie, 'estimator');

    await expect(rbac.setSingleRole(t.id, marie, 'viewer')).resolves.toBeUndefined();
    await expect(rbac.setSingleRole(t.id, marie, null)).resolves.toBeUndefined();
    expect(await rbac.listUserRoles(t.id, marie)).toEqual([]);
  });
});
