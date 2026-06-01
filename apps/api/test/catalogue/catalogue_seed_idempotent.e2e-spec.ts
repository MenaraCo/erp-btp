import { DataSource } from 'typeorm';
import { createOwnerDataSource } from '../support/datasource';
import { seedCatalogue } from '../../src/database/seeds/catalogue.seed';

/** Running the seed again must not create duplicates — row counts stay identical. */
describe('Catalogue — seed idempotente', () => {
  let ds: DataSource;

  const tables = [
    'capability',
    'module',
    'module_capability',
    'pack',
    'pack_module',
    'quota_definition',
  ];

  beforeAll(async () => {
    ds = await createOwnerDataSource();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  async function counts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const t of tables) {
      const rows = await ds.query(`SELECT count(*)::int AS n FROM ${t}`);
      result[t] = rows[0].n;
    }
    return result;
  }

  it('réexécuter la seed laisse les comptes inchangés', async () => {
    // The catalogue was already seeded once by global-setup.
    const before = await counts();
    await seedCatalogue(ds);
    const after = await counts();
    expect(after).toEqual(before);
  });
});
