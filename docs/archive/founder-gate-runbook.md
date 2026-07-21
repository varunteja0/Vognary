# Founder gate execution runbook

Updated: 2026-07-19

This is the **do-this-then-verify** companion to [public-launch-final-checklist.md](public-launch-final-checklist.md). Everything here is external/evidence work that code cannot fake: provider approvals, real consented data, payment/legal activation, and operator attestations. Every env-var name below is the exact one the app's verifiers read.

**Ground rule:** a status env var (`*_STATUS=…`, `*_COMPLETE=true`) is an **attestation** — set it only *after* the real evidence exists. Setting it early makes readiness lie. All verifiers are fail-closed: they stay red until the real thing is present.

**Two finish lines:**
- **Private beta:** `npm run production:check -- https://www.vognary.com --beta` → green.
- **Public launch:** `npm run production:check -- https://www.vognary.com --strict` → green (adds the Gmail + Account Aggregator core-connector gate).

---

## Order of operations (dependency-sorted)

Do 0 → 1 first (everything else needs the DB + operator visibility). Gates 2–8 can run in parallel. Gate 9 (corpora) can start today. Gate 10 is the release.

| # | Gate | Founder/provider action | Env to set (exact names) | Verify command → green when |
|---|------|------|------|------|
| 0 | **DB + secrets foundation** | Provision prod Postgres; generate keys | `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, session secret, `CONNECTOR_WEBHOOK_SECRET` | migrations apply through `0022_weekly_digest`; `/api/readiness` `capabilities.schema.status=ready` |
| 1 | **Operator readiness auth** | Put the same secret in prod + your operator env | `INTERNAL_SYNC_SECRET` | `node --env-file=.env.production.local scripts/check-production-activation.mjs https://www.vognary.com --beta` — `/api/readiness` authenticates (not 401) |
| 2 | **Gmail (`gmail.readonly`)** | Google Cloud OAuth client; restricted-scope verification + CASA; add the exact redirect URI | `GOOGLE_CLIENT_ID` (or `GOOGLE_AUTH_CLIENT_ID`), `GOOGLE_CLIENT_SECRET` (or `GOOGLE_AUTH_CLIENT_SECRET`), `GOOGLE_REDIRECT_URI`, `GOOGLE_OAUTH_VERIFICATION_COMPLETE=true` | `npm run core-connectors:check`; then real consent → first sync → refresh → revoke → delete |
| 3 | **Account Aggregator (Setu FIU)** | Signed FIU/TSP agreement; production Setu credentials + non-sandbox endpoint; ≥1 real consent | `SETU_AA_CLIENT_ID`, `SETU_AA_CLIENT_SECRET`, `SETU_AA_PRODUCT_INSTANCE_ID`, `SETU_AA_BASE_URL` (https, non-sandbox), `ACCOUNT_AGGREGATOR_PARTNER_STATUS=production-live` | `npm run core-connectors:check` → `status: production-live`; `/api/readiness` `hardening.coreConnectorLaunch=production-live` |
| 4 | **Razorpay ₹999 assisted audit** | Live KYC; live keys; signed webhook; qualified legal review of Terms/Privacy; run settlement/replay/refund/reconciliation proofs | `RAZORPAY_KEY_ID` (`rzp_live_…`), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, `ASSISTED_AUDIT_LEGAL_TERMS_STATUS=approved`, `RAZORPAY_ACCOUNT_STATUS=live-kyc-approved`, `RAZORPAY_WEBHOOK_PROOF_STATUS=passed`, `RAZORPAY_REPLAY_PROOF_STATUS=passed`, `RAZORPAY_REFUND_PROOF_STATUS=passed`, `RAZORPAY_RECONCILIATION_STATUS=passed` | `GET /api/checkout?plan=assisted-audit` → `status:"ready"`; `npm run billing:reconcile` → zero unresolved. CTA stays hidden until then. |
| 5 | **Resend email** | Verify sender domain + from-address | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL` | opt in a disposable account, run gate 6's renewal cron, observe one reminder **and** one weekly digest delivered; prove opt-out |
| 6 | **Cron schedulers** | Deploy the `vercel.json` crons; set `CRON_SECRET`. After observing real cron-written evidence, set each attestation | `CRON_SECRET`, then `SYNC_SCHEDULER_STATUS=production-live`, `RENEWAL_ALERT_DELIVERY_STATUS=production-live`, `RETENTION_SCHEDULER_STATUS=production-live` | workers return 200 (not 501); ≥2 observed invocations each for sync (`0 0 * * *`), renewal+digest (`30 3 * * *`), savings (`0 4 * * *`), retention (`30 21 * * *`) |
| 7 | **Monitoring** | Pick one provider | `SENTRY_DSN` **or** `BETTER_STACK_SOURCE_TOKEN` **or** `AXIOM_TOKEN` | `npm run monitoring:test` delivers a synthetic event to the provider |
| 8 | **Encrypted backups** | Configure encrypted backup storage; run one real restore drill | `BACKUP_ENCRYPTION_KEY`, `BACKUP_KEY_FINGERPRINT`, then `BACKUP_RESTORE_DRILL_STATUS=passed` | `npm run backup:restore-drill` restores into a disposable DB cleanly |
| 9 | **Real-data quality** | Collect consented, redacted fixtures (never commit them) | `RECEIPT_CORPUS_DIR` / statement corpus dir (both git-ignored) | `npm run corpus:strict` (≥100 statements, ≥97% precision / ≥92% recall) **and** `npm run receipt-corpus:strict` (≥200 receipts, +p95 < 5s) both report `ready` |
| 10 | **Canary + release** | Deploy the CI-green commit; invite 5–10 users | — | `npm run production:check -- https://www.vognary.com --strict` green; `npm run ops:preflight` green; 7-day canary with no P0/P1; then tag the commit |

---

## Notes

- **UPI / card mandates are not launch blockers.** They stay honestly manual/partner-blocked. `npm run partner-rails:check` is the *later* full-moat gate (all three rails `production-live`) and is expected red at launch — do not gate public launch on it.
- **Verification order matters for gate 5/6:** Resend delivery is proven *through* the renewal/digest cron, so configure Resend (5) and cron (6) together, then observe one real send.
- **Where the detail lives:** provider-by-provider steps are in [production-activation-runbook.md](production-activation-runbook.md); the digest opt-in flow is in [renewal-alerts-runbook.md](renewal-alerts-runbook.md); this file is the ordered index that ties each to its one verify command.
- **Nothing here is code work.** The codebase side is complete and CI-green; these gates flip readiness from mock-proven to production-proven.
