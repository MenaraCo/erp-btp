import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating 1.6 — édition PDF du devis', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function hdr(r: request.Test) {
    return r.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Pdf', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('génère un PDF de devis (application/pdf, en-tête %PDF)', async () => {
    const version = (
      await hdr(request(app.getHttpServer()).post('/affaires')).send({ code: 'PDF-1', name: 'Maison' })
    ).body.version;
    await hdr(request(app.getHttpServer()).post(`/versions/${version.id}/lines`)).send({
      type: 'titre',
      code: '1',
      designation: 'Gros œuvre',
    });

    const res = await hdr(request(app.getHttpServer()).get(`/versions/${version.id}/devis.pdf`))
      .buffer(true)
      .parse((response, cb) => {
        const data: Buffer[] = [];
        response.on('data', (c: Buffer) => data.push(Buffer.from(c)));
        response.on('end', () => cb(null, Buffer.concat(data)));
      })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(100);
    expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
