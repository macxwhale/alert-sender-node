'use strict';

const MAX_BATCH = 100; // messages per /text/multi call

function normalise(to) {
  return String(to).replace(/[^\d]/g, '');
}

/** Single send — used by scripts/test-beem.js only. */
async function sendSMS({ to, message, row, config, log }) {
  const c = config.beem;
  if (!c.token) throw new Error('Beem: BEEM_TOKEN not set');

  const body = {
    from: c.from,
    to: normalise(to),
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

/**
 * Bulk send via /text/multi — one message object per row, one API call per
 * MAX_BATCH rows. Matches responses back to rows by reference (row Id).
 * Returns [{ row, ok, info }, ...] for every input row.
 */
async function sendBatch({ rows, config, log }) {
  const c = config.beem;
  if (!c.token) throw new Error('Beem: BEEM_TOKEN not set');

  const results = [];

  for (let offset = 0; offset < rows.length; offset += MAX_BATCH) {
    const chunk = rows.slice(offset, offset + MAX_BATCH);

    const messages = chunk.map(row => ({
      from: c.from,
      to: normalise(row.To ?? row.to ?? ''),
      text: row.Message ?? row.message ?? row.Body ?? '',
      flash: 0,
      reference: String(row.Id ?? row.id ?? offset),
    }));

    log.debug(`Beem: POST ${c.multiApi} -> ${messages.length} message(s)`);

    const res = await fetch(c.multiApi, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${c.token}`,
      },
      body: JSON.stringify({ messages }),
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    log.debug(`Beem multi response ${res.status}: ${text}`);

    if (!res.ok) {
      for (const row of chunk) results.push({ row, ok: false, info: text });
      continue;
    }

    // Map results back by reference (row Id)
    const msgResults = json?.messages || [];
    const byRef = new Map(msgResults.map(m => [String(m.reference ?? m.sendReference), m]));

    for (const row of chunk) {
      const ref = String(row.Id ?? row.id ?? '');
      const m = byRef.get(ref);
      const groupName = m?.status?.groupName ?? '';
      const ok = /PENDING|ENROUTE|DELIVER|SENT/i.test(groupName);
      results.push({ row, ok, info: JSON.stringify(m ?? json) });
    }
  }

  return results;
}

module.exports = { name: 'Beem', sendSMS, sendBatch };
