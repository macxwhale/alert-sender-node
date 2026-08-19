'use strict';
/**
 * SMS provider registry.
 * Keys mirror the original SMSServiceType numbering so config stays compatible.
 * Each provider exports: async sendSMS({ to, message, row, config, log }) -> { ok, info }
 *
 * Only the providers that have been ported are wired here. Add more by
 * creating a file under this folder and registering its number below.
 */
const beem = require('./beem');
const onfon = require('./onfon');

const registry = {
  17: onfon, // OnfonMedia (example legacy provider)
  18: beem,  // Beem Africa (NEW)
};

function getProvider(type) {
  const p = registry[type];
  if (!p) {
    throw new Error(
      `No SMS provider registered for SMSServiceType=${type}. ` +
      `Registered: ${Object.keys(registry).join(', ')}`
    );
  }
  return p;
}

module.exports = { getProvider, registry };
