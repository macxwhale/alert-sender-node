'use strict';
/**
 * ONFON Media (Kenya) — SMSServiceType 17.
 * Included as a worked example of porting one of the original providers.
 * Matches the JSON body the .NET app built for ONFON.
 */
async function sendSMS({ to, message, config, log }) {
  const c = config.onfon;
  if (!c.api) throw new Error('ONFON: ONFONAPI not set');

  const body = {
    SenderId: c.senderId,
    IsUnicode: c.isUnicode,
    IsFlash: c.isFlash,
    MessageParameters: [{ Number: String(to), Text: message }],
    ApiKey: c.apiKey,
    ClientId: c.clientId,
  };

  const res = await fetch(c.api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = null; }
  log.debug(`ONFON response ${res.status}: ${text}`);

  // Original checks ErrorCode == "000".
  const code = json && (json.ErrorCode ?? json.errorCode);
  const ok = res.ok && String(code) === '000';
  return { ok, info: text };
}

module.exports = { name: 'OnfonMedia', sendSMS };
