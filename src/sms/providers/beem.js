'use strict';

const MAX_BATCH = 100;

function normalise(to, countryCode) {
  const digits = String(to).replace(/[^\d]/g, '');
  return `${countryCode}${digits.slice(-9)}`;
}

async function sendSMS({ to, message, row, config, log }) {
  const c = config.beem;
  if (!c.token) throw new Error('Beem: BEEM_TOKEN not set');

  const body = {
    from: c.from,
    to: normalise(to, c.countryCode),
    text: message,
    flash: 0,
    reference: String(row?.Id || row?.id || Date.now()),
  };

  log.debug(`Beem: POST ${c.singleApi} -> to=${body.to}`);

  const res = await fetch(c.singleApi, {
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

// Bulk send — up to MAX_BATCH messages per call, preserving ORDER BY Id ASC ordering.
async function sendBatch({ rows, config, log }) {
  const c = config.beem;
  if (!c.token) throw new Error('Beem: BEEM_TOKEN not set');

  const results = [];

  for (let offset = 0; offset < rows.length; offset += MAX_BATCH) {
    const chunk = rows.slice(offset, offset + MAX_BATCH);

    const body = {
      messages: chunk.map(r => ({
        from: c.from,
        to: normalise(r.To ?? r.to ?? '', c.countryCode),
        text: r.Message ?? r.message ?? r.Body ?? '',
      })),
      flash: 0,
      reference: String(chunk[0]?.Id ?? chunk[0]?.id ?? Date.now()),
    };

    log.debug(`Beem: POST ${c.multiApi} -> ${chunk.length} message(s)`);

    const res = await fetch(c.multiApi, {
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
    log.debug(`Beem multi response ${res.status}: ${text}`);

    if (!res.ok) {
      for (const row of chunk) results.push({ row, ok: false, info: text });
      continue;
    }

    // Response messages[] is in same order as request — match by index.
    const msgResults = json?.messages ?? [];
    chunk.forEach((row, i) => {
      const m = msgResults[i];
      const groupName = m?.status?.groupName ?? '';
      const ok = m ? /PENDING|ENROUTE|DELIVER|SENT/i.test(groupName) : res.ok;
      results.push({ row, ok, info: JSON.stringify(m ?? json) });
    });
  }

  return results;
}

module.exports = { name: 'Beem', sendSMS, sendBatch };
