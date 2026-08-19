'use strict';
/**
 * SMS poller — Node equivalent of SmsSenderService + SMSHelper.
 * Keeps the ORIGINAL queue logic verbatim:
 *   SELECT: Alerts WHERE AlertTypeId = 2 AND StatusId = 1 AND Retries > 0
 *   UPDATE: Alerts SET StatusId = @status, Retries = @retries WHERE Id = @id
 * Provider is chosen by config.smsServiceType (same numbering as before).
 */
const config = require('./../config');
const log = require('./../logger');
const { alertModule, sql } = require('./../db');
const { getProvider } = require('./providers');

const GET_MESSAGES =
  'SELECT * FROM Alerts WHERE AlertTypeId = 2 AND StatusId = 1 AND Retries > 0';

let running = false;

async function getMessages() {
  const pool = await alertModule();
  const r = await pool.request().query(GET_MESSAGES);
  return r.recordset;
}

async function updateStatus(id, statusId, retries) {
  const pool = await alertModule();
  await pool.request()
    .input('status', sql.Int, statusId)
    .input('retries', sql.Int, retries)
    .input('id', sql.Int, id)
    .query('UPDATE Alerts SET StatusId = @status, Retries = @retries WHERE Id = @id');
}

// Row column access is defensive — original schema uses To / Message / Retries / Id.
const pick = (row, ...names) => {
  for (const n of names) if (row[n] !== undefined && row[n] !== null) return row[n];
  return undefined;
};

async function sendOne(provider, row) {
  const id = pick(row, 'Id', 'id');
  const to = pick(row, 'To', 'to', 'MobileNumber', 'Recipient');
  const message = pick(row, 'Message', 'message', 'Body');
  const retries = Number(pick(row, 'Retries', 'retries') ?? 0);

  log.info(`Sending SMS for the request id = ${id}`);
  try {
    const { ok, info } = await provider.sendSMS({ to, message, row, config, log });
    if (ok) {
      log.info(`${provider.name} SMS send successful (id=${id})`);
      await updateStatus(id, config.status.sent, retries); // success
    } else {
      log.error(`error in ${provider.name} SMS (id=${id}): ${info}`);
      await updateStatus(id, config.status.failed, retries - 1); // consume a retry
    }
  } catch (e) {
    log.error(`error in ${provider.name} SMS (id=${id}): ${e.message}`);
    await updateStatus(id, config.status.failed, retries - 1);
  }
}

/** Run N workers over the batch (config.threads.sms concurrency). */
async function processBatch(provider, rows) {
  let i = 0;
  const worker = async () => { while (i < rows.length) { const row = rows[i++]; await sendOne(provider, row); } };
  const n = Math.max(1, config.threads.sms);
  await Promise.all(Array.from({ length: n }, worker));
}

async function tick() {
  if (running) return; // skip overlapping ticks
  running = true;
  try {
    if (!config.sendSms) return;
    log.debug('Getting sms...');
    const rows = await getMessages();
    log.info(`Number of SMS found ${rows.length}`);
    if (rows.length === 0) return;
    const provider = getProvider(config.smsServiceType);
    log.info(`SMS Service Type: ${config.smsServiceType} (${provider.name})`);
    await processBatch(provider, rows);
  } catch (e) {
    log.error(`SMS tick error: ${e.message}`);
  } finally {
    running = false;
  }
}

function start() {
  log.info('SMS Service Start...');
  tick();
  return setInterval(tick, config.poll.sms);
}

module.exports = { start, tick };
