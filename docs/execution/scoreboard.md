# Live scoreboard (update with measured evidence only)

> **Operating sequence: Make it work. Make it perfect. Make it fast. Make it cheap.**
> **Strategy rule: Take smart risks. Do not play safe.** Reward measured,
> category-defining outcomes, not activity or polish; every strategic bet needs a
> kill threshold and bounded downside. Full doctrine: [`THE-LAW.md`](../THE-LAW.md).

> Parent: [`docs/THE-LAW.md`](../THE-LAW.md) §5  
> Rule: never invent metrics. Empty cells mean “not measured yet.”

## Company composite (min-row)

| Dimension | Score | As of | Evidence |
| --- | ---: | --- | --- |
| Wedge sharpness | 8 | 2026-07-21 | Strategy review |
| Intelligence engine | 6 | 2026-07-21 | Engines strong; corpus empty |
| Trust & honesty | 9 | 2026-08-21 | Retired demo modes are crawlable 410/noindex tombstones; retired audit intake and checkout cannot collect or charge regardless of env; README, sitemap, legal, ops, and outreach story now match the frozen product. Sensitive routes use script nonces and bounded style hashes. No score raise without external/user proof |
| Product UX | 7.5 | 2026-08-24 | The prior 8 was overconfident: founder comprehension failed despite green code. Presentation was reset to one promise, a concrete price-change decision, compact bill checking, and `Now / Bills / Receipts`; the visual system moved from near-black console styling to cool paper/graphite/gold. Unit 1013/1013, public e2e 34/34, signed-in UI 46/46, and database-backed Customer #0 2/2 pass desktop/mobile. Five real T0–T4 sessions and measured <3 min value remain unproven; no score raise before that evidence |
| Backend readiness | 8 | 2026-07-21 | SLOs met in production |
| Production activation | 7 | 2026-08-24 | Production Neon is through `0056_decision_cycle_expected_amount` with the verified checksum; legacy expected amounts remain null, so no history was invented. Durable R2 backup GET-restore remains proven at `0053` by GitHub run `32109925496`. Inbox processing is on (unsigned inbound 401). Google forwarding confirmation URL is stored; `forwarding_verified_at` is still null. HMAC key id remains `receipt-alias-v1`. Real automatic receipt, second automatic receipt, reminder delivery, and retention attestation remain unproven |
| Live connector depth | 4 | 2026-07-21 | Registry ≠ live |
| Data / network moat | 3 | 2026-07-21 | No network data yet |
| Business validation | 1.5 | 2026-09-02 | Commitment Control remains unvalidated: 0 current-thesis conversations, repeated jobs, committed events, offers, payments, real proposals, changed decisions, or renewals |
| Distribution | 1.5 | 2026-09-04 | The three-cell sourcing gate is READY at 5/5/5 and three of 15 active-test candidates have transmitted contact attempts. The first measured audience wave produced two verified public artifacts, one public recruitment reply, one scheduled roundtable, two official organizer proposals, and one official founder-community application. There are still 0 external replies, buyer conversations, attributable introductions, offers, or payments; activity does not raise the score |
| **COMPOSITE (min)** | **1.5** | 2026-07-21 | Still floor = business |

## Commitment Control operating metrics

| Metric | Active test target | Day 30 target | Current |
| --- | ---: | ---: | ---: |
| Strictly qualified direct-finance contacts | 5 | — | 5 ready / 3 sent |
| Exploratory Cell B/C candidates, never counted as qualified | 10 | — | 10 evidence-ready / 0 sent |
| Substantive conversations | 15: five per cell | 15 | 0 |
| Explicit one-time ₹14,999 offers | 10 | 10 | 0 |
| Upfront paid pilots | 2 | 3 | 0 |
| Pre-spend proposals evaluated | 0 before assurance exit | 30 | 0 |
| Materially changed / capped / declined decisions | 0 before assurance exit | 3 | 0 |
| Requests received before spend | unmeasured | ≥80% | unmeasured |
| Voluntary paid pilot renewals | 0 | 2 | 0 |

## Three-cell wedge metrics — 2026-09-02 baseline

Preparation and contact attempts do not raise business validation. A pending
invitation is not a reply. A cell is only a directional winner at 3/5 concrete
repeated jobs, 2/5 committed events, and 1/5 payment or specific invoice
commitment.

| Test cell | Selected | Evidence-ready | Contacted | Replied | Conversations | Repeated jobs | Committed events | Payment / invoice commitment | State |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `DIRECT_FINANCE` | 5 | 5 | 3 | 0 | 0/5 | 0/3 | 0/2 | 0/1 | INCOMPLETE |
| `FRACTIONAL_FINANCE` | 5 | 5 | 0 | 0 | 0/5 | 0/3 | 0/2 | 0/1 | INCOMPLETE |
| `FINOPS_AI_OPERATIONS` | 5 | 5 | 0 | 0 | 0/5 | 0/3 | 0/2 | 0/1 | INCOMPLETE |

Sourcing cohort gate: **READY** at 5/5/5. Company demand gate:
**INCOMPLETE** — 0/10 offers and 0/2 cleared payments. Run `npm run
market:report` for the private-CRM aggregate; never paste private rows into this
scoreboard.

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Hygiene | DONE | 2026-07-21 |
| A Paid proof | ACTIVE / 14-DAY THREE-CELL TEST | Candidate preparation is READY at 5/5/5. Five conversations each across direct finance, fractional finance, and FinOps/AI operations; ten identical one-time ₹14,999 offers; two cleared payments. The original seven-day gate was missed and is not reset. Contacts sent: 3/15; replies/conversations/offers/payments: 0. Two public artifacts, one public recruitment reply, one scheduled roundtable, two organizer proposals, and one community application add audience evidence only. LinkedIn remains paused after the authenticated browser session logged out following an anti-scraping protection request. |
| B Control V0 | CODE COMPLETE / CUSTOMER DATA BLOCKED | CC-0–7 remain the product spine. No real customer financial data may enter Vognary until the independent security assessment and retest exit. Synthetic demonstrations do not raise this row. |
| C Production min | ACTIVE / PREFLIGHT BLOCKED | `control:preflight` currently blocks on target readiness, Control migrations, incident staffing, tabletop, legal/logging review, restore proof, monitoring delivery, and proposal-review approval. Restricted evidence remains outside Git; payment alone never authorizes customer-data access. |
| D Intelligence moat | PENDING | Needs corpus |
| E Distribution | PENDING | After A signal |
| F Platform | BLOCKED | Until A–E |

## Day-21 stop/go

```
Date:
Decision: GO / STOP / REWORK
Evidence summary:
```
