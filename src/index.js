'use strict';
/**
 * Entry point — Node equivalent of Program.Main.
 * Starts the Email poller and the SMS poller on their own intervals,
 * exactly like the two ServiceBase instances in the original app.
 */
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const emailService = require('./email/emailService');
const smsService = require('./sms/smsService');

const timers = [];

async function main() {
  log.info('Service Start...');
  log.info(`Version : node-1.0.0  (SMSServiceType=${config.smsServiceType})`);

  if (config.sendEmail) timers.push(emailService.start());
  if (config.sendSms) timers.push(smsService.start());

  if (timers.length === 0) log.error('Both SendEmail and SendSMS are disabled — nothing to do.');
}

async function shutdown(sig) {
  log.info(`Service Stop... (${sig})`);
  timers.forEach(clearInterval);
  await db.closeAll();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error(`unhandledRejection: ${e && e.message}`));
process.on('uncaughtException', (e) => log.error(`uncaughtException: ${e && e.message}`));

main().catch((e) => { log.error(`Fatal: ${e.message}`); process.exit(1); });
