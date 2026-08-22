# Founder-ops setup — click-by-click

The **only** things that block production/AI/rails. The code is already written and
degrades safely without these; each one just needs an external account + a key.

> **Reality check first (THE-LAW):** none of this raises the business floor by
> itself. The highest-leverage action is still **running real audits (Phase A)**.
> Do **#1 (AI key, 5 min)** and **#6 (corpus, as audits come in)** early; the rest
> (Google, Resend, monitoring, Razorpay, Setu) unlock **Phase C/D**, which come
> *after* market signal. Don't rathole here before you've done 5 audits.

> **Note on labels:** provider dashboards rename buttons often. The **flow** and the
> **env-var names** (what your code actually reads) are what matter — if a label
> differs, pick the nearest equivalent.

---

## 0. Where the keys go (do this once)

Three targets:

| Target | File / place | Used for |
| --- | --- | --- |
| **Local dev** | `.env.local` (copy from `.env.example`) | `npm run dev` on your machine |
| **Local prod-probe** | `.env.production.local` | `npm run production:check`, `release:gate` read this |
| **Live site** | your host's env settings (e.g. **Vercel → Project → Settings → Environment Variables**, scope = Production) | the deployed app |

```bash
cp .env.example .env.local     # then paste keys into .env.local
```

⚠️ **Never commit `.env.local` / `.env.production.local`** (they're git-ignored). Never
set any `*_STATUS=...` value until the matching real proof exists — those are
attestations, not evidence, and the honesty gate treats a blank as "not proven."

---

## 1. `ANTHROPIC_API_KEY` + `AI_MONTHLY_BUDGET_INR` — live AI (5 min)

**Click-by-click**
1. Go to **https://console.anthropic.com**
2. Sign in (or create an account).
3. Settings (or **Billing**) → add a payment method.
4. Left sidebar → **API keys**.
5. Click **Create Key** → name it `Vognary` → **Create**.
6. **Copy the key now** (`sk-ant-…`) — it's shown only once.

**Set**
```
ANTHROPIC_API_KEY=sk-ant-...
AI_MONTHLY_BUDGET_INR=2000        # your monthly ₹ cap; enforced in src/lib/server/ai/budget.ts before any model call
```

**Verify**
- `npm run dev`, then open **http://localhost:3000/api/ai/status** → it should report the AI layer as available/keyed (blank key = "deterministic-only", which is the honest default).
- Models are already chosen (Haiku for extraction, Sonnet for narration — `src/lib/server/ai/models.ts`). Nothing to configure.

---

## 2. Google `gmail.readonly` — Gmail receipt sync (client: 15 min · verification: days–weeks)

Two parts: create the OAuth client (fast), then submit for Google verification (slow).

**A. Create the OAuth client**
1. Go to **https://console.cloud.google.com**
2. Top project dropdown → **New Project** → name `Vognary` → **Create** → select it.
3. **APIs & Services → Library** → search **Gmail API** → **Enable**.
4. **APIs & Services → OAuth consent screen**:
   - User type **External** → **Create**.
   - Fill app name `Vognary`, support email, logo, app homepage, **authorized domain** `vognary.com`, developer contact → **Save and continue**.
   - **Scopes → Add or remove scopes** → search `gmail.readonly` → tick `.../auth/gmail.readonly` (this is a **restricted** scope → triggers verification) → **Update → Save**.
   - **Test users → Add users** → add your own Gmail (lets you test before verification).
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type **Web application**, name `Vognary web`.
   - **Authorized redirect URIs → Add URI**, add both:
     - `http://localhost:3000/api/integrations/gmail/callback`
     - `https://www.vognary.com/api/integrations/gmail/callback`
   - **Create** → copy **Client ID** and **Client secret**.

**B. Submit for verification** (needed before non-test users)
6. Back on **OAuth consent screen** → **Publish app** → **Prepare for verification**: provide privacy-policy URL (`/privacy`), homepage, a demo video, and a justification for `gmail.readonly`. Google review takes days–weeks.

**Set**
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://www.vognary.com/api/integrations/gmail/callback   # localhost URI for local dev
GOOGLE_OAUTH_VERIFICATION_COMPLETE=                                            # leave BLANK until Google emails "verified"
```
> Separate concern: `GOOGLE_AUTH_*` in `.env.example` is Google **sign-in** (OpenID), not Gmail receipts. Set it only if you also want Google login.

**Verify**
- With your test user: put `GOOGLE_*` in `.env.local`, `npm run dev`, open `/app` → **Connect Gmail** → complete OAuth → callback lands on `/app` with the "what we found" moment.
- Do **not** set `GOOGLE_OAUTH_VERIFICATION_COMPLETE` until Google actually grants verification.

---

## 3. Resend — magic-link + renewal email (15 min + DNS wait)

**Click-by-click**
1. Go to **https://resend.com** → **Sign up**.
2. Left menu → **Domains** → **Add Domain** → enter `vognary.com` → **Add**.
3. Resend shows DNS records (SPF/DKIM `TXT` + `CNAME`). In your **domain registrar/DNS** panel, add each record exactly as shown → back in Resend click **Verify** → wait for **Verified** (minutes–hours).
4. Left menu → **API Keys** → **Create API Key** → name `Vognary`, permission **Sending access** → **Create** → copy (`re_…`).

**Set**
```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Vognary <no-reply@vognary.com>    # address MUST be on the verified domain
```

**Verify**
- Trigger a magic-link sign-in from `/login` and confirm the email arrives. Deeper flow: `docs/renewal-alerts-runbook.md`.
- Renewal alerts only send to users who explicitly opted in.

---

## 4. Monitoring + backup/restore drill → Phase C (30–60 min)

This gate also needs a real Postgres (`DATABASE_URL`), a token key, and a session secret.

**A. Postgres + secrets**
1. Create a managed Postgres (Neon / Supabase / RDS) → copy its connection string.
2. Generate keys:
   ```bash
   npm run secrets:generate-token-key      # → TOKEN_ENCRYPTION_KEY
   ```
   Set `DATABASE_URL=…`, `TOKEN_ENCRYPTION_KEY=…`, and a random `SESSION_SECRET=…`.

**B. Monitoring — pick one**
- **Sentry:** https://sentry.io → **Create Project** → platform **Next.js** → **Settings → Client Keys (DSN)** → copy DSN → set `SENTRY_DSN=https://…`.
- **Better Stack:** https://betterstack.com → **Logs → Connect source** → copy the source token → set `BETTER_STACK_SOURCE_TOKEN=…`.
- (optional) Axiom → `AXIOM_TOKEN=…`.
- **Verify:** `npm run monitoring:test` (needs `INTERNAL_SYNC_SECRET`) sends a synthetic event via `/api/internal/monitoring/test`. Only **after** you see it land, set `MONITORING_DELIVERY_TEST_STATUS` per the runbook.

**C. Backup + restore drill**
1. `npm run secrets:generate-backup-key` → set `BACKUP_ENCRYPTION_KEY` and the `BACKUP_KEY_FINGERPRINT` it prints.
2. (optional offsite) create an S3/R2 bucket → set `BACKUP_STORAGE_BUCKET`, `BACKUP_STORAGE_ENDPOINT`, `BACKUP_STORAGE_REGION`, `BACKUP_STORAGE_ACCESS_KEY_ID`, `BACKUP_STORAGE_SECRET_ACCESS_KEY`.
3. Run a backup: `npm run backup:postgres`.
4. Run a **restore drill** into a throwaway DB: set `RESTORE_DATABASE_URL=<disposable pg>` and `RESTORE_CONFIRM_DISPOSABLE=true`, then `npm run backup:restore-drill`.
5. Only **after an observed successful drill**: set `BACKUP_RESTORE_DRILL_STATUS` + `BACKUP_RESTORE_DRILL_AT=<ISO date>` (these show on the trust pages).

**Verify the whole stage:** `npm run production:check -- https://www.vognary.com` (add `--strict` once everything is set). Deep detail: `docs/production-activation-runbook.md`.

---

## 5. Razorpay + legal terms — deferred; retired checkout must stay off

The one-time ₹999 assisted-audit checkout was retired on 2026-08-21. `/private-audit`, `/api/audit-intake`, and `/api/checkout` cannot be reactivated by setting environment variables. Do not provision Razorpay merely to make readiness look complete.

Razorpay, tax, privacy, refund, and legal approval become founder work only after first-10 proof supports a current paid offer. Historical settlement/refund handling is documented in `docs/billing-activation-runbook.md`.

---

## 6. 10–20 redacted real statements → corpus → Phase D (data task, not a dashboard)

**Steps**
1. Collect **consented, redacted** real Indian bank/card statements (CSV/PDF exports).
2. **Redact before adding** — strip account/card numbers, PAN, Aadhaar, IFSC, phone, UPI handles, names, emails (`corpus/README.md`).
3. Drop files under `corpus/statement-fixtures/` (**git-ignored — never committed**).
4. `cp corpus/manifest.example.yaml corpus/manifest.yaml`, then add one entry per file: `file`, `institution`, `provenance: consented-redacted-real`, an **opaque** `consentReference` (e.g. `consent-audit-000001` — never a name), and the `expected` recurring items.
5. `npm run corpus` → report at `output/corpus-report.json` (shows collection progress below 100 files).
6. At **≥100** consented real fixtures, `npm run corpus:strict` enforces ≥97% precision / ≥92% recall.

> Label any made-up examples `synthetic` — they test the harness but **don't** count toward the 100-file gate. Keep real fixtures in approved encrypted storage. Receipts have their own path: `docs/receipt-corpus-runbook.md`.

---

## 7. Setu Account Aggregator — long-lead rail (sandbox: 30 min · production: weeks)

**Click-by-click (sandbox — self-serve)**
1. Go to **https://bridge.setu.co** → **Sign up** for the **Account Aggregator (FIU)** product.
2. Create an **AA product instance** → note the **Product Instance ID**.
3. Open the instance → copy **Client ID** + **Client Secret** (sandbox).

**Set (sandbox)**
```
SETU_AA_CLIENT_ID=...
SETU_AA_CLIENT_SECRET=...
SETU_AA_PRODUCT_INSTANCE_ID=...
SETU_AA_BASE_URL=https://fiu-sandbox.setu.co       # default; swap to production base URL after go-live
# optional: SETU_AA_REDIRECT_URI (must be registered on the instance), SETU_AA_TAG (only an existing tag)
```

**Production:** requires the **signed FIU agreement** (weeks) → then production base URL + keys. Only per `docs/partner-rails-access-playbook.md` may you set `ACCOUNT_AGGREGATOR_PARTNER_STATUS` (exact values only). Sandbox ≠ live — never set a partner `*_STATUS` to production-live without the signed agreement + proof.

---

## Verify everything at the end

```bash
# per-stage endpoint + config check (loads .env.production.local)
npm run production:check -- https://www.vognary.com
npm run production:check -- https://www.vognary.com --strict   # only when ALL of the above are set

# operator preflight (env contract sanity)
npm run ops:preflight
```

## Suggested order (by leverage vs. lead-time)

1. **#1 AI key** — 5 min, immediate product upgrade.
2. **#6 corpus** — start as soon as you have real audits; feeds Phase D.
3. **#2 Google** and **#5 Razorpay** and **#7 Setu** — kick off **now** because their *approvals* take weeks, even if you finish config later.
4. **#3 Resend**, **#4 monitoring+backup** — needed for Phase C production launch; do once you're deploying for real users.
