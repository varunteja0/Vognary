# Vognary 7-Day Execution Plan

Date anchor: start the clock the day this plan is adopted. The goal of the week is paid validation and production activation — not new surface area. Build only what a paying audit or an activation gate demands.

Validation loop to run after every change:

```bash
npm run lint && npm test && npm run build
npm run smoke              # against a running server
npm run production:check -- https://www.vognary.com
npm run ops:preflight -- --report-only https://www.vognary.com
```

## Day 1 — Production gates locked

- [ ] Set/verify production envs: `SESSION_SECRET`, `DATABASE_URL`, `POSTGRES_SSL`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_SYNC_SECRET`, `CRON_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- [ ] Apply schema: `DATABASE_URL='<prod>' POSTGRES_SSL=true npm run db:apply-schema`.
- [ ] Run `npm run production:check -- https://www.vognary.com` and record the output in this file's log section.

**Gate G1:** `/api/readiness` reports database, token vault, session, and rate limiting ready. Do not proceed to invite users until G1 passes.

## Day 2 — Lead + monitoring rails

- [ ] Configure `AUDIT_INTAKE_WEBHOOK_URL` (Make/Tally → Sheet) so `/private-audit` persists leads.
- [ ] Configure `SENTRY_DSN` or `BETTER_STACK_SOURCE_TOKEN`; run `npm run monitoring:test -- https://www.vognary.com` and confirm `delivered`.
- [ ] Run one encrypted backup + restore drill (`npm run backup:postgres`, `npm run backup:restore-drill`); set `BACKUP_RESTORE_DRILL_STATUS=passed` only if it truly passed.

**Gate G2:** Lead persistence READY, monitoring delivered, restore drill passed. Do not store any user financial files before G2.

## Day 3 — Private audit sales push (first 10 asks)

- [ ] Send 10 personal private-audit offers from `docs/private-audit-outreach-kit.md` to founders/operators who complain about SaaS/AI/UPI renewals.
- [ ] Complete qualified legal review and Razorpay test-mode proof for the tracked `assisted-audit` checkout. Do not use untracked static links.
- [ ] Complete 2 audits manually using the product (sample → their evidence), export audit packs, deliver.

**Gate G3:** ≥5 audit conversations started, ≥2 audits delivered. If nobody will share even redacted evidence, stop and fix the trust pitch before more outreach.

## Day 4 — Gmail activation for test users

- [ ] Configure Google OAuth envs; add 5 beta users as test users on the consent screen.
- [ ] Run one real Gmail receipt sync per test user; confirm candidates land in the ledger and merge with statement evidence.
- [ ] Submit the Google verification request (homepage, privacy, terms, scope justification). Verification takes time — submit now, do not wait for it.

**Gate G4:** ≥3 test users connected Gmail and saw real recurring candidates. Do not invite non-test Gmail users until Google verification completes.

## Day 5 — Scheduled source proof

- [ ] Store one OpenAI admin key and one other provider token (GitHub/Vercel/Render/Cloudflare) through the product UI for a real workspace.
- [ ] Confirm the cron runner executes due jobs and `connector_evidence` receives rows (`/api/internal/sync-jobs/due/run` with secret).
- [ ] Show existing audit users the proven scheduled-source refresh and renewal-calendar capability without quoting or promising a monitoring SKU.

**Gate G5:** At least one scheduled sync wrote evidence without manual help. This proves source refresh only; it does not authorize a monitoring offer.

## Day 6 — Paid conversion

- [ ] Follow up every delivered audit with the one-time INR 999 assisted-audit offer only when tracked checkout is activated; do not pitch an unimplemented monitoring SKU.
- [ ] Record objections verbatim in `docs/validation-playbook.md`.
- [ ] Ask each payer for the one missing source they most want connected — this reorders the connector roadmap by evidence, not guesses.

**Gate G6:** ≥3 users pay after seeing value, or ≥3 explicitly commit to pay when a named connector lands. If praise is high but payment is zero, pause feature work and rework pricing/packaging before Day 7.

## Day 7 — Partner rails + decision

- [ ] Send AA/TSP outreach from `docs/partner-rails-access-playbook.md` to 3 shortlisted providers; log in `docs/partner-rails-outreach-tracker.csv`; set `ACCOUNT_AGGREGATOR_PARTNER_STATUS=outreach-started` (validate with `npm run partner-rails:check`).
- [ ] Send 2 PSP/payment-aggregator asks for mandate visibility APIs.
- [ ] Write the week's Stop/Go decision against the criteria in `docs/current-state-and-market-gap-analysis.md` (5 audits, 3 payers, 60% avoidable-item rate, monitoring demand).

**Gate G7 (scale gate):** Only widen marketing if G1–G6 all passed. Otherwise repeat the loop with the same gates.

## Stop Conditions — what must NOT be claimed or launched

- Do not claim direct UPI/card-mandate or bank sync anywhere until a partner rail status is `production-live` and one production consent test succeeded.
- Do not claim universal Apple/Google Play subscription sync — those APIs are developer-app-scoped; receipt/manual evidence is the honest path.
- Do not invite non-test Gmail users before Google restricted-scope verification completes.
- Do not store user financial documents before the backup restore drill has passed and encrypted object storage exists.
- Do not run paid campaigns while rate limiting is in-memory (`ALLOW_IN_MEMORY_RATE_LIMITS` must not be set in production).
- Do not announce paid checkout before one Razorpay test payment settles.

## Rollback Conditions

- Lead webhook leaking or failing → remove `AUDIT_INTAKE_WEBHOOK_URL`; the site falls back to preview mode safely.
- Provider sync writing bad evidence → disconnect the connected account (user-facing delete works), pause the sync job, keep the manual path.
- Monitoring noise → keep Sentry/Better Stack but alert only on server errors and cron failures.
- Any suspicion of token compromise → rotate `TOKEN_ENCRYPTION_KEY` procedure: revoke provider keys first, delete token refs, re-invite connections. Never rotate silently.

## Log

Record gate results here with dates as they happen:

| Date | Gate | Result | Notes |
| --- | --- | --- | --- |
