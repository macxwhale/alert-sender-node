'use strict';
require('dotenv').config();
const { decrypt } = require('./crypto');

const CRYPTO_KEY = process.env.CRYPTO_KEY || 'AB728DB5CEFAE';

/** Resolve a config value, decrypting "CRYPT:<base64>" values via CryptorEngine. */
function val(name, def) {
  let v = process.env[name];
  if (v === undefined) return def;
  if (v.startsWith('CRYPT:')) {
    try { v = decrypt(v.slice(6), CRYPTO_KEY); }
    catch (e) { throw new Error(`Failed to decrypt config "${name}": ${e.message}`); }
  }
  return v;
}
const num = (name, def) => { const v = val(name); return v === undefined ? def : Number(v); };
const bool = (name, def) => { const v = val(name); return v === undefined ? def : /^true$/i.test(v); };

module.exports = {
  db: {
    alertModule: process.env.ALERT_MODULE_CONN,
    eqPortal: process.env.EQPORTAL_CONN,
  },
  poll: {
    email: num('ServicePollInterval', 60000),
    sms: num('SMSServicePollInterval', 30000),
  },
  threads: {
    email: num('NumberOfThreadsForEmail', 1),
    sms: num('NumberOfThreadsForSMS', 10),
  },
  sendEmail: bool('SendEmail', true),
  sendSms: bool('SendSMS', true),
  regionId: num('RegionId', 0),
  log: { level: val('LogLevel', 'debug'), dir: val('LogDir', 'Log') },

  smsServiceType: num('SMSServiceType', 18),
  smsAllowList: val('SMS_ALLOW_LIST', '*'), // '*' = all, or '255762716079,255716718040'
  status: { sent: num('STATUS_SENT', 2), failed: num('STATUS_FAILED', 3) },

  email: {
    host: val('SMTPServer', 'smtp.office365.com'),
    port: num('SMTPPort', 587),
    ssl: bool('EnableSsl', true),
    user: val('EmailUserName'),
    pass: val('EmailPassword'),
  },

  beem: {
    singleApi: val('BEEM_API',       'https://messaging-service.co.tz/api/sms/v2/text/single'),
    multiApi:  val('BEEM_MULTI_API', 'https://messaging-service.co.tz/api/sms/v2/text/multi'),
    token: val('BEEM_TOKEN'),
    from: val('BEEM_FROM', 'INFO'),
    countryCode: val('BEEM_COUNTRY_CODE', '255'),
  },

  onfon: {
    api: val('ONFONAPI'),
    senderId: val('ONFONSenderId'),
    isUnicode: bool('ONFONIsUnicode', false),
    isFlash: bool('ONFONIsFlash', false),
    apiKey: val('ONFONApiKey'),
    clientId: val('ONFONClientId'),
  },

  raw: val, // expose resolver for provider-specific keys
};
