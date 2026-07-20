# Public launch final checklist

Updated: 2026-07-19

This checklist separates code-complete work from evidence that only production providers, real consented data, or the founder can supply. A box is not checked from configuration alone: use the proof command or observed event named beside it.

## Phase 1 — Product surface (code complete)

- [x] Empty signed-in workspaces route to a three-choice onboarding: Connect Gmail, Paste receipts, See a sample audit.
- [x] The initial Connect surface contains no statement/CSV/API/key language; richer source controls appear progressively.
- [x] Sample seed → explore → clear is desktop/mobile Playwright- and axe-proved.
- [x] Ledger aggregates, renewal-window totals, verified-savings totals, and proof-graph aggregates have tappable composing evidence; per-item money still opens its detail sheet.
- [x] Task empty states used in the primary workspace have one sentence and one action.
- [x] Android PWA icons include maskable coverage; iOS metadata now has generated startup images for representative phone/tablet sizes.

Proof: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e -- sample-workspace`, and `npm run test:e2e -- signed-in-first-value`.

## Phase 2 — Weekly value loop (code complete; production delivery proof pending)

- [x] Migration `0022_weekly_digest` adds a separate default-off digest toggle and idempotent weekly delivery table.
- [x] Notification consent remains active only while reminders or digest are enabled; disabling both withdraws it.
- [x] Monday/local-hour scheduling, empty-ledger suppression, bounded retries, lock recovery, and one row per preference/week are implemented.
- [x] Digest content keeps INR and foreign currencies separate and includes burn, next seven days, and one deterministic INR suggestion.
- [x] Delivery rows contain no email, merchant, amount, evidence, token, or payload; values resolve only after claim.
- [x] Preference UI, API, privacy export, readiness aggregates, unit tests, and PostgreSQL integration coverage include the digest.
- [ ] Configure Resend/cron in production, opt in a disposable account, observe a cron-sent digest, then set `RENEWAL_ALERT_DELIVERY_STATUS=production-live` only after evidence exists.

Proof: `npm run ci:database`; then follow [renewal-alerts-runbook.md](renewal-alerts-runbook.md).

## Phase 3 — Real-data quality gates (collection pending)

- [x] Statement corpus gate exists and fails strict mode until 100 consented/redacted real fixtures achieve ≥97% precision and ≥92% recall.
- [x] Receipt corpus gate exists and fails strict mode until 200 consented/redacted real fixtures achieve ≥97% precision, ≥92% recall, and p95 first result under five seconds.
- [ ] Collect and consent 100 real statement fixtures; keep them outside Git and run `npm run corpus:strict`.
- [ ] Collect and consent 200 real receipt fixtures; keep them outside Git and run `npm run receipt-corpus:strict`.

Never replace these gates with synthetic fixtures. Use [receipt-corpus-runbook.md](receipt-corpus-runbook.md).

## Phase 4 — Production foundation (external environment)

- [ ] Apply migrations through `0022_weekly_digest` to production and verify `/api/readiness` reports `capabilities.schema.status=ready`.
- [ ] Configure production session, token vault, database, shared rate limiting, monitoring, encrypted backups, and restore drill.
- [ ] Prove deployed sync, retention, and renewal cron invocations before setting their `production-live` attestations.
- [ ] Complete Razorpay KYC, legal approval, signed webhook, settlement/refund/replay/reconciliation proofs for the INR 999 assisted audit.
- [ ] Complete Google identity or magic-link delivery proof and a production canary account.

Proof: `npm run ops:preflight` and `npm run production:check -- https://www.vognary.com --strict`.

## Phase 5 — Public connector boundary (external provider/legal)

- [ ] Google approves `gmail.readonly`; configure production client, secret, exact redirect URI, and `GOOGLE_OAUTH_VERIFICATION_COMPLETE=true`; prove connect, sync, revoke, reconnect, and deletion.
- [ ] Complete FIU/TSP agreement and production Account Aggregator approval; configure a non-sandbox Setu FIU endpoint and credentials; set `ACCOUNT_AGGREGATOR_PARTNER_STATUS=production-live` only after a real consent/sync/revoke canary.
- [ ] Run `npm run core-connectors:check`; `/api/readiness` must report `hardening.coreConnectorLaunch=production-live`.
- [ ] UPI and card mandate rails remain manual/partner-blocked and claims-safe. They are not public-launch blockers.
- [ ] Continue UPI/card partner work; `npm run partner-rails:check` is the later full-moat gate and remains red until all three rails are production-live.

## Phase 6 — Canary and release

- [x] One-command `npm run release:gate` owns code CI, disposable-database integration, desktop/mobile E2E + axe, local production smoke, loopback-only load budgets, both private corpora, operations preflight, and strict production probes; it refuses to test against the production database.
- [x] The load budget drives `/api/audit` at 200 rps for 10 seconds with p95 <300ms and ingests 20 concurrent readable 8MB PDFs; the command permanently refuses remote targets.
- [ ] Deploy the exact CI-green commit; rerun strict activation against the deployed origin.
- [ ] Run one fresh-user journey on desktop and mobile: landing → sign in → Gmail/AA consent → first sync → Home → proof → decision → digest preference → disconnect/delete.
- [ ] Verify monitoring alert delivery, audit logs, backup/restore evidence, privacy export, consent withdrawal, and deletion.
- [ ] Run a small invite canary, review errors/sync latency/first-value timing for 24–48 hours, and stop if any fail-closed boundary regresses.
- [ ] Promote publicly only when strict activation, both private corpus gates, and the canary checklist are green.

Preview safely with `npm run release:gate -- --plan https://www.vognary.com`. Run the real command only with `RELEASE_CONFIRM_DISPOSABLE=true` and a separately provisioned disposable release database.

## Current honest remainder

No known code-owned launch package remains unimplemented in this checklist. The remaining red boxes require production credentials, provider/regulatory approval, operator evidence, payment/legal activation, real consented corpora, or an observed canary. Those must stay red until the evidence exists.
