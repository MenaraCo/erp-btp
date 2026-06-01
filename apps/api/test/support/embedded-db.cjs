/**
 * Shared embedded-PostgreSQL lifecycle for the e2e test suite (no Docker, no system install).
 *
 * startEmbeddedDb(): boots an ephemeral PostgreSQL, runs the migrations, and writes the
 * connection info to a temp file so each Jest worker can point at it (see env.setup.cjs).
 * stopEmbeddedDb(): stops the server and cleans up.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONN_FILE = path.join(os.tmpdir(), 'erp-btp-test-db.json');

const CONN = {
  host: 'localhost',
  port: 54329,
  user: 'erp',
  password: 'erp',
  database: 'erp_btp_test',
  baseDomain: 'localhost',
  appUser: 'erp_app',
  appPassword: 'erp_app',
};

async function startEmbeddedDb() {
  const mod = require('embedded-postgres');
  const EmbeddedPostgres = mod.default || mod;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-btp-pg-'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: CONN.user,
    password: CONN.password,
    port: CONN.port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(CONN.database);

  // Point this (setup) process at the embedded DB so the TypeORM data-source picks it up.
  process.env.DATABASE_HOST = CONN.host;
  process.env.DATABASE_PORT = String(CONN.port);
  process.env.DATABASE_USER = CONN.user;
  process.env.DATABASE_PASSWORD = CONN.password;
  process.env.DATABASE_NAME = CONN.database;
  process.env.TENANT_BASE_DOMAIN = CONN.baseDomain;
  process.env.DATABASE_APP_USER = CONN.appUser;
  process.env.DATABASE_APP_PASSWORD = CONN.appPassword;

  // Run migrations as the owner, then provision the non-privileged app role (TS, via ts-node).
  process.env.TS_NODE_PROJECT = path.resolve(__dirname, '..', '..', 'tsconfig.json');
  require('ts-node').register({ transpileOnly: true });
  const { AppDataSource } = require('../../src/database/data-source');
  const { provisionAppRole } = require('../../src/database/app-role');
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await provisionAppRole(AppDataSource, CONN.appUser, CONN.appPassword);
  await AppDataSource.destroy();

  // Share connection info with the test workers.
  fs.writeFileSync(CONN_FILE, JSON.stringify(CONN), 'utf8');

  globalThis.__ERP_EMBEDDED_PG__ = { pg, dataDir };
}

async function stopEmbeddedDb() {
  const state = globalThis.__ERP_EMBEDDED_PG__;
  if (state?.pg) {
    await state.pg.stop();
  }
  if (state?.dataDir) {
    fs.rmSync(state.dataDir, { recursive: true, force: true });
  }
  fs.rmSync(CONN_FILE, { force: true });
}

module.exports = { startEmbeddedDb, stopEmbeddedDb, CONN_FILE, CONN };
