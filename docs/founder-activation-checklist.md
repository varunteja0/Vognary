# Founder Activation Checklist — every manual step, click by click

Everything code-side is shipped and verified. This file is the complete list of
steps only the founder can perform (accounts, secrets, paperwork, sends).
Do them in order; each block ends with a verification step — do not skip it.

---

## Block A — Vercel environment variables (one sitting, ~45 min)

### A1. Generate the audit-pack signing keys (5 min, on your Mac)

```bash
node -e "const{generateKeyPairSync}=require('crypto');const{publicKey,privateKey}=generateKeyPairSync('ed25519');console.log('PRIVATE:');console.log(privateKey.export({type:'pkcs8',format:'pem'}));console.log('PUBLIC:');console.log(publicKey.export({type:'spki',format:'pem'}))"
```

Copy both blocks somewhere temporary (delete after Step A3).

### A2. Generate the cron secret (1 min)

```bash
openssl rand -hex 32
```

### A3. Create the Upstash Redis database (10 min)

1. Go to `https://console.upstash.com` → sign up / sign in (GitHub login is fine).
2. Click **Create Database** → name `vognary-prod` → region: pick the closest to
   your Vercel region (Mumbai/Singapore) → **Create**.
3. On the database page, scroll to the **REST API** section.
4. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (two fields shown there).

### A4. Create the Resend key and sender (10 min)

1. Go to `https://resend.com` → sign up → **API Keys** → **Create API Key** →
   name `vognary-prod`, permission "Sending access" → copy the key (shown once).
2. **Domains** → **Add Domain** → `vognary.com` → Resend shows 3 DNS records →
   add them in your DNS provider → wait for **Verified**.
3. Your sender address is then `alerts@vognary.com`.

### A5. Enter everything in Vercel (10 min)

Vercel dashboard → your project → **Settings → Environment Variables** →
for each row below click **Add New**, paste, scope **Production**, **Save**:

| Name | Value |
| --- | --- |
| `AUDIT_PACK_SIGNING_PRIVATE_KEY` | the PRIVATE PEM from A1 (paste the whole block, BEGIN/END lines included) |
| `AUDIT_PACK_SIGNING_KEY_ID` | `vognary-2026-07` |
| `AUDIT_PACK_TRUSTED_PUBLIC_KEYS` | `{"vognary-2026-07":"<PUBLIC PEM from A1, with newlines replaced by \n>"}` |
| `CRON_SECRET` | the hex string from A2 |
| `UPSTASH_REDIS_REST_URL` | from A3 |
| `UPSTASH_REDIS_REST_TOKEN` | from A3 |
| `RESEND_API_KEY` | from A4 |
| `RESEND_FROM_EMAIL` | `alerts@vognary.com` |
| `AUDIT_INTAKE_WEBHOOK_URL` | the Apps Script `/exec` URL — full setup in `docs/intake-webhook-setup.md` (10 steps, ~30 min, do it now if not done) |

Then: **Deployments** tab → latest deployment → **⋯ → Redeploy** (env changes
only apply to new deployments).

### A6. Verify Block A (15 min)

1. `curl -s https://www.vognary.com/api/audit-intake` → must show `"status":"ready"`.
2. Open `https://www.vognary.com/private-audit?src=webhook-test` → submit a throwaway
   lead → row appears in your Google Sheet → delete the row.
3. Sign in to your workspace → export a **Sealed pack (JSON)** → open
   `https://www.vognary.com/verify` → upload it → it must now show the **Vognary
   Ed25519 issuer signature** as valid, not just the checksum.
4. **Next morning:** Vercel → project → **Logs**, filter around 00:00 UTC — confirm
   `/api/internal/sync-jobs/due/run` returned 200. Then add env
   `SYNC_SCHEDULER_STATUS` = `production-live` and redeploy. When the first real
   opted-in renewal alert email sends, also set
   `RENEWAL_ALERT_DELIVERY_STATUS` = `production-live`.
5. Delete the temporary key file from A1.

---

## Block B — Google OAuth verification for Gmail sync (submit now; weeks of lead time)

Until approved, Gmail sync works for accounts you add as **test users** (that
includes you, the operator — enough for delivering paid audits today).

1. `https://console.cloud.google.com` → project dropdown → **New Project** →
   name `Vognary` → Create.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** → User type **External** → fill:
   app name `Vognary`, support email, app domain `https://www.vognary.com`,
   privacy policy `https://www.vognary.com/privacy`, terms
   `https://www.vognary.com/terms` → Save.
4. **Scopes** step → **Add or remove scopes** → find and check
   `.../auth/gmail.readonly` → Update → Save.
5. **Test users** step → add your own Gmail address → Save.
6. **APIs & Services → Credentials** → **Create Credentials → OAuth client ID** →
   type **Web application** → name `vognary-prod` → Authorized redirect URI:
   `https://www.vognary.com/api/integrations/gmail/callback` → Create → copy
   the Client ID and Client Secret.
7. Vercel env vars (same flow as A5): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_REDIRECT_URI` = the redirect URI above → Redeploy.
8. Verify: in your signed-in workspace, connect Gmail with your own account —
   receipts appear as evidence.
9. When ready for the public: OAuth consent screen → **Publish app** → follow the
   verification prompts. `gmail.readonly` is a restricted scope: Google will
   require app verification and a CASA security assessment (third-party lab,
   annual, budget for it). Set `GOOGLE_OAUTH_VERIFICATION_COMPLETE=true` only
   when Google confirms approval.

---

## Block C — AWS Cost Explorer for your own account (15 min; demo asset)

1. `https://console.aws.amazon.com` → sign in → search **Billing and Cost
   Management** → open **Cost Explorer** once (first visit enables it; data
   populates within ~24 h).
2. Search **IAM** → **Users → Create user** → name `vognary-cost-readonly` →
   no console access → **Next**.
3. **Attach policies directly** → **Create policy** → JSON tab → paste:
   ```json
   {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ce:GetCostAndUsage"],"Resource":"*"}]}
   ```
   → name `VognaryCostExplorerReadOnly` → create, then attach it to the user → finish.
4. Open the user → **Security credentials → Create access key** → use case
   "Third-party service" → create → copy both values.
5. In your Vognary workspace → Connect → **AWS Cost Explorer** → paste as
   `ACCESS_KEY_ID:SECRET_ACCESS_KEY` (one line, colon between).
6. Note: AWS charges ~$0.01 per Cost Explorer API request — the daily sync
   costs pennies per month.

---

## Block D — Partner-rail outreach (30 min; the Stage-2 clock starts here)

1. Open `docs/partner-rails-founder-comms.md` — the emails are pre-written.
2. Send the Account Aggregator / TSP email to Setu, Finvu, and Decentro
   (contact forms or LinkedIn per `docs/partner-rails-access-playbook.md`).
3. Log each send in `docs/partner-rails-outreach-tracker.csv`.
4. Only after the first send: Vercel env
   `ACCOUNT_AGGREGATOR_PARTNER_STATUS` = `outreach-started` (exact value; the
   playbook forbids anything not literally true).

---

## Block E — the standing business steps (no software involved)

1. Run your **self-audit** — the ₹ number every outreach script needs.
2. Review `docs/research-content-pack-2026-07-16.md`, re-check each live source,
   replace evidence placeholders only with observed facts, and copy approved rows
   into the gitignored private-audit pipeline. `npm run research:check` guards the
   pack's promised row/playbook/message counts.
3. Send **20 personalized messages a day**, logged in the tracker. The paid
   audits are what make Google, AWS partners, and AA TSPs say yes to
   everything above.
