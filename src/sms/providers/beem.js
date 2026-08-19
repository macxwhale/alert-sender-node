'use strict';

const MAX_BATCH = 50; // Beem recommended cap per call

function normalise(to) {
  return String(to).replace(/[^\d]/g, '');
}

/** Single-row send (fallback / used by test script). */
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

/**
 * Batch send: groups rows by message text, sends one API call per unique
 * message (up to MAX_BATCH recipients each), maps per-recipient results back.
 * Returns [{ row, ok, info }, ...] for every input row.
 */
async function sendBatch({ rows, config, log }) {
  const c = config.beem;
  if (!c.token) throw new Error('Beem: BEEM_TOKEN not set');

  // Group by message text
  const groups = new Map();
  for (const row of rows) {
    const msg = row.Message ?? row.message ?? row.Body ?? '';
    if (!groups.has(msg)) groups.set(msg, []);
    groups.get(msg).push(row);
  }

  const results = [];

  for (const [message, groupRows] of groups) {
    // Split into chunks of MAX_BATCH
    for (let offset = 0; offset < groupRows.length; offset += MAX_BATCH) {
      const chunk = groupRows.slice(offset, offset + MAX_BATCH);
      const toList = chunk.map(r => normalise(r.To ?? r.to ?? ''));

      const body = {
        from: c.from,
        to: toList.length === 1 ? toList[0] : toList,
        text: message,
        flash: 0,
        reference: String(chunk[0]?.Id || chunk[0]?.id || Date.now()),
      };

      log.debug(`Beem: POST ${c.api} -> ${toList.length} recipient(s)`);

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
      log.debug(`Beem batch response ${res.status}: ${text}`);

      if (!res.ok) {
        // Whole chunk failed — mark every row in it as failed
        for (const row of chunk) results.push({ row, ok: false, info: text });
        continue;
      }

      // Map per-recipient results back by phone number
      const msgResults = json?.messages || [];
      const byTo = new Map(msgResults.map(m => [String(m.to), m]));

      for (const row of chunk) {
        const to = normalise(row.To ?? row.to ?? '');
        const m = byTo.get(to);
        const groupName = m?.status?.groupName ?? '';
        const ok = /PENDING|ENROUTE|DELIVER|SENT/i.test(groupName);
        results.push({ row, ok, info: JSON.stringify(m ?? json) });
      }
    }
  }

  return results;
}

module.exports = { name: 'Beem', sendSMS, sendBatch };
