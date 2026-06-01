import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { seedCatalogue } from './catalogue.seed';
import { seedPermissions } from './rbac.seed';

/** CLI entrypoint: `pnpm seed`. Runs global catalogue + permission seeding (owner connection). */
async function main() {
  await AppDataSource.initialize();
  try {
    await seedCatalogue(AppDataSource);
    await seedPermissions(AppDataSource);
    // eslint-disable-next-line no-console
    console.log('[seed] catalogue + permissions seeded.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', err);
  process.exit(1);
});
