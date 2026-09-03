# Phase B — Commitment Control V0 (10 days)

> **Operating sequence: Make it work. Make it perfect. Make it fast. Make it cheap.**
> **Strategy rule: Take smart risks. Do not play safe.** Pursue asymmetric,
> falsifiable upside and bound irreversible downside. Full doctrine:
> [`THE-LAW.md`](../THE-LAW.md).

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)
> **Live state:** [`docs/CONTINUE-HERE.md`](../CONTINUE-HERE.md)
> **Market proof:** [`phase-a-market-contact.md`](phase-a-market-contact.md)
> **UI/AI implementation law (historical, still binding for tokens/AI):** `docs/execution-plan-ui-ai-quality.md` and `docs/master-build-plan.md` Parts 3–5

**Goal:** Ship the minimum repeatable proposal → policy → human decision → reconciliation workflow while the founder sells paid pilots.

```
user-entered proposal assumptions
  → cited existing exposure
  → deterministic policy evaluation
  → owner/admin decision and frozen cap
  → later cited Recovery evidence
  → exact reconciliation
```

V0 records authority. It never purchases, provisions, cancels, auto-approves, auto-denies, or moves money.

## 0. Locked V0 invariants

1. Recovery is the sole authority for observed financial evidence.
2. Proposal values are user-entered assumptions until evidence proves an outcome.
3. Money is an integer minor-unit string at boundaries and `bigint` internally; every amount has an uppercase ISO currency.
4. Different currencies are never summed or converted.
5. Projection fails closed on invalid recurrence, invalid calendar dates, non-positive amounts, and signed-64-bit overflow.
6. Policy evaluation is deterministic and versioned. AI may explain cited results but cannot decide.
7. Only owners/admins may approve, approve with a cap, or decline.
8. Decisions and caps are append-only and cannot be rewritten by later evidence.
9. Reconciliation links same-workspace Recovery evidence and returns `MATCHED`, `WITHIN_CAP`, `OVER_CAP`, `CURRENCY_MISMATCH`, or `CANNOT_EVALUATE`.
10. Private pilot enrollment fails closed; no public launch. Broad frontend
  reconstruction is authorized only for the non-production candidate under
  THE-LAW §0.1.1 and cannot change this loop or its contracts.

## 1. Architecture boundary

```text
src/lib/commitment-control/
  project.ts       exact proposal projection by currency
  policy.ts        pure versioned policy evaluation
  decision.ts      decision and cap invariants
  reconcile.ts     frozen-decision vs observed-evidence verdict

src/lib/server/
  commitment-control-store.ts   tenant-safe persistence and transactions

src/app/api/workspaces/current/control/
  brief · proposals · decisions · reconciliations

src/app/workspace/recovery/control/
  private pilot proposal and decision experience
```

Do not route authorization through `src/lib/twin/project.ts`; that module uses JavaScript `number` and remains presentation-only. Reuse its calendar primitives only when their behavior is covered by exact-money tests.

## 2. Work packages (ordered)

### CC-0 — Authority and paid proof contract

Update THE-LAW, CONTINUE-HERE, Phase A, this file, and the scoreboard. Preserve measured scores. **Status: complete 2026-08-25; authority tests 3/3.**

### CC-1 — Exact projection (days 1–3)

Write red tests first for exact minor units, 13-week and annual recurrence, monthly end-of-month behavior, currency separation, invalid dates, and overflow. Implement a pure bounded projection with no database or UI dependency.

**Status:** complete 2026-08-25. Exact projection and Recovery exposure adaptation are covered by the full unit/PostgreSQL gates.

### CC-2 — Proposal and policy domain (days 2–4)

Define proposal assumptions, 13-week and annual exposure, policy inputs, policy results, uncertainty, and evidence citations. Evaluation may return allowed, review-required, or blocked; it never records a human decision by itself.

**Status:** complete 2026-08-25. Deterministic statuses are `WITHIN_POLICY`, `REVIEW_REQUIRED`, and `OUTSIDE_POLICY`; all still require a human decision.

### CC-3 — Pilot persistence and authority (days 3–5)

Add `0057_commitment_control_v0.sql`: workspace policy settings, proposals, immutable evaluations, evidence links, append-only decisions, and reconciliations. Require tenant-safe composite foreign keys, signed-64-bit money, explicit currency, idempotency keys, request hashes, workspace versions, role checks, audit, privacy export, and cascade erasure.

**Status:** complete in code 2026-08-25; fresh migration and disposable PostgreSQL gates pass. Production apply remains founder-controlled and unrun.

### CC-4 — Authenticated APIs (days 5–6)

Add `/api/workspaces/current/control/` routes for brief, proposals, decisions, and reconciliations. Use the existing workspace session/RBAC boundary. Members may create proposals only if policy permits; only owners/admins may decide. Stale versions and replay mismatches fail closed.

**Status:** complete in code 2026-08-25. Brief, policy, proposal, decision, and reconciliation routes pass authenticated PostgreSQL integration.

### CC-5 — Private Control-first experience (days 6–8)

For enrolled pilot workspaces, lead with “What are you considering committing to?” Show user-entered assumptions separately from cited existing exposure, then 13-week/annual exposure, policy headroom, uncertainty, and Approve / Approve with cap / Decline. Preserve current tokens and canonical workspace shell.

**Status:** complete in code 2026-08-25. Control-first desktop/mobile experience passes 20/20 focused browser cases with Axe, keyboard, reduced-motion, and overflow checks; existing signed-in Recovery journeys also pass.

### CC-6 — Reconciliation (days 8–9)

Allow an admin to link later same-workspace Recovery evidence to an approved proposal. Compare exact observed amount and currency to the frozen authorization; append a verdict without updating the original evaluation, decision, or cap.

**Status:** complete in code 2026-08-25; all five verdicts, cross-workspace refusal, and cap immutability are tested.

### CC-7 — Private release (days 9–10)

Add privacy export/deletion coverage, consented product events, desktop/mobile accessibility, migration rehearsal, disposable PostgreSQL tests, and fail-closed pilot enrollment. Complete the full gate chain before deployment.

**Status:** code-controlled release obligations complete and gated. Exact-head CI, production backup/apply of `0057`, production enrollment configuration, deployment, and measured pilots remain pending founder/release work.

## 3. Acceptance gates

- Exact projection never loses a minor unit and never crosses currencies.
- Owner/admin authorization succeeds; member authorization is refused.
- Idempotent replay returns the same result; changed payload under the same key conflicts.
- Stale workspace versions and concurrent decisions serialize or fail closed.
- Cross-workspace evidence linking is refused.
- Later observed evidence cannot mutate the approved cap.
- Privacy export contains the complete proposal → evaluation → decision → reconciliation chain; workspace erasure removes it.
- No customer-facing amount lacks either an evidence citation or an assumption label.

## 4. Verification

```bash
git diff --check
npm run lint
npm run typecheck
npm run claims:check
npm run tokens:check
env -u DATABASE_URL npm test
DATABASE_URL='postgres://…' POSTGRES_SSL=false npm run test:postgres
npm run build
npm run perf:budget
```

## 5. Explicitly deferred

Cards, wallets, payments, autonomous agents, Slack integration, Gmail expansion,
bank connectors, automatic merchant matching, procurement suites, contract
negotiation, public launch, and any action that creates or terminates an
obligation. Frontend reconstruction is confined to the candidate authorized by
THE-LAW §0.1.1.

## Historical Autopilot implementation record — superseded 2026-08-25

Everything below this marker is retained for architecture and safety history. It is not the live roadmap, branch instruction, offer, or product authority.

---

### 0. Historical locked product invariants

1. Recovery is the only active financial authority.
2. AI cites evidence or produces no financial claim.
3. Only `discretionary-subscription` can become executable.
4. A protected signal always overrides a discretionary signal.
5. Receipts prove recurrence and merchant facts; they do not prove that a subscription is unwanted.
6. Cancellation preference comes only from the signed deterministic rule pack.
7. Every eligible action receives a successfully delivered 48-hour notice.
8. Silence after that notice authorizes only what the user already mandated.
9. Veto or mandate revocation before execution withdraws queued cases immediately.
10. Password, OTP, login, UPI-app, or bank-confirmation requirements create an exception.
11. Gmail, AA, Razorpay, legal authority, and notification delivery remain fail-closed until genuinely ready.
12. No public “cancelled” or “saved” claim without the corresponding proof.

---

### 1. Historical architecture map

```
┌─────────────────────────────────────────────────────────────────┐
│  UI                                                             │
│  Recovery workspace: watching / mandate / veto / exceptions /   │
│  recent actions / proof receipts. Cited drill-downs remain.     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  API                                                            │
│  Recovery evidence · standing mandate · candidates · veto       │
│  notice delivery · execution workers · verification · billing   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Deterministic fact engines (SOLE SOURCE OF MONEY TRUTH)        │
│  receipt-parser → recurring-audit → classification snapshot     │
│  eligibility evaluator (shadow in WP-B; execute in WP-C)        │
│  covered-window verification → fee ledger                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  AI (optional, fail-closed)  src/lib/server/ai/*                │
│  validateCited MUST pass or output discarded                    │
│  AI never decides unused / junk                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Persistence                                                    │
│  recovery-store · recovery ingestion envelope                   │
│  living-ledger writes FROZEN · proof-graph read-only legacy     │
└─────────────────────────────────────────────────────────────────┘
```

### Design rules when adding code

1. **Facts never originate in the LLM.**
2. **New UI** prefers `src/app/workspace/recovery/*`.
3. **Honesty states** from readiness helpers — no “connected” without proof.
4. **INR default**; multi-currency explicit.
5. **Tests first** for engine changes.
6. **Live checkout:** stay in this repository on the CONTINUE-HERE branch (`feat/autopilot-loop`). Isolated-worktree-per-WP is superseded until that branch lands. Do not redo merged WP-A.

---

### 2. Historical work packages

Default process is one PR per WP. **Founder override (2026-08-14):** WP-B through WP-E continue on one branch, `feat/autopilot-loop`, in this repository folder so chats do not spawn isolated copies. Do not restart WP-A.

### WP-A — Recovery-only evidence spine

**Scoreboard row:** backend readiness / live-connector honesty. **Loop step:** passive evidence.

**Do:**

- Canonical Recovery ingestion envelope before a PostgreSQL client
- Envelope is authoritative for source type, provenance, idempotency, capture time, coverage, and consent reference
- Paste, CSV, and forwarded email share that boundary
- `GMAIL_OAUTH` reserved and rejected; Gmail HTTP stays 410
- Inventory and freeze production-reachable legacy writers
- Count/report: clean / safely migratable / blocked with exact counts
- Idempotent Recovery migration with record-level reconciliation; never delete unsupported rows

**Done when:** gates including disposable PostgreSQL are green and reviewers have signed the same head SHA.

**Status (2026-08-13):** Merged as PR #32 at `2e3c776` before required Codex/Opus gates completed.

### WP-A.1 — Legacy tenant integrity (corrective)

Refuse cross-workspace decision/evidence rehoming. Leave historical mismatched rows untouched as cutover blockers.

**Status (2026-08-13):** Merged unexpectedly as PR #33 at `d84e778` before CI/Codex/Opus gates. Codex review of `ad65d055` is **NOT APPROVED**. Do not revert.

### WP-A.2 — Immutable legacy workspace ownership (corrective)

A valid same-workspace evidence link must not become cross-workspace by later updating `data_sources.workspace_id` or `recurring_items.workspace_id`. Additive migration `0030_legacy_tenant_ownership_immutable` rejects an actual workspace change on those frozen tables. No-op same-workspace updates remain permitted. Historical dirty rows stay untouched.

**Status (2026-08-14):** Merged as PR #34 at `1542dda`. Do not redo. WP-B continues on `feat/autopilot-loop` in this folder. Isolated worktrees are suspended while CONTINUE-HERE names that branch.

### WP-B — Class lock, standing mandate, shadow engine

**Do:** versioned standing mandates; Recovery action candidates; type- and database-level executable-class restrictions; create/read/revoke/list/veto APIs; workspace-version preconditions; RBAC; audit; privacy export/deletion. Evaluator runs in **shadow mode only** and never executes.

A candidate is eligible only when the mandate is active; class is high-confidence discretionary-subscription; no protected or conflicting evidence; recurrence has two dated occurrences or explicit provider subscription/renewal evidence; cadence/amount/currency/next debit are stable; amount is inside both ceilings; route is operator-supported; no KEEP / exclusion / prior veto / stale evidence / contradictory update; notice can be delivered.

Tests must exhaustively prove every protected class fails closed, including mixed/conflicting categories and adversarial strings. AI must never decide that a service is “unused” or “junk.”

**Status (2026-08-14):** In progress on `feat/autopilot-loop`. Shadow-only. Not merge-ready.

### WP-C — Notice, executor, exceptions, user experience

**Do:** idempotent state machine `notice-queued → authorized-by-rule → in-progress → provider-pending → executed → verifying → verified` with terminal exits `vetoed, revoked, exception, failed, disputed`. Notice delivery is recorded and must succeed before the 48-hour clock starts. Production clocks cannot be shortened. Replace list-first Recovery home with watching, mandate, veto countdowns, exceptions, recent actions, and proof receipts. Mobile/desktop/accessibility E2E for the happy path plus veto, revocation, notice failure, protected item, changed evidence, duplicate worker, and exception flows.

Password, OTP, login, UPI-app confirmation, bank scraping, or unknown paths become exceptions. Deep links are exception assistance, not successful autopilot. Operators cannot mark a saving verified.

### WP-D — Verified savings and customer-safe billing

**Do:** rebuild verification on Recovery evidence only. Merchant confirmation proves execution, not financial savings. Gmail or receipt silence is not financial proof. Covered statement/regulated source must span the expected debit window. Per-window saving = `max(0, proven baseline debit − observed debit)`. Missing coverage is “verification pending,” not zero and not saved.

Locked pricing: monitoring ₹999/month; outcome 15% of verified savings; monitoring credits against the outcome fee; first-year retained charge `min(max(M, 15% × S), 33% × S)`; refund/credit `max(0, M − earned charge)`; zero verified savings means zero retained first-year charge. Razorpay charging stays disabled until founder-controlled Razorpay, tax, legal, privacy, and operations gates are approved.

### WP-E — Passive rails, operations, security, private-pilot readiness

**Do:** Recovery-native Gmail OAuth (never the legacy materializer), kept disabled until Google restricted-scope verification/CASA is genuinely approved. Forwarding remains a private-pilot bridge. No AA production access without a regulated FIU contract. No third-party UPI mandate cancellation without a proven contractual API. Threat model, audit logs without PII, metrics, alerts, dead-letter visibility, SLOs, backup/restore, rollback, privacy export/deletion across new tables. Keep the global execution switch off until legal/operations readiness and the real shadow gate pass.

---

### 3. Historical file ownership map

| Area | Prefer editing | Avoid |
| --- | --- | --- |
| Ingestion | `src/lib/recovery/ingestion-envelope.ts`, `recovery-store.ts` | Reviving living-ledger writes |
| Mandate / candidates | `src/lib/recovery/*` (WP-B+) | AI deciding junk/unused |
| Execution | WP-C registry allowlist | Password/OTP/login paths as success |
| Verification / fees | WP-D Recovery evidence | Billing missing coverage as ₹0 saved |
| Gmail | WP-E Recovery-native OAuth | Legacy Gmail adapter |
| Money format | `lib/format.ts` | Ad-hoc `₹` strings |

---

### 4. Historical parallelism rules

| Safe parallel | Must serialize |
| --- | --- |
| Phase A CRM hygiene (founder) ∥ current WP implementation | Two writers on Recovery |
| Reviewers (Codex/Opus) on a frozen SHA | Two chats inventing sibling folders for the same WP |

**Always:** PR against `main`; one Git owner. While CONTINUE-HERE names `feat/autopilot-loop`, serialize in this folder — no `../vognary-*` worktrees.

---

### 5. Historical verification commands

```bash
git diff --check
npm run lint
npm run typecheck
npm run claims:check
npm run tokens:check
npm test
# disposable local PostgreSQL only — never production
DATABASE_URL='postgres://…' POSTGRES_SSL=false npm run test:postgres
npm run build
npm run perf:budget
```

Do not claim a WP merge-ready while PostgreSQL is untested. Do not land temporary worktree paths in CONTINUE-HERE.

---

### 6. Historical out-of-scope list

- Merchant intelligence network
- Public Gmail OAuth before CASA/verification
- AA production code (onboarding paperwork OK)
- Design-system rewrite
- Platform API consumers
- Real Razorpay charging before founder-controlled gates
- Counting written pay intent as paid
- Raising business-validation score from code completion

---

### 7. Historical agent implementation prompt

```text
You are implementing Vognary Autopilot under docs/THE-LAW.md.
Read: docs/THE-LAW.md → docs/CONTINUE-HERE.md → docs/execution/phase-a-market-contact.md → docs/execution/phase-b-loop-shipping.md.
Raise the locked autopilot loop only. No new plans. No uncited AI. India-first INR defaults.
Stay in this repo folder on feat/autopilot-loop. Do not create ../vognary-* folders. Failing test first for engines. PR against main.
Continue WP-B–E on the named branch. Do not redo merged WP-A / PR #34.
```

---

### 8. Historical exit criteria

- [ ] WP-A through WP-E merged with Codex + Opus review on the same final head SHA
- [ ] Every agent-controlled acceptance criterion green
- [ ] Gmail / AA / Razorpay / legal / notice delivery still fail-closed until genuinely ready
- [ ] Private-pilot product readiness remains BLOCKED until deployment, legal, notice, operations, and shadow gates are real
- [ ] Public launch remains BLOCKED until pilot metrics exist
- [ ] Company/business validation remains the measured scoreboard value

Then: founder-ops for activation gates. Do not convert blockers into fake READY.
