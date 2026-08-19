'use strict';
const sql = require('mssql');
const config = require('./config');
const log = require('./logger');

const pools = {};

/** Get (or lazily open) a connection pool for a given connection string. */
async function getPool(key, connStr) {
  if (!connStr) throw new Error(`Missing connection string for "${key}"`);
  if (pools[key]) return pools[key];
  const pool = new sql.ConnectionPool(connStr);
  pool.on('error', (e) => log.error(`DB pool "${key}" error: ${e.message}`));
  await pool.connect();
  pools[key] = pool;
  log.info(`DB pool "${key}" connected`);
  return pool;
}

const alertModule = () => getPool('Alert_Module', config.db.alertModule);
const eqPortal = () => getPool('eqPortal', config.db.eqPortal);

async function closeAll() {
  for (const k of Object.keys(pools)) {
    try { await pools[k].close(); } catch (_) {}
    delete pools[k];
  }
}

module.exports = { sql, alertModule, eqPortal, closeAll };
