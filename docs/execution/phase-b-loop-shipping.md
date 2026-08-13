# Phase B — Autopilot loop shipping (WP-A through WP-E)

> **Parent law:** [`docs/THE-LAW.md`](../THE-LAW.md)
> **Live state:** [`docs/CONTINUE-HERE.md`](../CONTINUE-HERE.md)
> **Market proof:** [`phase-a-market-contact.md`](phase-a-market-contact.md)
> **UI/AI implementation law (historical, still binding for tokens/AI):** `docs/execution-plan-ui-ai-quality.md` and `docs/master-build-plan.md` Parts 3–5

**Goal:** Make the locked autopilot loop inevitable so private pilots (Phase A) are wrap-care, not a spreadsheet.

```
passive evidence
  → cited classification
  → deterministic eligibility
  → versioned standing mandate
  → delivered 48-hour veto notice
  → supported discretionary execution
  → execution proof
  → financially covered clean windows
  → customer-safe billing
```

The customer connects once and signs once. They are contacted only for vetoes and genuine exceptions.

Historical WP-B0…B8 (landing honesty, guest first-value, assistant brief, UPI kill-list, monolith extraction) shipped the pre-autopilot Recovery loop. They are **not** the live roadmap. Do not reopen them as parallel work.

---

## 0. Locked product invariants

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

## 1. Architecture map (do not redesign)

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
6. **One isolated worktree per WP** from merged `origin/main`. No stacked PRs.

---

## 2. Work packages (ordered; one PR each)

Execute in order. Never begin the next WP before the previous PR is merged into `origin/main`.

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

### WP-B — Class lock, standing mandate, shadow engine

**Do:** versioned standing mandates; Recovery action candidates; type- and database-level executable-class restrictions; create/read/revoke/list/veto APIs; workspace-version preconditions; RBAC; audit; privacy export/deletion. Evaluator runs in **shadow mode only** and never executes.

A candidate is eligible only when the mandate is active; class is high-confidence discretionary-subscription; no protected or conflicting evidence; recurrence has two dated occurrences or explicit provider subscription/renewal evidence; cadence/amount/currency/next debit are stable; amount is inside both ceilings; route is operator-supported; no KEEP / exclusion / prior veto / stale evidence / contradictory update; notice can be delivered.

Tests must exhaustively prove every protected class fails closed, including mixed/conflicting categories and adversarial strings. AI must never decide that a service is “unused” or “junk.”

### WP-C — Notice, executor, exceptions, user experience

**Do:** idempotent state machine `notice-queued → authorized-by-rule → in-progress → provider-pending → executed → verifying → verified` with terminal exits `vetoed, revoked, exception, failed, disputed`. Notice delivery is recorded and must succeed before the 48-hour clock starts. Production clocks cannot be shortened. Replace list-first Recovery home with watching, mandate, veto countdowns, exceptions, recent actions, and proof receipts. Mobile/desktop/accessibility E2E for the happy path plus veto, revocation, notice failure, protected item, changed evidence, duplicate worker, and exception flows.

Password, OTP, login, UPI-app confirmation, bank scraping, or unknown paths become exceptions. Deep links are exception assistance, not successful autopilot. Operators cannot mark a saving verified.

### WP-D — Verified savings and customer-safe billing

**Do:** rebuild verification on Recovery evidence only. Merchant confirmation proves execution, not financial savings. Gmail or receipt silence is not financial proof. Covered statement/regulated source must span the expected debit window. Per-window saving = `max(0, proven baseline debit − observed debit)`. Missing coverage is “verification pending,” not zero and not saved.

Locked pricing: monitoring ₹999/month; outcome 15% of verified savings; monitoring credits against the outcome fee; first-year retained charge `min(max(M, 15% × S), 33% × S)`; refund/credit `max(0, M − earned charge)`; zero verified savings means zero retained first-year charge. Razorpay charging stays disabled until founder-controlled Razorpay, tax, legal, privacy, and operations gates are approved.

### WP-E — Passive rails, operations, security, private-pilot readiness

**Do:** Recovery-native Gmail OAuth (never the legacy materializer), kept disabled until Google restricted-scope verification/CASA is genuinely approved. Forwarding remains a private-pilot bridge. No AA production access without a regulated FIU contract. No third-party UPI mandate cancellation without a proven contractual API. Threat model, audit logs without PII, metrics, alerts, dead-letter visibility, SLOs, backup/restore, rollback, privacy export/deletion across new tables. Keep the global execution switch off until legal/operations readiness and the real shadow gate pass.

---

## 3. File ownership map

| Area | Prefer editing | Avoid |
| --- | --- | --- |
| Ingestion | `src/lib/recovery/ingestion-envelope.ts`, `recovery-store.ts` | Reviving living-ledger writes |
| Mandate / candidates | `src/lib/recovery/*` (WP-B+) | AI deciding junk/unused |
| Execution | WP-C registry allowlist | Password/OTP/login paths as success |
| Verification / fees | WP-D Recovery evidence | Billing missing coverage as ₹0 saved |
| Gmail | WP-E Recovery-native OAuth | Legacy Gmail adapter |
| Money format | `lib/format.ts` | Ad-hoc `₹` strings |

---

## 4. Parallelism rules

| Safe parallel | Must serialize |
| --- | --- |
| Phase A CRM hygiene (founder) ∥ current WP implementation | Two writers on Recovery |
| Reviewers (Codex/Opus) on a frozen SHA | Starting WP-n+1 before WP-n merges |

**Always:** separate git worktrees; PR against `main`; one owner.

---

## 5. Verification commands

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

## 6. Out of scope until the matching WP and external gate

- Merchant intelligence network
- Public Gmail OAuth before CASA/verification
- AA production code (onboarding paperwork OK)
- Design-system rewrite
- Platform API consumers
- Real Razorpay charging before founder-controlled gates
- Counting written pay intent as paid
- Raising business-validation score from code completion

---

## 7. Agent implementation prompt (copy into new sessions)

```text
You are implementing Vognary Autopilot under docs/THE-LAW.md.
Read: docs/THE-LAW.md → docs/CONTINUE-HERE.md → docs/execution/phase-a-market-contact.md → docs/execution/phase-b-loop-shipping.md.
Raise the locked autopilot loop only. No new plans. No uncited AI. India-first INR defaults.
Worktree from merged origin/main. Failing test first for engines. PR against main.
Start at the lowest incomplete WP-A…WP-E. State scoreboard row + files before coding.
Never begin the next WP before the previous PR is merged.
```

---

## 8. Exit criteria (Phase B engineering complete)

- [ ] WP-A through WP-E merged with Codex + Opus review on the same final head SHA
- [ ] Every agent-controlled acceptance criterion green
- [ ] Gmail / AA / Razorpay / legal / notice delivery still fail-closed until genuinely ready
- [ ] Private-pilot product readiness remains BLOCKED until deployment, legal, notice, operations, and shadow gates are real
- [ ] Public launch remains BLOCKED until pilot metrics exist
- [ ] Company/business validation remains the measured scoreboard value

Then: founder-ops for activation gates. Do not convert blockers into fake READY.
