/**
 * Runs in every Jest worker BEFORE test modules are imported, so that AppModule and the
 * TypeORM data-source connect to the embedded test database started in global-setup.
 */
const fs = require('node:fs');
const { CONN_FILE } = require('./embedded-db.cjs');

if (fs.existsSync(CONN_FILE)) {
  const c = JSON.parse(fs.readFileSync(CONN_FILE, 'utf8'));
  process.env.DATABASE_HOST = c.host;
  process.env.DATABASE_PORT = String(c.port);
  process.env.DATABASE_USER = c.user;
  process.env.DATABASE_PASSWORD = c.password;
  process.env.DATABASE_NAME = c.database;
  process.env.TENANT_BASE_DOMAIN = c.baseDomain || 'localhost';
  process.env.DATABASE_APP_USER = c.appUser;
  process.env.DATABASE_APP_PASSWORD = c.appPassword;
}
