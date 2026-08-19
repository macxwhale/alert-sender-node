# AlertSenderService — Node.js port

Node.js rewrite of the legacy .NET `AlertSenderService` (WaveSphere Alerts Sender 2.9).
**Same architecture, same database logic — only the language changed.**

## How it works

Two independent pollers start when the service boots and run on separate timers for the
lifetime of the process.

### SMS poller (`src/sms/smsService.js`)

Runs every `SMSServicePollInterval` ms (default 30 seconds).

**Step 1 — Count pending messages**

The poller queries the `Alert_Module` database:

```sql
SELECT * FROM Alerts
WHERE AlertTypeId = 2   -- 2 = SMS (as opposed to email)
  AND StatusId = 1      -- 1 = pending / not yet sent
  AND Retries > 0       -- still has attempts remaining
```

The log line `Number of SMS found N` reflects the row count returned by this query.
If `N = 0` the poller sleeps until the next interval and does nothing.

**Step 2 — Select provider**

`SMSServiceType` in `.env` picks which SMS gateway to use.
The registry in `src/sms/providers/index.js` maps type numbers to provider modules:

| SMSServiceType | Provider |
|---|---|
| 17 | ONFON Media |
| 18 | Beem Africa (current) |

**Step 3 — Send**

Up to `NumberOfThreadsForSMS` (default 10) messages are dispatched concurrently.
For each row the provider's `sendSMS()` is called with the phone number, message text,
and the full config object.

**Step 4 — Write status back**

After every send attempt the row is updated:

```sql
UPDATE Alerts
SET StatusId = @status, Retries = @retries
WHERE Id = @id
```

| Outcome | StatusId | Retries |
|---|---|---|
| Success | `STATUS_SENT` (default 2) | unchanged |
| Failure | `STATUS_FAILED` (default 3) | decremented by 1 |

A failed message stays in the queue (StatusId resets to 1? — confirm with your DB)
until `Retries` reaches 0, at which point the `Retries > 0` filter excludes it permanently.

### Email poller (`src/email/emailService.js`)

Runs every `ServicePollInterval` ms (default 60 seconds). Disabled by default (`SendEmail=false`).

1. Calls stored procedure `sp_GetMessages` on `Alert_Module` to fetch queued emails.
2. Reads per-region SMTP configuration from `eqPortal.eQPortal_TicketingEmailConfiguration`
   (falls back to `.env` SMTP defaults if the table is empty).
3. Sends via nodemailer (STARTTLS on port 587).
4. Calls `sp_UpdateStatus(@MessageId, @iRetries, @iStatus)` to write the result back.

---

## Project layout

```
src/
  index.js               Entry point: starts both pollers, handles SIGINT/SIGTERM
  config.js              Loads .env, decrypts CRYPT: values via legacy crypto
  crypto.js              CryptorEngine port (3DES-ECB, MD5 key) — backward compat only
  logger.js              Winston rolling-file logger (mirrors log4net output format)
  db.js                  Lazy mssql connection pools for Alert_Module and eqPortal
  email/emailService.js  Email poller (sp_GetMessages / sp_UpdateStatus)
  sms/smsService.js      SMS poller (direct Alerts table SQL)
  sms/providers/
    index.js             Registry keyed by SMSServiceType integer
    beem.js              Beem Africa provider (type 18)
    onfon.js             ONFON Media (type 17) — reference port
scripts/
  test-beem.js           Send one test SMS via Beem without touching the DB
  install-service.js     Register as a Windows Service (node-windows, run as Admin)
  uninstall-service.js   Remove the Windows Service registration
```

---

## Setup

```bash
npm install
cp .env.example .env    # fill in DB connection strings and SMS credentials
```

### Key `.env` values

| Key | Description |
|---|---|
| `ALERT_MODULE_CONN` | SQL Server connection string for the Alert_Module database |
| `EQPORTAL_CONN` | SQL Server connection string for the eqPortal database |
| `SMSServiceType` | Integer selecting the SMS provider (18 = Beem) |
| `BEEM_TOKEN` | Bearer token for the Beem Africa API |
| `BEEM_FROM` | Sender name shown on the recipient's phone |
| `SendEmail` | `true`/`false` — enable the email poller |
| `SendSMS` | `true`/`false` — enable the SMS poller |
| `NumberOfThreadsForSMS` | Concurrent SMS sends per poll cycle (default 10) |
| `SMSServicePollInterval` | How often to check for new SMS alerts in ms (default 30000) |
| `STATUS_SENT` | StatusId written on success (default 2) |
| `STATUS_FAILED` | StatusId written on failure (default 3) |

Connection strings use the format:
```
Server=<ip>,<port>;Database=<name>;User Id=<user>;Password=<pass>;Encrypt=false;TrustServerCertificate=true
```

If SQL Server is on a named instance configured on a **static port**, use `IP,PORT` (no
instance name suffix). The instance-name suffix (`\SQLEXPRESS`) only works when SQL
Server Browser (UDP 1434) is reachable for port discovery.

---

## Run

```bash
# Foreground (logs to console + Log/ directory)
npm start

# Background (Linux)
node src/index.js >> Log/service.log 2>&1 &

# Test Beem credentials without touching the DB
node scripts/test-beem.js 255762716079 "hello"

# Install / remove as a Windows Service (run as Administrator)
npm run install-service
npm run uninstall-service
```

Requires **Node.js 18+** (uses the built-in `fetch`).

---

## Beem Africa provider

- **Endpoint:** `POST https://messaging-service.co.tz/api/sms/v2/text/single`
- **Auth:** `Authorization: Bearer <BEEM_TOKEN>`
- **Single recipient body:**
  ```json
  {
    "from": "DP WORLD",
    "to": "255762716079",
    "text": "Your message here.",
    "flash": 0,
    "reference": "<alert row Id>"
  }
  ```
- **Multiple recipients body:**
  ```json
  {
    "from": "DP WORLD",
    "to": ["255716718040", "255686123903", "255767245612"],
    "text": "Your message here.",
    "flash": 0,
    "reference": "xaefcgt"
  }
  ```
- **Success:** HTTP 200 with `groupName: "PENDING"` or `"ENROUTE (SENT)"` in the response.

---

## Adding another SMS provider

1. Create `src/sms/providers/<name>.js` exporting:
   ```js
   module.exports = {
     name: 'MyProvider',
     async sendSMS({ to, message, row, config, log }) {
       // ... call the API ...
       return { ok: true/false, info: '<response text>' };
     }
   };
   ```
2. Register its type number in `src/sms/providers/index.js`.
3. Add any credentials it needs to `.env` and `src/config.js`.
4. Set `SMSServiceType` to that number in `.env`.

---

## Alerts table schema (Alert_Module)

Confirmed columns (SQL Server 2022):

| Column | Type | Role |
|---|---|---|
| `Id` | int | Primary key, used as `reference` in SMS API calls |
| `To` | varchar | Recipient phone number (international format, digits only) |
| `Message` | nvarchar | Message body |
| `AlertTypeId` | int | 2 = SMS |
| `StatusId` | int | 1=pending, 2=sent, 3=failed |
| `Retries` | int | Remaining send attempts; row exits queue when this hits 0 |
| `RegionId` | int | Used by email poller to pick SMTP config from eqPortal |

---

## Notes

- **Status codes:** `STATUS_SENT` and `STATUS_FAILED` in `.env` must match what your
  application layer expects in `Alerts.StatusId`. Defaults are 2 and 3.
- **Empty `To` field:** rows with a blank phone number will fail every attempt and drain
  their retries. Clean those rows from the DB or fix the upstream system that inserts them.
- **Legacy crypto:** `crypto.js` exists only to decrypt `CRYPT:<base64>` values already
  stored in config (e.g. old email passwords). Do not use it for new secrets.
