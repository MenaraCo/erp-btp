import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Le plan analytique se range par la nature de la FAMILLE, pas par celle du lot.
 *
 * Un lot de travaux (« Peinture », « Production propre ») contient à la fois des matériaux, de la
 * sous-traitance et de la main-d'œuvre. Grouper par la nature du lot rangeait toute la peinture
 * dans « Matériaux » — heures comprises — et le tableau de bord mentait à la lecture comme au
 * total : on lisait 0 € de main-d'œuvre alors que dix mille euros y étaient dépensés.
 */
describe('Contrôle de gestion — natures du plan analytique', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(
      app, ds, 'Plan', 'admin', ['site_tracking', 'core', 'financial_management', 'estimating'],
    ));

    // Un lot de travaux, avec trois familles de natures différentes — le cas réel.
    const lotId = (await as('post', '/params/lots').send({ code: 'PEIN', label: 'Peinture' }).expect(201)).body.id;
    await as('post', '/params/familles')
      .send({ lotId, code: 'P_PEIN', label: 'Peinture impression', nature: 'material' }).expect(201);
    await as('post', '/params/familles')
      .send({ lotId, code: 'P_MO', label: 'Main d’œuvre peinture', nature: 'labor' }).expect(201);
    await as('post', '/params/familles')
      .send({ lotId, code: 'P_ST', label: 'Sous-traitance peinture', nature: 'subcontract' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('range_chaque_famille_sous_sa_propre_nature', async () => {
    const plan = (await as('get', '/analytical/plan').expect(200)).body;
    const par = (nature: string) => plan.find((n: { nature: string }) => n.nature === nature);

    const familles = (nature: string) => (par(nature)?.lots ?? [])
      .flatMap((l: { familles: Array<{ code: string }> }) => l.familles.map((f) => f.code));

    expect(familles('material')).toContain('P_PEIN');
    expect(familles('labor')).toContain('P_MO');
    expect(familles('subcontract')).toContain('P_ST');

    // Et surtout : la main-d'œuvre n'apparaît PAS sous les matériaux.
    expect(familles('material')).not.toContain('P_MO');
    expect(familles('material')).not.toContain('P_ST');
  });

  it('un_lot_partage_apparait_sous_chaque_nature_avec_ses_seules_familles', async () => {
    const plan = (await as('get', '/analytical/plan').expect(200)).body;
    const lotDans = (nature: string) => plan
      .find((n: { nature: string }) => n.nature === nature)
      ?.lots.find((l: { code: string }) => l.code === 'PEIN');

    // Le même lot se montre sous trois natures — c'est ainsi qu'un lot de travaux se lit.
    expect(lotDans('material')?.familles).toHaveLength(1);
    expect(lotDans('labor')?.familles).toHaveLength(1);
    expect(lotDans('subcontract')?.familles).toHaveLength(1);
    // Un lot sans famille dans une nature ne l'encombre pas.
    expect(lotDans('equipment')).toBeUndefined();
  });
});
