# AlertSenderService — Node.js port

Node.js rewrite of the legacy .NET `AlertSenderService` (WaveSphere Alerts Sender 2.9).
**Same architecture, same database logic — only the language changed.** A new SMS
provider (**Beem Africa**) is wired in as `SMSServiceType = 18`.

## How it works (unchanged from the original)

Two independent pollers run on timers:

- **SMS poller** (`src/sms/smsService.js`) — every `SMSServicePollInterval` ms:
  1. `SELECT * FROM Alerts WHERE AlertTypeId = 2 AND StatusId = 1 AND Retries > 0`
  2. For each row, dispatch through the provider selected by `SMSServiceType`.
  3. `UPDATE Alerts SET StatusId = ?, Retries = ? WHERE Id = ?`
  Concurrency = `NumberOfThreadsForSMS`.

- **Email poller** (`src/email/emailService.js`) — every `ServicePollInterval` ms:
  1. `sp_GetMessages` (Alert_Module)
  2. Read per-region SMTP config from `eqPortal.eQPortal_TicketingEmailConfiguration`
  3. Send via SMTP (nodemailer), then `sp_UpdateStatus (@MessageId, @iRetries, @iStatus)`.

Config, connection strings and the pluggable provider switch all map 1:1 to the
old `AlertSenderService.exe.config`.

## Project layout

```
src/
  index.js               Entry point (= Program.Main): starts both pollers
  config.js              Loads .env, decrypts CRYPT: values
  crypto.js              CryptorEngine port (3DES-ECB, MD5 key) — for legacy secrets
  logger.js              Rolling file logs under Log\ (log4net equivalent)
  db.js                  mssql connection pools (Alert_Module, eqPortal)
  email/emailService.js  Email poller (sp_GetMessages / sp_UpdateStatus)
  sms/smsService.js      SMS poller (same Alerts SQL)
  sms/providers/
    index.js             Registry keyed by SMSServiceType
    beem.js              Beem Africa provider (NEW, type 18)
    onfon.js             ONFON Media (type 17) — ported as a worked example
scripts/
  test-beem.js           Send one test SMS via Beem (no DB)
  install-service.js     Register as a Windows Service (node-windows)
  uninstall-service.js
```

## Setup

```bash
npm install
cp .env.example .env      # then edit .env
```

Fill in `.env`: DB connection strings, `SMSServiceType`, and the Beem keys
(`BEEM_API_KEY`, `BEEM_SECRET_KEY`, `BEEM_SOURCE_ADDR`). Use the `/test/` variant
of the Beem URL while testing (free, no balance used):
`https://messaging-service.co.tz/api/sms/v2/test/text/single`.

## Run

```bash
npm start                              # run in foreground
node scripts/test-beem.js 2557XXXXXXXX "hello"   # test Beem only
npm run install-service                # install as Windows service (admin)
```

Requires **Node.js 18+** (uses the built-in `fetch`).

## Adding another SMS provider

1. Create `src/sms/providers/<name>.js` exporting
   `{ name, async sendSMS({ to, message, row, config, log }) => ({ ok, info }) }`.
2. Register its number in `src/sms/providers/index.js`.
3. Add its keys to `.env` / `config.js`.
4. Set `SMSServiceType` to that number.

## Beem Africa provider

- Endpoint: `POST /api/sms/v2/text/single`
- Auth: `Authorization: Basic base64(API_KEY:SECRET_KEY)`
- Body:
  ```json
  {
    "source_addr": "INFO",
    "encoding": 0,
    "schedule_time": "",
    "message": "...",
    "recipients": [{ "recipient_id": 1, "dest_addr": "2557XXXXXXXX" }]
  }
  ```
- Success: HTTP 200 with a PENDING/ENROUTE status group (or `successful: true`).

## Notes / assumptions to verify against your DB

- **Status codes**: original numeric `StatusId` for "sent"/"failed" weren't fully
  recoverable from the binary. Defaults: sent=2, failed=3 (`STATUS_SENT` /
  `STATUS_FAILED` in `.env`). Confirm against your `Alerts` schema.
- **Column names**: SMS uses `Id`, `To`, `Message`, `Retries`. Email `sp_GetMessages`
  columns are accessed defensively (multiple aliases) — adjust if any come back empty.
- The legacy config stored many secrets in plaintext and used weak reversible
  crypto. This port keeps `crypto.js` only for backward compatibility with existing
  encrypted values. Consider rotating credentials and moving them to a secrets store.
