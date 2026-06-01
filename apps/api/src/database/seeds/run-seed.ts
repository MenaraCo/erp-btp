import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { seedCatalogue } from './catalogue.seed';

/** CLI entrypoint: `pnpm seed`. Runs catalogue seeding with the owner connection. */
async function main() {
  await AppDataSource.initialize();
  try {
    await seedCatalogue(AppDataSource);
    // eslint-disable-next-line no-console
    console.log('[seed] catalogue seeded.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', err);
  process.exit(1);
});
