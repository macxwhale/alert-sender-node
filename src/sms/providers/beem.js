'use strict';
/**
 * Beem Africa SMS provider (NEW).
 * Docs: https://documenter.getpostman.com/view/1679195/2sAYkDP1XN
 * Host: https://messaging-service.co.tz  (v2)
 *
 * Endpoint (single):  POST /api/sms/v2/text/single
 * Auth:               Authorization: Basic base64(API_KEY:SECRET_KEY)
 * Body:
 *   {
 *     "source_addr": "INFO",
 *     "encoding": 0,
 *     "schedule_time": "",
 *     "message": "...",
 *     "recipients": [ { "recipient_id": 1, "dest_addr": "2557XXXXXXXX" } ]
 *   }
 *
 * Success: HTTP 200 and a "PENDING"/"ENROUTE (SENT)" status group in the body.
 */

function normalizeMsisdn(to) {
  // Beem expects international format without '+'. Adjust prefix rules as needed.
  let n = String(to).replace(/[^\d]/g, '');
  return n;
}

async function sendSMS({ to, message, config, log }) {
  const c = config.beem;
  if (!c.apiKey || !c.secretKey) throw new Error('Beem: BEEM_API_KEY / BEEM_SECRET_KEY not set');

  const auth = 'Basic ' + Buffer.from(`${c.apiKey}:${c.secretKey}`).toString('base64');
  const body = {
    source_addr: c.sourceAddr,
    encoding: c.encoding,
    schedule_time: '',
    message,
    recipients: [{ recipient_id: 1, dest_addr: normalizeMsisdn(to) }],
  };

  log.debug(`Beem: POST ${c.api} -> ${JSON.stringify(body.recipients)}`);

  const res = await fetch(c.api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  log.debug(`Beem response ${res.status}: ${text}`);

  // Beem returns 200 with { "successful": true, ... } or a status group.
  const grp = json && (json.groupName || (json.status && json.status.groupName));
  const ok =
    res.ok &&
    (json?.successful === true ||
      /PENDING|ENROUTE|DELIVER|SENT/i.test(String(grp || '')) ||
      /successfully/i.test(text));

  return { ok, info: text };
}

module.exports = { name: 'Beem', sendSMS };
