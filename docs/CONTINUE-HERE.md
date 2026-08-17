# CONTINUE HERE — live handoff (2026-08-17)

> Read [`docs/THE-LAW.md`](THE-LAW.md) first. This file is **live state only**.
> Market: [`docs/execution/phase-a-market-contact.md`](execution/phase-a-market-contact.md).
> Loop WPs: [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md).
> History: [`docs/execution/scoreboard.md`](execution/scoreboard.md) and `docs/archive/`.

## 0. Founder scope freeze — current strategy

- Canonical product: Vognary automatically knows what a 2–20 person software/AI company is committed to paying for software, shows what is coming, what changed, and why it believes every conclusion.
- First ICP: 2–20 person software/AI companies without finance/procurement ops.
- First rail: billing-email / receipt forwarding. Long-term vision: the control layer for recurring money.
- Only production usability for the first 10 ICP users is in scope. Do not resume Phase B/C/D, merchant identity, absence, alerts, cancellation/autonomous action, AA/banks, Gmail OAuth, generic SaaS management, budgeting, procurement, SSO/SCIM, seats, architecture, or redesign work until real users select it.

## 1. Exact checkout

- Folder: `/Users/varunteja/Desktop/CVT Group/Vognary`
- Branch: `main`.
- Operations commits `5b983bf` and `f9b8a14` are pushed. They add the guarded `0053` migration and exact pre/current encrypted backup-restore profiles.
- Safety commit `4fa6575` (`fix(recovery): honest cadence totals, receipt semantics, token-free veto, dead-code removal`) preserved the whole repair pass on top of `051444f` and is pushed.
- The commitment-graph delta (Phase B/C/D engineering) sits on top of `dce0e5c` and is the convergence candidate.
- Do **not** `git worktree add ../vognary-*`, clone a sibling, or redo WP-A.
- Parked copies: `.fallow/` (gitignored)
- Founder authorized the safety commit, the parser commit, and the `main` convergence.

## 2. What is merged on `main`

- `main` / `origin/main` were at `b2355fb`. This release converges `main` by **fast-forward** to the tested `feat/autopilot-loop` head — no merge commit, no force-push. Verify the SHA with `git rev-parse main origin/main feat/autopilot-loop origin/feat/autopilot-loop`; all four must match before trusting this line.
- WP-A PR #32 `2e3c776` · WP-A.1 PR #33 `d84e778` · WP-A.2 PR #34 `1542dda`
- Recovery v1 PR #31. Public landing is still the audit generation.
- Composite scoreboard remains **1.5**. Do not invent mandates, payments, or reviewer approvals.

## 3. Historical implementation record

The detailed implementation notes below are retained for audit history. Their old activation blocker statements are superseded by sections 4–5.

### Commitment graph — Phase B/C/D engineering (additive `0049`–`0052`, this delta)

Nine pure deterministic modules plus four additive migrations, a derived store and one new product surface. Nothing frozen was rewritten: no monetary arithmetic, no receipt parsing, no cadence detection, no corrections, no provenance, no standing-mandate safety, no applied migration.

**Merchant identity** scores eight signals with a noisy-OR combination. GSTIN is validated against its statutory check character, so a mistyped identifier is discarded rather than trusted as a weak alias. Domains normalize without public-suffix guessing. A fuzzy name alone can never auto-merge, only ask. Receipts naming different registered businesses are blocked. Currency is never crossed — enforced by a database trigger, not by callers. A reversed merge is never proposed automatically again. Today's evidence supplies two real signals: the normalized merchant name and, on forwarded mail, the assessed sender domain with its trust tier.

**Source liveness** is per source, not per workspace: `CURRENT` / `PARTIAL` / `STALE` / `BROKEN` / `BASELINE_ONLY` / `NO_EVIDENCE`. A commitment's coverage is computed only from the sources it cites, so a healthy feed cannot vouch for a merchant it never carried. A forwarded receipt creates one source row per delivery, so automatic rows inherit the shared inbox channel's newest delivery and widest window while a one-off import stays a baseline.

**Absence** yields exactly the five declared outcomes. A window still open, or a subscription with no settled rhythm, yields no conclusion at all. Absence needs trustworthy coverage; a charge actually seen is never suppressed by weak coverage. Absence is never turned into cancellation.

**Commitment state** answers all five required questions and is stored per commitment. Cadence is read back from recorded assertions, never re-derived. Only a settled cancellation reads as ended; a covered quiet window reads as likely ended and withholds prediction.

**Change intelligence** implements exactly the eight declared kinds. Every signal cites evidence, a dated absence window plus the sources that vouch for it, or a named unhealthy source — enforced by a database check. Dedupe keys are deterministic, so re-running against unchanged facts writes nothing.

**Attention and notifications.** Silence is success. Consent, unsubscribe, materiality, prior notification and an unconfigured provider each suppress with a stated reason. Sending is fail-closed. `DELIVERED` is reachable only from a provider callback, and the database refuses to store it without a provider message id and a delivery timestamp.

**Control** offers verified instructions only, drafts assisted cancellations the customer sends themselves, models user-confirmed action as a real consent state machine that stays switched off, and never reports autonomous action as available or route-proven.

**Cancellation outcome** implements the declared lifecycle. `CONFIRMED_BY_SETTLEMENT` is unreachable by every event the module defines and is rejected outright by a database constraint.

**Correction learning** stores structural features only; a database guard function rejects free text, addresses and nested objects. Priors are refused below 50 recorded corrections and returns empty weights with a stated reason.

Two real defects were found and fixed while wiring. Date and timestamp columns arrive from the driver as JavaScript `Date` objects, so the coverage span computed as `NaN` and every workspace silently degraded to partial coverage, suppressing every missing-charge signal. And resolving a change was terminal, so a genuinely missing charge closed during a source outage stayed closed after the source returned; resolution now reopens when the identical occurrence is true again, while supersession and expiry stay final.

**Honest release classification for this delta:** `CODE COMPLETE` = yes. `PRODUCTION CONFIGURATION REQUIRED` = **yes** — production migrations still stop at `0026` against a chain that now runs through `0052`; email sending, receipt inbox, charging and autonomous action stay fail-closed. `REAL-WORLD PROOF REQUIRED` = **yes** — zero real merchants have been identified, zero real changes notified, zero real cancellations verified.

### Sender provenance for forwarded receipts (additive `0048`)

Phase A of the automatic-inbox brief asked for four things. Three already existed in code: the receipt inbox itself (alias derivation, rotation, revocation, signed webhook, replay keys, leases, MIME/nested-RFC822/PDF parsing, retention, tenant isolation), historical backfill through nested `message/rfc822`, and coverage states. **Sender trust did not exist at all** — nothing read SPF, DKIM, DMARC, or `Authentication-Results`. That gap is what this delta closes; nothing else in Phase A was rewritten.

New pure module `src/lib/recovery/sender-provenance.ts` parses RFC 8601 `Authentication-Results` (comment- and quote-aware `;` splitting, method-version tokens, ARC instance prefixes, multiple hops), plus `Received-SPF` results and structural `DKIM-Signature` `d=` tags, and classifies each message into `VERIFIED_SENDER` / `KNOWN_SENDER` / `UNVERIFIED_SENDER` / `SUSPICIOUS_SENDER`. **No cryptography is performed and none is claimed.** `VERIFIED_SENDER` means only that an authority this deployment was configured to trust reported an aligned DKIM pass plus DMARC pass; the stored reason names that authority and says so explicitly. Alignment is conservative — exact match or a label-boundary subdomain in either direction, no public-suffix guessing — so `netflix.com.evil.tld` never aligns with `netflix.com`. Suspicion is raised by a trusted failure verdict, a trusted DKIM pass with no aligned signing domain, a DMARC evaluation for an unaligned domain, or a display name embedding a full email address on a different domain. Bare brand or domain mentions in a display name carry no penalty.

`RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES` is **empty by default**, so `VERIFIED_SENDER` is unreachable on an unconfigured deployment rather than being granted by an unvouched header. Resend's `email.received` payload was checked directly and carries **no** SPF/DKIM/DMARC verdicts, so every signal comes from the raw MIME retrieved through the received-emails API.

Provenance is assessed **per nested message**, not per delivery, because one backfill forward carries many merchants; the forwarding wrapper is a separate message and gets its own (weaker) assessment. Each tier caps what a single receipt may assert — 100 / 80 / 60 / 40 — and appends a plain-language reason. Weak transport never hides evidence; it only stops that evidence from carrying a trusted recurring-money claim on its own. Provenance is accepted **only** on the forwarded-email path, never on a user-submitted paste, so no caller can assert its own tier. It is deliberately **excluded from the materialization request hash**, because a derived assessment can legitimately change between attempts and must not turn a retry into a permanent idempotency `CONFLICT`.

Additive migration `0048_receipt_sender_provenance` stores one immutable assessment per receipt (accepted or rejected) in `recovery_inbound_sender_assessments`: tier, sender domain, trusted authority, parsed assertions, signing domains, reasons. Only domain-level facts are retained — no raw sender address, no alias token, no subject or body. A database `check` makes `VERIFIED_SENDER` impossible without a named authority and sender domain. The immutability trigger permits exactly one update: releasing the transport reference when operational retention clears the inbound event, so the assessment outlives the transport row. Repetition is not evidence — the known-sender history returns only domains already established at `KNOWN_SENDER` or above, so an unverified or suspicious domain cannot promote itself by sending twice. Assessments are included in privacy export and cascade on workspace erasure.

One real defect was found and fixed while wiring: the known-sender lookup initially sat inside the MIME `try` block, so a transient storage error would have been recorded as a terminal `MIME_INVALID` parse failure. It now releases the lease and retries.

Validation on this checkout, each run once: `lint` **0 errors** (1 pre-existing `no-location-assign-relative-destination` warning in untouched `src/app/instant-audit.tsx`) · `typecheck` **PASS** · `claims:check` **PASS** (21 surfaces) · `tokens:check` **PASS** (53 components) · unit **710/710** · PostgreSQL **127/127** (one first-run flake is the documented shared-database funnel-count artifact; clean on re-run) · migration rehearsal **27/27** on a fresh disposable database ending at `0048` · receipt-inbox PostgreSQL **15/15** including the new provenance behaviour · production build **PASS** · `perf:budget` **PASS**.

**Honest release classification for this delta:** `CODE COMPLETE` = yes. `PRODUCTION CONFIGURED` = **no** — no receiving domain, no trusted authority configured, `ENABLE_RECEIPT_INBOX` off, production migrations still stop at `0026` against a chain that now runs through `0048`. `REAL-WORLD PROVEN` = **no** — zero real forwarded merchant receipts have been classified.

### Prior delta (unchanged)

Repair delta committed as `4fa6575` on top of `051444f` (2026-08-17 IST): receipt parsing binds completed-payment context to the observed date clause, keeps invoice/order/billing/due and scheduled dates out of `observedDate`, selects a unique labelled paid/charged/total amount, rejects unresolved multi-amount receipts, maps KWD/JPY explicitly, and preserves labelled merchant identity through out-of-order multi-receipt persistence. Upcoming-only evidence is excluded from recent completed observations. Public veto uses a raw HTML route shell so the capability token is absent from RSC/hydration markup; 429/5xx/network failures keep a replay-safe client retry with outcome-unknown copy. Normal Home puts `Needs attention` before money summaries; active-mandate Home puts veto/exception controls first. Sources copy separates manual evidence from forwarding state and describes the surfaced Gmail confirmation flow. Internal and cron secrets fail closed below 32 UTF-8 bytes.

Two parser repairs land in this commit on top of `4fa6575`, each written as a failing test first.

**P0 — silent amount truncation (FIXED).** `amountPatternSource` let its comma-grouped alternative match zero comma groups, so the grouped branch won on an unseparated number and returned only its first 1–3 digits: `Rs. 1500` → `150`, `Rs. 12000` → `120`, `INR 125000` → `125`, `USD 1000` → `100`, `JPY 15000` → `150`, `EUR 2500.50` → `250`. Every downstream total was silently understated. The repair is one character in each of the two grouped alternatives — `(?:,[0-9]{2,3})*` → `(?:,[0-9]{2,3})+` — so a bare number falls through to the unrestricted numeric branch. No parser rewrite. Reproduced red, then green, with exact `amountDecimal` assertions for all seven cases plus preserved grouped/fractional cases `INR 4,229.00`, `INR 1,25,000.00`, `Rs. 649.00`, `KWD 3.250`.

**P1 — real receipt header dates (FIXED).** Bare `Date:`, `Receipt date:`, and `Transaction date:` required completed-payment language in the same clause or the immediately wrapped line, which rejects the common real layout where `Payment received` is a header line above the date line. Those three labels now accept proof from the enclosing **blank-line-delimited receipt block**. Every safeguard is preserved and two are strengthened: invoice / order / billing / due dates are still never paid dates; the future-context guard now applies to the proving clause as well; a deflected sentence (`Payment received for the June invoice`) no longer lends completed meaning to another date, even inside the same clause; and proof cannot cross into a neighbouring receipt block. Behavioral fixtures cover Netflix, Spotify, Adobe, Google One, and Jio, alongside nine fail-closed proofs (invoice/due without payment evidence, deflected prior-document payment, future pre-debit, scheduled charge, conflicting finals).

Final bounded validation on this checkout (2026-08-17 IST), each run once: `git diff --check` clean · `lint` **0 errors** (1 pre-existing `no-location-assign-relative-destination` warning in untouched `src/app/instant-audit.tsx`) · `typecheck` **PASS** · unit **687/687** · PostgreSQL **126/126** · production build **PASS** · focused browser E2E **56/56** across desktop-chromium and mobile-chromium (`recovery-customer-zero`, `recovery-ui-home`, `recovery-ui-states`, `autopilot-veto`) with **0 skipped**, covering realistic receipt ingestion, unknown-cadence money totals, Home, Sources, and the public veto transient/replay flow. One PostgreSQL run failed first on `cited amount changes invalidate the shadow hash …`; root cause is a pre-existing shared-database concurrency artifact — that assertion compares a **global** `connectedActiveMandates` count read twice while sibling `tests/postgres/*.test.ts` files run concurrently and delete their workspaces in between. It is not a parser defect: the file passes **40/40** in isolation and the full suite is **126/126** on re-run. Left untouched deliberately; a workspace-scoped funnel assertion is a P2 test-isolation item, not a release blocker.

Public release blockers are unchanged: strict consented corpora, production migrations through `0048`, durable encrypted backup/restore proof, receipt-inbox launch attestation, retention scheduling, and one founder-proven provider route.

Fail-closed Autopilot **engineering candidate**, not a live product. WP-C–E are **not** complete. Additive 0040 version-tags frozen notice hashes: genuine 0037 rows retry through the real store using their legacy hash, while new freezes use the tags-and-payload-version hash. Frozen notice identity is immutable on UPDATE and direct DELETE; whole-workspace privacy erasure still cascades. A candidate is current only when its classification snapshot is the latest for that commitment. Funnel, queue, authorization, execution, and reconnect restoration share that check. Reconnect re-runs evaluation and can restore an eligible candidate only to safe `SHADOW`; it never revives prior notice or authorization state. Exact recorded execution replay returns before evaluating gates for a new side effect, so a lost-response retry remains exact after source disconnection. Queued candidates still withdraw when **any cited snapshot evidence source** is disconnected, even if an unrelated workspace source remains. Connected-mandate / D30 / cohort still use workspace-level current-source SQL. 0038 still reconciles stale pending notice events that match an ACCEPTED `provider_message_id` and keeps one production-safe proven-id resolver. 0037 still restores 0023 evidence immutability (workspace-erasure only), keeps `recovery_connected_mandate_cohort` insert-once, and requires the persisted candidate clock plus a currently DELIVERED notice before authorization or execution. Invalid token coverage writes `NOTICE_TOKEN_COVERAGE_INVALID` instead of a silent DELIVERED row. Access export includes cohort and source-disconnection metadata and still excludes raw notice bodies, signed tokens, and extra PII. User-uploaded CSV is not regulated coverage. Honest EXCEPTION can be recorded while execution is off. Billing periods that cross the customer anniversary fail closed.

Autopilot integrity baseline in pushed `051444f` (through additive **0047**): same-timestamp complaint/bounce/failure beats an earlier delivered event at timestamp T and clears the candidate clock; signed mandate text names INR ₹50,000 per action and INR ₹200,000 rolling 30-day; displayed text is the hashed text (`standing-mandate-2026-08-16`); historical mandate rows keep their terms/hash; client components import `standing-mandate-text` only. 0045 makes standing mandates tamper-evident (only `ACTIVE → REVOKED` with revoke timestamp and user), append-only for snapshots/events/executions/operator actions, forward-then-freeze for execution attempts, and locks `razorpay_charge_status`. 0046 freezes billed covered-window updates/deletes; 0047 serializes fee finalization with covered-window inserts and rejects direct or racing inserts into a finalized period. Authority is re-checked after select and after freeze before provider send. Privacy export omits veto/notice/proof hashes and sentinel values. Notice copy separates queued/accepted/delayed from a delivered 48-hour clock. Public veto POST returns token-free HTML. Proof/fee amounts render through `MoneyValue`. Activation transport includes `deferred-no-picture`. Recovery Sources can disconnect/reconnect cited sources; reconnect restores only safe `SHADOW`. Delivery proven stays **false**. Execution, notice, and receipt-inbox switches stay off.
First-value slice (uncommitted): Home publishes server-side `annualizedEstimateTotals` (12 × cited monthly equivalent; omit a currency when that product exceeds PostgreSQL bigint or the display bound), `activeCommitmentCount`, and `reviewItemCount`. Money totals bind provenance per fact: next-date corrections mark next-30 only; cadence corrections mark monthly/annualized; amount corrections mark every affected money total. Copy names a saved correction when those totals are corrected. An active mandate shows veto/exception controls before its compact spend strip, including “No recurring amount yet.” `workspace.activated` records only from authenticated CSRF-protected `POST /api/workspaces/current/activation` after the cited metric component actually renders, and only with active `product-analytics-opt-in`. The client returns distinct outcomes (`recorded`, `already-recorded`, `deferred-no-consent`, `deferred-no-picture`, `deferred-auth`, `retry-exhausted`) and latches `sessionStorage` only for `recorded` / `already-recorded`. HTTP 202 / 401 / 403 stop the current attempt but stay eligible after consent or authentication changes. A consented Home without a cited picture returns `deferred-no-picture` (HTTP 200) and does not record activation. An active mandate still publishes the upcoming timeline and names non-current coverage (`STALE` / `PARTIAL` / `BASELINE_ONLY`) on the spend strip. A PROCESSING inbound event with no live `alias_id` is `IGNORED` / `ALIAS_REVOKED` and cannot persist evidence. Account deletion revokes the departing user's receipt-inbox consent (alias + in-flight leases) before withdrawing consent rows. `AUTOPILOT_TEST_NOTICE_PERSIST_CRASH` is ignored in `NODE_ENV=production`. Honest EXCEPTION records `LOGIN_REQUIRED` / OTP / phone / UPI / bank / unknown codes when the operator supplies that reason. Silence authorization re-checks a currently DELIVERED notice and the persisted clock on the UPDATE.

Authenticated production probes on 2026-08-16: every expected endpoint and auth/retirement guard passed, Google readiness reports `google-ready`, shared PostgreSQL rate limiting and Sentry server monitoring are configured, and Recovery cutover is clean. Public release remains **BLOCKED**: production migrations stop at `0026`, encrypted durable backup storage/restore status is not configured, receipt-inbox launch attestation is pending, and the retention deployment schedule is unverified. No production mutation was performed.

Final orchestrated release gate on this checkout (2026-08-16, through 0047): **PASS** code CI, disposable PostgreSQL, complete desktop/mobile browser matrix with embedded axe checks, production-build smoke, and loopback load budgets. Focused evidence includes migration rehearsal **27/27**, receipt-inbox PostgreSQL **14/14**, migration/readiness/schema/backup contracts **26/26**, and the direct plus concurrent billed-window insert invariant. **FAIL/BLOCKED**: strict statement corpus has **0/100** consented real fixtures; strict receipt corpus has **0/200**; operations readiness is missing durable encrypted backup storage/restore status, receipt-inbox launch attestations, and verified retention scheduling; strict production activation reports migrations only through `0026`. Every expected production endpoint/auth/retirement guard passed. Production data was not mutated. Composite remains **1.5**. Code cannot raise business validation.


| WP | Honest status |
| --- | --- |
| B | Mandate, class lock (incl. Devanagari tokens), shadow evaluator, APIs. Next-debit stability is derived from cited recurrence, not historical `evidence_date` existence. Catalog merchants remain **hypotheses**. |
| C | Notices freeze from, to, subject, text, token hash, tags, payload version, hash version, and idempotency key before provider send. After `frozen_at`, PostgreSQL rejects payload mutation and direct deletion (0040); delivery status still advances and whole-workspace erasure still works. A genuine frozen 0037 row retries through the real store instead of becoming permanently unsendable. Retrying one idempotency key after a deploy keeps the persisted tags. Unmatched tagged Autopilot webhooks stay pending (HTTP 503) until `provider_message_id` is persisted, then apply automatically — including when `expireUnboundNoticeEvents` later matches an ACCEPTED notice. Untagged events are ignored. Delivery does not start the 48h clock unless the signed veto token remains valid through the veto deadline; invalid coverage dead-letters `NOTICE_TOKEN_COVERAGE_INVALID`. Authorization and execution require the persisted candidate clock, the latest classification snapshot, cited current sources, and a currently DELIVERED notice. Retries outside Resend's 24-hour idempotency window fail closed. Ordering uses Resend `created_at`; `email.delivery_delayed` is accepted. Resend mailer adapter exists and defaults **OFF**. Execution requires `Idempotency-Key`, attempts/operation keys, and re-reads gates inside the locked transaction; an exact recorded replay returns before new-effect gates. Honest EXCEPTION can be recorded while execution is disabled. **No founder-proven provider route. Execution switch off.** |
| D | Covered windows inspect the derived debit window (expected−1 through expected+3), do not collapse distinct same-day same-amount debits, and never treat user-uploaded CSV as regulated coverage. Fee periods that cross the customer billing anniversary fail closed. Fee periods are enforced non-overlapping per workspace+currency by PostgreSQL `btree_gist` exclusion, with an immutability trigger that also locks `year_start` / `finalized_at`. First-year billing uses a persisted 12-month customer anchor. Invoices are replay-safe on `inputs_hash`. Razorpay stays **FAIL_CLOSED**. |
| E | Funnel counts connected active mandates and distinct currently eligible accounts from the candidate's cited snapshot. Eligible accounts require every cited evidence source to be currently connected **and** the candidate classification snapshot to be latest; D30 and connected-mandate counts still use workspace-level current-source SQL. `currentlyEligibleAccounts` is 0 unless notice switches are on and a catalog-proven zero-work provider id is present; test-env allowlists cannot activate production; reporting cannot inject proven IDs. Disabled providers are excluded. D30 uses insert-once `recovery_connected_mandate_cohort` (UPDATE/DELETE blocked except whole-workspace erasure). Source disconnection is a separate authorized fact (`POST .../sources/{id}/disconnect` and reconnect); evidence stays immutable. Disconnect before sign inserts no cohort and does not raise connected shadow counts. Disconnect after cohort keeps the D30 denominator and drops returned/connected/eligible counts. Reconnect evaluates the latest facts before restoring an eligible candidate to safe `SHADOW`; stale notice/authorization state is never revived. Missing cohort table reports D30 as unmeasured. Shadow gate 10/5/0 hashes cited facts. Gmail OAuth remains reserved until Google verification/CASA. |

## 4. Release level — three different things

- **PHASE A CODE READY.** Lint has 0 errors (1 pre-existing warning), typecheck/claims/tokens pass, unit **862/862**, PostgreSQL **153/153**, focused receipt-inbox **18/18**, Customer #0 desktop/mobile **2/2**, UI states/onboarding/trust desktop/mobile **16/16**, production build and performance budget pass.
- **PRODUCTION SCHEMA READY.** GitHub run `32018769474` applied and verified all 53 migrations through `0053_phase_a_receipt_activation`; Neon independently reports both new integrity guards and unchanged core row counts.
- **PRE-MIGRATION RECOVERY PROVEN.** GitHub run `32018501900` encrypted the exact `0026` production database, restored it into PostgreSQL 18, and retained nonempty artifact `encrypted-postgres-backup-pre-0053` until 2026-11-15.
- **PRODUCTION ACTIVATION BLOCKED.** Vercel receipt-inbox environment variables cannot be installed from this session because no valid Vercel login/token is available; durable object-storage credentials are absent; launch attestations remain blank; no post-deploy real receipt/replay has succeeded. Receipt forwarding must remain unavailable.
- **MARKET NOT VALIDATED.** Zero first-ICP users have completed the production flow. Green engineering gates do not raise the business-validation row.

## 5. Current P0

Exact remaining activation blockers:

1. Authenticate to the linked Vercel project and install the prepared receipt-inbox environment, keeping `ENABLE_RECEIPT_INBOX=false` and attestations blank for the first deploy.
2. Configure durable S3/R2-compatible storage and restore the uploaded encrypted object; a 90-day GitHub artifact is recovery evidence but does not satisfy durable-storage readiness.
3. Deploy the Phase A runtime, rotate the two legacy `receipt-alias-v1` aliases to `receipt-alias-v2`, then replay/send one real receipt and verify processing plus replay idempotency.
4. Only after retained evidence exists, set provider/webhook/replay/retention attestations and enable the inbox.

Do not start another product phase.

## 6. Next command / gate

```bash
cd "/Users/varunteja/Desktop/CVT Group/Vognary"
npm run lint && npm run typecheck && npm run claims:check && npm run tokens:check && npm test
DATABASE_URL='postgres://…' POSTGRES_SSL=false npm run test:postgres
ENABLE_DEVELOPMENT_LOGIN=true DEVELOPMENT_LOGIN_EMAIL=… DEVELOPMENT_LOGIN_ACCESS_CODE=… \
  VOGNARY_E2E_DEV_LOGIN_EMAIL=… VOGNARY_E2E_DEV_LOGIN_CODE=… \
  npm run test:e2e -- recovery-customer-zero recovery-ui-home recovery-ui-states
VERCEL= npm run build && npm run perf:budget && VERCEL= npm run perf:lighthouse
```

Quote the path. `DATABASE_URL` must be unset for `npm test`. Do not commit development-login values. `NODE_ENV=production` disables code login.

## 7. Founder-only

- Phase A: 10 real ICP conversations. CRM is gitignored `docs/execution/private-autopilot-pilot-crm.csv` (sourced targets, not qualified prospects). Agents must not invent connected / mandate / paid. First 10 public-identity checks (2026-08-15) and founder-approval drafts live in gitignored `docs/execution/private-autopilot-outreach-draft.md`. Nothing sent.
- Counsel / provider-authority validation for one merchant route. ChatGPT and Notion public help pages are login self-service, not zero-customer-work evidence.
- Provision verified sending domain + Resend notice credentials + a real delivered webhook. Queueing is not delivery.
- Google verification/CASA before public Gmail. Forwarding remains the private-pilot bridge.
- Razorpay + tax/legal/privacy before live charges. Webhook must validate the raw body.
- Do not wait for Gmail or Razorpay to start shadow conversations.

## 8. Ops (fail-closed)

- **Kill switches:** `AUTOPILOT_EXECUTION_ENABLED`, `AUTOPILOT_NOTICE_ENABLED`, `AUTOPILOT_NOTICE_CHANNEL_READY` default off. Only the literal string `true` enables them. Blank env is NOT READY.
- **Rollback:** leave the three switches false, keep `RESEND_NOTICE_WEBHOOK_SECRET` / `AUTOPILOT_VETO_TOKEN_SECRET` unset, redeploy. Do not drop 0033 through 0052. Emergency provider disable is founder/internal-operator only: `POST /api/internal/autopilot/providers/{id}/disable` with `INTERNAL_SYNC_SECRET`. Tenant admins cannot globally disable a provider.
- **SLOs (alert when breached after go-live, not before):** notice queue age > 15m; delivery failure rate > 5%; veto path 5xx; authorization without delivered+elapsed 48h; attempt latency > 2m; protected leakage > 0; verification pending > 7d; fee insert conflict/failure. Dead letters: `recovery_autopilot_dead_letters`.
- **Threat model:** signed veto token is capability-bearing; mandate/veto/operator/notice webhook/provider attempt/proof/fee/refund/kill-switch are privileged. No signed text, raw proof, or message bodies in product events.
- **Backup:** exact `0026` and `0053` `pg_dump`/`pg_restore` profiles pass locally. Production pre-migration encryption/restore is proven by run `32018501900`. Durable object storage remains unconfigured and must not be called READY.
- **Autopilot scheduler:** `GET /api/internal/autopilot/due/run` is CRON_SECRET-gated. It is **not** in `vercel.json` (Hobby two-cron cap: renewal alerts + retention). Notices/execution still no-op unless those switches are the literal string `true`.
