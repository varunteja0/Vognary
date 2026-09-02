# Gate 0 independent prosecution — 2026-09-02

**Tree reviewed:** `89d6ceb16409c3513a7bc31b4ed93c96b7c84507` plus the
combined dirty checkout. **Mode:** four independent, read-only reviews before
the Sol score was chosen. Reviewers did not edit files or receive Sol's
recommendation. Private CRM identities and rows were excluded.

This file preserves the material P0/P1 findings verbatim, then adjudicates them
against measured aggregates and executable tests. A reviewer claim is not
evidence merely because it was written.

## Reviewer A — skeptical buyer

> **P0.1 — Zero market validation on current thesis.**

> **P0.2 — Category is already claimed by funded competitors with enforcement.**

> **P0.3 — Regulatory blocker for paid Indian pilots.**

> **P1.2 — Product cannot measure outcome.**

> **P1.3 — Security assessment gate is still open.**

**Adjudication:** P0.1 and P1.3 are confirmed by `npm run market:report` and
`npm run control:preflight -- --report-only`. P0.2 remains a competitive
hypothesis until its public sources are revalidated and buyers compare the
incumbents in conversation. P0.3 remains a founder/legal gate; no agent may
declare the applicable CERT-In duties cleared. The review also stated that
publicly funded prospects had confirmed at least ₹8 lakh/month exposure and
converted willingness to pay from unknown to no. Both statements are rejected:
the private aggregate records spend as unmeasured and zero conversations do not
establish rejection. P1.2 is narrowed: deterministic reconciliation exists in
code, but no real customer outcome has been measured.

## Reviewer B — product/domain prosecutor

> **P1 RISK — SMALLEST REMAINING INVARIANT GAP**

> **Missing:** No integration/contract tests for API route handlers themselves
> (decision/reconciliation endpoints).

**Adjudication:** refuted. `tests/postgres/commitment-control-routes.test.ts`
exercises authentication, enrollment, cross-site refusal, payload limits,
idempotent policy replay, member decision refusal, ETags, decision,
reconciliation, and membership revocation. The focused disposable PostgreSQL
slice passed 10/10 after the date-stability repair. No P0/P1 domain defect from
this review remains confirmed.

## Reviewer C — security/reliability prosecutor

> **P0 Blockers for Paid Pilot Enrollment:**
> 1. Security assessment/retest evidence **must exist** before any customer
> workspace sees Control
> 2. Paid UUID and payment settlement **must be recorded** and verified
> 3. Restore drill proof **must be current** (≤30 days)
> 4. Incident commander and decision authorities **must be assigned** and
> documented

> **P1 Observations:**
> - Cross-workspace boundary is enforced but not explicitly tested
> - Second-admin rule behavior under user deletion needs clarification
> - Reconciliation cumulative-vs.-per-charge semantics unspecified
> - Concurrency/idempotency under simultaneous submission untested (though
> advisory lock present)

**Adjudication:** the external P0 blockers are confirmed and remain fail-closed.
The preflight additionally reports target readiness, Control migrations,
tabletop, legal/logging review, monitoring delivery, and proposal-review
procedure blocked. The cross-workspace claim is refuted by
`tests/postgres/commitment-control.test.ts`, which attempts a foreign evidence
link and requires `NOT_FOUND`. Concurrent decisions and event replay are tested
in `tests/postgres/commitment-control-integrity.test.ts`. Multiple-observation
reconciliation semantics remain genuinely unspecified; defer implementation
until a buyer's qualifying event establishes whether one authorization binds a
charge, period, or cumulative commitment.

## Reviewer D — distribution/economics prosecutor

> **P0 Finding:** Vognary has proved it can identify target companies. It has
> **zero proof that any will pay.** Sourcing is preparation; it is not revenue.

> **P1 Finding:** Founder labor for Phase A is **unmeasured and untracked.** No
> GTM cost-per-contact, time-per-call, or support-hours-per-pilot are recorded.

> **Finding: ZERO EVIDENCE ANY CHANNEL CAN REPEAT.**

**Adjudication:** confirmed. Business Validation and Distribution remain 1.5 on
the minimum-row scoreboard. The review's projected founder hours, CAC, LTV, and
market renewal-rate figures are unsupported scenarios, not observed economics;
they receive zero rubric credit and cannot choose a company direction.

## Confirmed repair and open findings

- Reproduced: six focused PostgreSQL failures because default-clock tests used
  a first-charge date that expired on 2026-09-02.
- Repaired: the affected fixtures now derive a future Asia/Kolkata date, matching
  the store's projection boundary. The same disposable PostgreSQL slice passes
  10/10 and its temporary database was dropped.
- Open, Opus-owned: the exact combined tree has five landing contract failures
  and `/` CSS exceeds the 15,000-byte budget. Sol did not modify frontend files.
- Open, founder-owned: five substantive calls, ten identical offers, two cleared
  payments, independent assessment/retest, legal review, staffing, tabletop,
  restore, monitoring, enrollment, and deployment.
