/**
 * Local development PostgreSQL, with no Docker and no system install.
 *
 * Starts a persistent embedded PostgreSQL (binary shipped in node_modules) using the
 * same env configuration as the API, then keeps running until interrupted (Ctrl+C).
 * Data is stored under apps/api/.pgdata (gitignored) so it survives restarts.
 *
 * Usage: pnpm db:local   (or: node apps/api/scripts/local-db.mjs)
 *
 * In CI we use a real PostgreSQL service instead (see .github/workflows/ci.yml).
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '..', '.pgdata');

const port = Number(process.env.DATABASE_PORT ?? 5432);
const user = process.env.DATABASE_USER ?? 'erp';
const password = process.env.DATABASE_PASSWORD ?? 'erp';
const database = process.env.DATABASE_NAME ?? 'erp_btp';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
});

const firstRun = !existsSync(dataDir);

async function main() {
  if (firstRun) {
    console.log(`[local-db] initialising data directory: ${dataDir}`);
    await pg.initialise();
  }

  console.log(`[local-db] starting PostgreSQL on port ${port}...`);
  await pg.start();

  if (firstRun) {
    console.log(`[local-db] creating database "${database}"...`);
    await pg.createDatabase(database);
  }

  console.log(
    `[local-db] ready -> postgres://${user}:***@localhost:${port}/${database}`,
  );
  console.log('[local-db] press Ctrl+C to stop.');

  const shutdown = async (signal) => {
    console.log(`\n[local-db] received ${signal}, stopping PostgreSQL...`);
    try {
      await pg.stop();
      console.log('[local-db] stopped.');
      process.exit(0);
    } catch (err) {
      console.error('[local-db] error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[local-db] failed to start:', err);
  process.exit(1);
});
