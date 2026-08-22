# AlertSenderService — Node.js

A Node.js background service that polls a SQL Server database for pending alert notifications and dispatches them via SMS (and optionally email) on a configurable interval. This is a Node.js port of the legacy .NET `AlertSenderService` (WaveSphere Alerts Sender 2.9) — same database schema, same queue logic, only the runtime changed.

---

## How It Works

Two independent pollers start when the service boots and run on separate timers.

### SMS Poller

Runs every `SMSServicePollInterval` ms (default 30 seconds).

1. **Query pending rows** — fetch all undelivered SMS alerts from `Alert_Module`:
   ```sql
   SELECT * FROM Alerts
   WHERE AlertTypeId = 2   -- SMS (not email)
     AND StatusId = 1      -- pending
     AND Retries > 0       -- has attempts remaining
   ORDER BY Id ASC         -- oldest first → Issued → Called → Served lifecycle order
   ```
2. **Apply allow list** — if `SMS_ALLOW_LIST` is set to a comma-separated list of numbers, rows whose `To` field is not in the list are skipped (useful for testing without blasting real users).
3. **Select provider** — `SMSServiceType` in `.env` picks the SMS gateway (18 = Beem Africa).
4. **Batch send** — rows are grouped by identical message text. Each group is sent in a single `/text/multi` API call with all recipient numbers in a `to[]` array (up to 100 per call). This means one API call per unique message text per poll cycle rather than one call per row.
5. **Write status back** — after every send attempt:

   ```sql
   UPDATE Alerts SET StatusId = @status, Retries = @retries WHERE Id = @id
   ```

   | Outcome | StatusId written | Retries written |
   |---------|-----------------|-----------------|
   | Success | `STATUS_SENT` (default 2) | unchanged |
   | Failure | `STATUS_FAILED` (default 3) | decremented by 1 |

   A sent or failed row is never re-queued automatically — it is excluded from all future queries because `StatusId ≠ 1`.

### Email Poller

Runs every `ServicePollInterval` ms (default 60 seconds). Disabled by default (`SendEmail=false`).

1. Calls stored procedure `sp_GetMessages` on `Alert_Module` to fetch queued emails.
2. Reads per-region SMTP configuration from `eqPortal.eQPortal_TicketingEmailConfiguration` (falls back to `.env` SMTP defaults if the table is empty).
3. Sends via nodemailer (STARTTLS on port 587).
4. Calls `sp_UpdateStatus(@MessageId, @iRetries, @iStatus)` to write the result back.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | v18.0.0 or higher (uses built-in `fetch`) |
| npm | v7.0.0 or higher |
| SQL Server | 2019 or higher |
| PM2 (optional, for production) | latest |

Check your versions:

```bash
node -v
npm -v
```

---

## 1. Clone & Install

```bash
git clone https://github.com/macxwhale/alert-sender-node.git
cd alert-sender-node
npm install
```

---

## 2. Configure Environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Then open `.env` and set the following:

```bash
# ── Database connections (SQL Server) ────────────────────────────────────────
# Use IP,PORT format (no instance name suffix) when SQL Server Browser is unavailable.
ALERT_MODULE_CONN=Server=10.10.10.1,1433;Database=Alert_Module;User Id=sa;Password=your_pass;Encrypt=false;TrustServerCertificate=true
EQPORTAL_CONN=Server=10.10.10.1,1433;Database=eqPortal;User Id=sa;Password=your_pass;Encrypt=false;TrustServerCertificate=true

# ── Polling intervals (ms) ────────────────────────────────────────────────────
ServicePollInterval=60000          # Email poller frequency (default: 1 minute)
SMSServicePollInterval=30000       # SMS poller frequency (default: 30 seconds)

# ── Worker threads ────────────────────────────────────────────────────────────
NumberOfThreadsForEmail=1
NumberOfThreadsForSMS=10           # Concurrent sends when not using batch mode

# ── Toggles ───────────────────────────────────────────────────────────────────
SendEmail=false
SendSMS=true

# ── SMS provider ──────────────────────────────────────────────────────────────
SMSServiceType=18                  # 18 = Beem Africa

# ── SMS allow list ────────────────────────────────────────────────────────────
SMS_ALLOW_LIST=*                   # * = send to all numbers (production default)
# SMS_ALLOW_LIST=0762716079,0716718040   # restrict to specific numbers (testing)

# ── Beem Africa credentials ───────────────────────────────────────────────────
BEEM_API=https://messaging-service.co.tz/api/sms/v2/text/single
BEEM_MULTI_API=https://messaging-service.co.tz/api/sms/v2/text/multi
BEEM_TOKEN=your_bearer_token_here
BEEM_FROM=DP WORLD                 # Registered sender ID (max 11 characters)

# ── SMS status codes ──────────────────────────────────────────────────────────
STATUS_SENT=2
STATUS_FAILED=3

# ── Logging ───────────────────────────────────────────────────────────────────
LogLevel=debug
LogDir=Log
```

> **Connection string note:** Use `Server=<IP>,<PORT>` (comma, not colon). The `\INSTANCENAME` suffix only works when SQL Server Browser (UDP 1434) is reachable. For a named instance on a known static port, omit the instance name entirely.

---

## 3. Running the Service

### Option A — Direct (Node.js)

```bash
node src/index.js
```

### Option B — npm start

```bash
npm start
```

Logs go to the terminal and to `Log/service.log`.

### Option C — Background (Linux)

```bash
node src/index.js >> Log/service.log 2>&1 &
```

### Option D — Production with PM2 (recommended)

Install PM2 globally (one-time):

```bash
npm install -g pm2
```

Start the service:

```bash
pm2 start src/index.js -n AlertSenderService
```

Useful PM2 commands:

```bash
pm2 status                          # Show all running processes
pm2 logs AlertSenderService         # Tail live logs
pm2 restart AlertSenderService      # Restart the service
pm2 stop AlertSenderService         # Stop the service
pm2 delete AlertSenderService       # Remove from PM2 process list
```

Persist across system reboots:

```bash
pm2 save                            # Save current process list
pm2 startup                         # Register PM2 as a system service
                                    # (run the command it outputs to complete setup)
```

### Option E — Windows Service

Run as Administrator:

```bash
npm run install-service             # Register as a Windows Service
npm run uninstall-service           # Remove the Windows Service
```

---

## 4. Log Files

Logs are written to `Log/service.log` (rolling daily files, kept 30 days).

```
Log/
  service.log        ← current log (poll results, send outcomes, DB updates)
  service.2026-08-21.log  ← yesterday's rotated log
```

When running directly or in dev mode, all output also goes to the terminal.

Log levels: `error` | `warn` | `info` | `debug` (set via `LogLevel` in `.env`).

---

## 5. Beem Africa SMS Provider

The service uses Beem Africa's `/text/multi` endpoint for bulk delivery. All pending rows for the same message text are sent in a single API call.

**Endpoint:** `POST https://messaging-service.co.tz/api/sms/v2/text/multi`
**Auth:** `Authorization: Bearer <BEEM_TOKEN>`

**Request body:**

```json
{
  "messages": [
    {
      "from": "DP WORLD",
      "to": ["255716718040", "255686123903", "255767245612"],
      "text": "Your message here.",
      "flash": 0,
      "reference": "1"
    }
  ]
}
```

**Success response (HTTP 200):**

```json
{
  "messages": [
    {
      "to": "255716718040",
      "status": {
        "groupId": 18,
        "groupName": "PENDING",
        "id": 51,
        "name": "ENROUTE (SENT)",
        "description": "Message sent to next instance"
      },
      "messageId": 349489837205630519,
      "smsCount": 1,
      "price": 16
    }
  ]
}
```

A row is marked **sent** if the per-recipient `groupName` matches `PENDING`, `ENROUTE`, `DELIVERED`, or `SENT`. If Beem returns no per-recipient entry, the overall HTTP 200 is used as the success signal.

The `to` field in the DB may be stored in local format (e.g. `0762716079`). The service normalises numbers to digits-only and matches Beem's E.164 response (`255762716079`) by comparing the last 9 digits.

**Test Beem credentials without touching the DB:**

```bash
node scripts/test-beem.js 255762716079 "Hello, this is a test."
```

---

## 6. SMS Allow List

`SMS_ALLOW_LIST` controls which numbers the service will actually send to:

| Value | Behaviour |
|-------|-----------|
| `*` | Send to all numbers in the queue (production default) |
| `0762716079,0716718040` | Only send to these numbers; all others are logged and skipped |

Numbers are compared after stripping all non-digit characters, so `0762716079` and `255762716079` both match `0762716079` in the list.

---

## 7. Alerts Table Schema (Alert_Module)

| Column | Type | Role |
|--------|------|------|
| `Id` | `int` | Primary key; controls send order (ORDER BY Id ASC) |
| `To` | `varchar` | Recipient phone number |
| `Message` | `nvarchar` | Message body |
| `AlertTypeId` | `int` | `2` = SMS |
| `StatusId` | `int` | `1` = pending, `2` = sent, `3` = failed |
| `Retries` | `int` | Remaining send attempts |
| `RegionId` | `int` | Used by email poller to pick SMTP config from eqPortal |

Rows are fetched in `Id ASC` order. Since the queue system inserts Issued alerts before Called alerts before Served alerts, this naturally preserves the correct lifecycle order for every ticket number without any per-number filtering logic.

---

## 8. Adding Another SMS Provider

1. Create `src/sms/providers/<name>.js`:
   ```js
   module.exports = {
     name: 'MyProvider',
     async sendSMS({ to, message, row, config, log }) {
       // call the API
       return { ok: true, info: '<response>' };
     },
     // optional: implement sendBatch for bulk delivery
     async sendBatch({ rows, config, log }) {
       // returns [{ row, ok, info }, ...]
     },
   };
   ```
2. Register its type number in `src/sms/providers/index.js`.
3. Add credentials to `.env` and `src/config.js`.
4. Set `SMSServiceType` to that number in `.env`.

If `sendBatch` is exported, the poller uses it (one API call per unique message text). If not, it falls back to individual `sendSMS` calls with `NumberOfThreadsForSMS` concurrency.

---

## 9. Project Structure

```
alert-sender-node/
├── src/
│   ├── index.js                Entry point — starts both pollers, handles SIGINT/SIGTERM
│   ├── config.js               Loads .env, decrypts CRYPT: values via legacy CryptorEngine
│   ├── crypto.js               3DES-ECB/MD5 port of the original CryptorEngine (backward compat)
│   ├── logger.js               Winston rolling-file logger
│   ├── db.js                   Lazy mssql connection pools (Alert_Module + eqPortal)
│   ├── email/
│   │   └── emailService.js     Email poller (sp_GetMessages / sp_UpdateStatus)
│   └── sms/
│       ├── smsService.js       SMS poller (direct Alerts table SQL, batch send logic)
│       └── providers/
│           ├── index.js        Registry keyed by SMSServiceType integer
│           ├── beem.js         Beem Africa — sendSMS + sendBatch (type 18)
│           └── onfon.js        ONFON Media (type 17) — reference port
├── scripts/
│   ├── test-beem.js            Send one test SMS via Beem without touching the DB
│   ├── install-service.js      Register as a Windows Service (run as Admin)
│   └── uninstall-service.js    Remove the Windows Service registration
├── Log/                        Rolling log files (gitignored)
├── .env                        Local config (gitignored — do not commit)
├── .env.example                Config template
└── package.json
```

---

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing required environment variables` | Fill in all fields in `.env` |
| `Login failed for user` | Check `User Id` / `Password` in the connection string |
| `Connection timeout on DB` | Verify the IP, port `1433`, and firewall rules allow TCP |
| `Could not connect to named instance` | Use `Server=IP,PORT` format — drop the `\INSTANCENAME` suffix |
| `HTTP 401 on Beem` | Check `BEEM_TOKEN` in `.env` |
| `Duplicate request sent within past 24 hour(s)` | Beem dedup guard — expected when resending the same test rows; not an issue in production with fresh data |
| `Number of SMS found N` but nothing sent | Check `SMS_ALLOW_LIST` — the number may be filtered out |
| `messages field is required` | You are hitting `/text/multi` with a flat body — the endpoint requires `{ "messages": [{...}] }` wrapper |
| SMS rows stuck at StatusId 3 | Retries drained or manual failure; reset with `UPDATE Alerts SET StatusId=1, Retries=3 WHERE ...` |
| Windows Service not starting | Run `install-service.js` as Administrator; check Event Viewer for errors |
