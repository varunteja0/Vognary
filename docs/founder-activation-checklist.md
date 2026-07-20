# Founder Activation Checklist — every manual step, click by click

Everything code-side is shipped and verified. This file is the complete list of
steps only the founder can perform (accounts, secrets, paperwork, sends).
Do them in order; each block ends with a verification step — do not skip it.

## The ordered chain — what to do, in what order, and the command that proves it

Composite readiness is scored on the **minimum row** (`docs/path-to-10.md`), so
the fastest path up is always the lowest unproven row below. Blocks B, D, F,
and G have external lead times — start them early and run them in parallel;
everything else is sequential.

| # | Block | Owner | Expected duration | What it unlocks | Proof |
| --- | --- | --- | --- | --- | --- |
| 1 | A — Production env, Resend, cron | Founder | ~45 min + overnight cron check | Persistence, alerts, intake, signed packs | `npm run ops:preflight` (all P0 rows pass) |
| 2 | B — Google restricted-scope verification (G-A) | Founder + Google review | ~1 h to submit; 2–8 weeks review + CASA assessment | Public Gmail read-only rail | `npm run core-connectors:check` |
| 3 | D — Partner-rail outreach → AA sandbox (G-B) | Founder + partner | 30 min first send; days–weeks to sandbox | Bank-rail sandbox; first-sync moment | `npm run partner-rails:check` |
| 4 | F — Consented evidence corpora | Founder + consenting users | Rolling until ≥100 statements, ≥200 receipts | Parser-quality strict gates | `npm run corpus:strict && npm run receipt-corpus:strict` |
| 5 | G — Razorpay KYC + legal sign-off | Founder + counsel + Razorpay | 1–3 weeks | ₹999 assisted-audit checkout | `npm run production:check -- https://www.vognary.com --strict` |
| 6 | C — AWS Cost Explorer demo asset | Founder | 15 min (+24 h for data) | Live connector demo | Workspace shows AWS evidence |
| 7 | E — Standing business steps | Founder | Daily | Revenue validation (the scoring floor) | `npm run research:check` + tracker log |
| 8 | H — FIU/TSP production agreement (G-C) | Founder + partner + compliance | 4–10 weeks (needs Block D) | Production regulated bank rail | Authenticated `/api/readiness` → `hardening.coreConnectorLaunch` = `production-live` |
| 9 | I — Release canary | Founder | 24–48 h (after 1–8) | Public launch | `docs/public-launch-final-checklist.md` Phase 6 evidence |

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

### A3. Verify shared Postgres rate limiting (5 min)

1. Apply the production schema through `0017_shared_rate_limits`.
2. Redeploy and call authenticated `/api/readiness`.
3. Confirm `hardening.sharedRateLimiting` is `configured-postgres`.

Upstash is optional at higher traffic. If added later, configure both REST variables and confirm readiness changes to `configured-upstash-rest`.

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
6. Machine proof: `npm run ops:preflight` against the production target — every
   P0 row must pass. Email delivery proof: `npm run monitoring:test`.

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
   annual, budget for it). Expect 2–8 weeks end to end, and prepare a short
   screen-recorded demo video of the full consent → sync → disconnect → delete
   flow — Google's reviewers ask for it. Set
   `GOOGLE_OAUTH_VERIFICATION_COMPLETE=true` only when Google confirms approval.
10. Machine proof: `npm run core-connectors:check` — the Gmail rail row must
    report launch-ready with verification complete.

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
5. When a partner grants sandbox access (G-B): set the `SETU_AA_CLIENT_ID`,
   `SETU_AA_CLIENT_SECRET`, `SETU_AA_PRODUCT_INSTANCE_ID`, and sandbox
   `SETU_AA_BASE_URL` env values, and advance the status env through
   `sandbox-requested` → `sandbox-approved` — each value only after it is
   literally true.
6. Machine proof: `npm run partner-rails:check` — the reported stage must match
   the paperwork you actually hold, nothing further.

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

---

## Block F — Consented evidence corpora (rolling; gates parser quality)

The statement and receipt parsers are gated on real, consented, redacted
fixtures — force-greening with synthetic data is deliberately rejected, and the
fixtures stay out of Git.

1. Follow `docs/receipt-corpus-runbook.md` for collection, consent language,
   redaction, and storage location.
2. Targets: at least **100 redacted statement ranges** and **200 receipts**,
   spread across the banks and merchants real users actually have.
3. Machine proof: `npm run corpus:strict && npm run receipt-corpus:strict` —
   both must pass on real fixture counts, not report `collection-required`.

---

## Block G — Razorpay activation and legal sign-off (1–3 weeks; unlocks the ₹999 SKU)

1. Complete Razorpay KYC for the operating entity and create live keys; add
   `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in Vercel.
2. Qualified legal review of the Terms, including the refund boundary (Terms
   §12: full refund before evidence review begins). Set
   `ASSISTED_AUDIT_LEGAL_TERMS_STATUS` only after counsel approves.
3. Prove each payment control against the live account — signed webhook
   delivery, replay rejection, a real refund, and reconciliation — and set the
   matching `RAZORPAY_*_STATUS` attestation only after each observed proof.
4. Machine proof: `npm run production:check -- https://www.vognary.com --strict`
   — the payments row must clear, with no attestation set ahead of its evidence.

---

## Block H — FIU/TSP production agreement (4–10 weeks; the regulated bank rail, G-C)

Prerequisite: Block D has reached a working sandbox.

1. Convert the winning AA/TSP sandbox relationship into a production agreement:
   FIU onboarding, compliance review, and consent-artifact audit per the
   partner's process.
2. Only when the partner confirms production access: set production
   `SETU_AA_*` values and `ACCOUNT_AGGREGATOR_PARTNER_STATUS=production-live`.
3. Machine proof: authenticated `/api/readiness` must report
   `hardening.coreConnectorLaunch` = `production-live`, and
   `npm run partner-rails:check` must agree.

---

## Block I — Release canary (24–48 h; the last gate before public)

1. Run one fresh desktop and one fresh mobile journey through the canonical
   paths, then hold a 24–48 hour invite-only canary before announcing.
2. The journey list, evidence format, and sign-off ledger are owned by
   `docs/public-launch-final-checklist.md` (Phase 6) — record the canary there,
   not here.
