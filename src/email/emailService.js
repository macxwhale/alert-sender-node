'use strict';
/**
 * Email poller — Node equivalent of AlertSender (email side).
 * Uses the SAME stored procedures as the original app:
 *   sp_GetMessages        -> queued email requests (Alert_Module)
 *   sp_UpdateStatus       -> writes back status (@MessageId, @iRetries, @iStatus)
 * Per-region SMTP config is read from eqPortal.eQPortal_TicketingEmailConfiguration.
 *
 * NOTE: The exact columns returned by sp_GetMessages weren't recoverable from the
 * binary. Column names below are defensive (multiple aliases). Adjust to match
 * your DB if a field comes back undefined.
 */
const nodemailer = require('nodemailer');
const config = require('../config');
const log = require('../logger');
const { alertModule, eqPortal, sql } = require('../db');

let running = false;

async function getMessages() {
  const pool = await alertModule();
  const r = await pool.request().execute('sp_GetMessages');
  return r.recordset || [];
}

async function updateStatus(messageId, retries, status) {
  const pool = await alertModule();
  await pool.request()
    .input('MessageId', sql.Int, messageId)
    .input('iRetries', sql.Int, retries)
    .input('iStatus', sql.Int, status)
    .execute('sp_UpdateStatus');
}

async function getEmailConfig(regionId) {
  const pool = await eqPortal();
  log.debug('Getting email configurations...');
  const q =
    'select * from eQPortal_TicketingEmailConfiguration with(nolock) ' +
    `where isnull(RegionId, 0) = ${Number(regionId) || 0} order by ID asc`;
  const r = await pool.request().query(q);
  return r.recordset && r.recordset[0];
}

function buildTransport(cfg) {
  // Fall back to .env SMTP defaults when a field isn't present in the DB row.
  const host = cfg?.SMTPServer || config.email.host;
  const port = Number(cfg?.SMTPPort || config.email.port);
  const secure = false; // 587 uses STARTTLS
  const user = cfg?.EmailAddressID || cfg?.UserName || config.email.user;
  const pass = cfg?.Password ? cfg.Password : config.email.pass; // DB value may already be plaintext
  return nodemailer.createTransport({
    host, port, secure,
    requireTLS: config.email.ssl,
    auth: { user, pass },
  });
}

const pick = (row, ...names) => { for (const n of names) if (row[n] != null) return row[n]; };

async function sendOne(transport, fromUser, row) {
  const id = pick(row, 'Id', 'MessageId', 'id');
  const to = pick(row, 'To', 'ToAddress', 'Receiver', 'EmailTo');
  const subject = pick(row, 'Subject', 'subject') || '';
  const bodyHtml = pick(row, 'Message', 'Body', 'body') || '';
  const retries = Number(pick(row, 'Retries', 'retries') ?? 0);

  if (!to) { log.error('Receiver Email Is Not Defined'); await updateStatus(id, retries - 1, config.status.failed); return; }
  log.info(`Sending Email for the request id = ${id}`);
  try {
    await transport.sendMail({ from: fromUser, to, subject, html: bodyHtml });
    log.info(`Email Id : ${id} Successfully Sent`);
    await updateStatus(id, retries, config.status.sent);
  } catch (e) {
    log.error(`Email send failed (id=${id}): ${e.message}`);
    await updateStatus(id, retries - 1, config.status.failed);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    if (!config.sendEmail) return;
    log.debug('Verifying for any request to process...');
    const rows = await getMessages();
    log.info(`Number of records found ${rows.length}`);
    if (rows.length === 0) return;

    const cfg = await getEmailConfig(config.regionId);
    const transport = buildTransport(cfg);
    const fromUser = cfg?.EmailAddressID || config.email.user;

    let i = 0;
    const worker = async () => { while (i < rows.length) await sendOne(transport, fromUser, rows[i++]); };
    await Promise.all(Array.from({ length: Math.max(1, config.threads.email) }, worker));
  } catch (e) {
    log.error(`Email tick error: ${e.message}`);
  } finally {
    running = false;
  }
}

function start() {
  log.info('Email Service Start...');
  tick();
  return setInterval(tick, config.poll.email);
}

module.exports = { start, tick };
