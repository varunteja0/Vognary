# Intake Webhook → Google Sheet (Day-0 setup, ~30 min)

Purpose: make every `/private-audit` intake submission persist to a free Google Sheet,
so no lead is lost even without `DATABASE_URL`. The API route
(`src/app/api/audit-intake/route.ts`) already POSTs the lead JSON to
`AUDIT_INTAKE_WEBHOOK_URL` — this doc only configures the receiving end. No code changes.

How the route behaves once the env var is set:

- **If `DATABASE_URL` is configured in production:** the database stays the primary
  store and the webhook receives a mirror copy of every lead (best-effort, non-blocking).
- **If not:** the webhook is the sole store; a failed webhook returns HTTP 502 to the
  submitter, so verify it works before outreach.

## Step 1 — Create the Sheet + Apps Script (10 min)

1. Create a new Google Sheet named **Vognary Leads** (keep it private; it will hold PII).
2. In the Sheet: **Extensions → Apps Script**. Delete the placeholder code and paste:

```javascript
const SHEET_NAME = "Leads";

// Exact payload keys sent by src/app/api/audit-intake/route.ts
const COLUMNS = [
  "createdAt", "source", "name", "email", "contact", "persona", "spendGuess",
  "paymentTypes", "sourceTypes", "biggestConcern", "message", "score",
  "consentPurpose", "consentNoticeVersion", "consentGrantedAt",
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    sheet.appendRow(COLUMNS.map(function (key) { return formatCell_(data[key]); }));
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = doc.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = doc.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function formatCell_(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
```

3. Save (name the project `vognary-intake-webhook`).

## Step 2 — Deploy as a web app (5 min)

1. **Deploy → New deployment → type: Web app.**
2. Execute as: **Me**. Who has access: **Anyone**. (The `/exec` URL is a long unguessable
   token; that is the access control. Never post the URL anywhere public.)
3. Authorize when prompted, then copy the **Web app URL** ending in `/exec`.

> Gotcha: editing the script later does NOT update the live URL. You must
> **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** after any edit,
> or the `/exec` URL keeps serving the old code.

## Step 3 — Set the env var in Vercel (5 min)

1. Vercel → project → **Settings → Environment Variables**.
2. Add `AUDIT_INTAKE_WEBHOOK_URL` = the `/exec` URL, scope **Production** (add Preview
   too if you demo from previews).
3. **Redeploy** — env changes only apply to new deployments.

## Step 4 — Verify before any outreach (10 min, mandatory)

1. Readiness: `curl -s https://www.vognary.com/api/audit-intake` must return
   `"status":"ready"` with `"persisted":true`. A 501 means the env var didn't take.
2. Disposable submission: open `https://www.vognary.com/private-audit?src=webhook-test`,
   submit a throwaway lead, and confirm:
   - the page reports success (not "prepared-not-persisted"),
   - a row appears in the Sheet with `source` = `vognary-private-audit-intake:webhook-test`,
   - `paymentTypes` / `sourceTypes` render as comma-joined lists.
3. Delete the test row. Outreach may start only after this passes — same rule as the
   operator sheet's attribution check.

> Caveat: Apps Script web apps return HTTP 200 even when the script itself throws
> (you get an HTML error page, not a 500). The route's `response.ok` check therefore
> cannot catch script bugs — the disposable submission above is the only real test.
> Re-run it after any script edit.

## Privacy notes (leads are PII)

- The Sheet stays private to your Google account. Do not share the Sheet or the
  `/exec` URL. Consent fields (`consentPurpose`, `consentNoticeVersion`,
  `consentGrantedAt`) arrive with each row — keep them; they are your processing basis.
- If a lead asks for deletion, delete their Sheet row (and DB row if `DATABASE_URL`
  is active) — the consent purpose is `private-audit-contact` only.
- When Day-30 gate passes and volume grows, migrate leads to the database and retire
  the Sheet; this setup is deliberately the ₹0 interim rail.
