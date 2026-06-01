import { DataSource } from 'typeorm';
import { createOwnerDataSource } from '../support/datasource';
import {
  CAPABILITIES,
  MODULES,
  PACKS,
  QUOTAS,
} from '../../src/core/catalog/catalog.config';

/** The seeded database must match catalog.config exactly (config is the source of truth). */
describe('Catalogue — intégrité base ↔ config', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createOwnerDataSource();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  async function count(table: string): Promise<number> {
    const rows = await ds.query(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0].n;
  }

  it('les comptes des tables correspondent à la config', async () => {
    expect(await count('capability')).toBe(CAPABILITIES.length);
    expect(await count('module')).toBe(MODULES.length);
    expect(await count('pack')).toBe(PACKS.length);
    expect(await count('quota_definition')).toBe(QUOTAS.length);

    const expectedMappings = MODULES.reduce((n, m) => n + m.capabilities.length, 0);
    expect(await count('module_capability')).toBe(expectedMappings);

    const expectedPackModules = PACKS.reduce((n, p) => n + p.modules.length, 0);
    expect(await count('pack_module')).toBe(expectedPackModules);
  });

  it('le mapping module → capacités correspond à la config', async () => {
    for (const m of MODULES) {
      const rows = await ds.query(
        `SELECT c.key
           FROM module_capability mc
           JOIN module m ON m.id = mc.module_id
           JOIN capability c ON c.id = mc.capability_id
          WHERE m.code = $1
          ORDER BY c.key`,
        [m.code],
      );
      expect(rows.map((r: { key: string }) => r.key).sort()).toEqual(
        [...m.capabilities].sort(),
      );
    }
  });
});
