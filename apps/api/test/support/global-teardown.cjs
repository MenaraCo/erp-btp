const { stopEmbeddedDb } = require('./embedded-db.cjs');

module.exports = async () => {
  await stopEmbeddedDb();
};
