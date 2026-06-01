const { startEmbeddedDb } = require('./embedded-db.cjs');

module.exports = async () => {
  await startEmbeddedDb();
};
