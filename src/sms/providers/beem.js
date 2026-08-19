'use strict';

async function sendSMS({ to, message, row, config, log }) {
  const c = config.beem;
  if (!c.token) throw new Error('Beem: BEEM_TOKEN not set');

  const body = {
    from: c.from,
    to: String(to).replace(/[^\d]/g, ''), // digits only, no +
    text: message,
    flash: 0,
    reference: String(row?.Id || row?.id || Date.now()),
  };

  log.debug(`Beem: POST ${c.api} -> to=${body.to}`);

  const res = await fetch(c.api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${c.token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  log.debug(`Beem response ${res.status}: ${text}`);

  const ok = res.ok && json?.success !== false;
  return { ok, info: text };
}

module.exports = { name: 'Beem', sendSMS };
