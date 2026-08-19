'use strict';
// Quick standalone test of the Beem provider without touching the DB.
// Usage: node scripts/test-beem.js <phone> "<message>"
const config = require('../src/config');
const log = require('../src/logger');
const beem = require('../src/sms/providers/beem');

(async () => {
  const to = process.argv[2];
  const message = process.argv[3] || 'Test from AlertSenderService (Node)';
  if (!to) { console.error('Usage: node scripts/test-beem.js <phone> "<message>"'); process.exit(1); }
  const r = await beem.sendSMS({ to, message, config, log });
  console.log('ok:', r.ok);
  console.log('response:', r.info);
})();
