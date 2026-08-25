# Live scoreboard (update with measured evidence only)

> **Operating motto: Take smart risks. Do not play safe.** Reward measured,
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
| Business validation | 1.5 | 2026-08-25 | Commitment Control authorized; 0 measured paid pilots, proposals, changed decisions, or renewals |
| Distribution | 1.5 | 2026-07-21 | No loops running |
| **COMPOSITE (min)** | **1.5** | 2026-07-21 | Still floor = business |

## Commitment Control operating metrics

| Metric | Day 0 | Day 30 target | Day 90 target | Current |
| --- | ---: | ---: | ---: | ---: |
| Qualified conversations | 0 | 10 | 30 | 0 |
| Explicit ₹40,000/month offers | 0 | 10 | 30 | 0 |
| Upfront paid pilots | 0 | 3 | 10 | 0 |
| Pre-spend proposals evaluated | 0 | 30 | 150 | 0 |
| Materially changed / capped / declined decisions | 0 | 3 | 15 | 0 |
| Requests received before spend | — | ≥80% | ≥90% | unmeasured |
| Paid pilot renewals | 0 | 2 | 7 | 0 |

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Hygiene | DONE | 2026-07-21 |
| A Paid proof | ACTIVE | Commitment Control offer authorized 2026-08-25. Target: ten qualified conversations and explicit ₹40,000/month offers; two upfront payments by Day 10. Current new-thesis conversations/offers/payments: 0/0/0. Historical Autopilot outreach does not count. |
| B Control V0 | CODE COMPLETE / RELEASE BLOCKED | CC-0–7 implemented: exact domain, `0057`, store/RBAC/idempotency, runtime-guarded routes, Control-first UI, reconciliation, privacy/export/erasure, enrollment, backup/readiness controls. Unit 1066/1066, PostgreSQL 169/169, Control browser 20/20, Recovery browser 48/48 with 4 environment skips, build and perf pass. Production migration, exact-head CI, deployment, enrollment UUIDs, and real pilot evidence remain unproven; no measured scoreboard raise. |
| C Production min | ACTIVE | Production schema remains honestly at verified `0056`; Control requires founder-run backup/restore plus additive `0057` before route deployment. Current candidate build/perf and disposable database gates pass. Exact-head CI, deployment, pilot UUIDs, browser matrix, real automatic receipts, reminder delivery, retention attestation, and first ICP completion remain unproven. |
| D Intelligence moat | PENDING | Needs corpus |
| E Distribution | PENDING | After A signal |
| F Platform | BLOCKED | Until A–E |

## Day-21 stop/go

```
Date:
Decision: GO / STOP / REWORK
Evidence summary:
```
