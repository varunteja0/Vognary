# Live scoreboard (update with measured evidence only)

> Parent: [`docs/THE-LAW.md`](../THE-LAW.md) §5  
> Rule: never invent metrics. Empty cells mean “not measured yet.”

## Company composite (min-row)

| Dimension | Score | As of | Evidence |
| --- | ---: | --- | --- |
| Wedge sharpness | 8 | 2026-07-21 | Strategy review |
| Intelligence engine | 6 | 2026-07-21 | Engines strong; corpus empty |
| Trust & honesty | 9 | 2026-07-21 | Claims CI + fail-closed design |
| Product UX | 7.5 | 2026-08-16 | Cited first-value Home + fail-closed Autopilot UI is automated across desktop/mobile, including real-PostgreSQL Customer #0, correction propagation, export/delete, mandate/revoke, axe, overflow, and reduced motion. Real-human <3 min remains unmeasured |
| Backend readiness | 8 | 2026-07-21 | SLOs met in production |
| Production activation | 5.5 | 2026-08-16 | Authenticated endpoint probes pass; Google, shared PostgreSQL rate limiting, Sentry, persistent backend, and clean Recovery cutover report ready. Public release is blocked because production migrations stop at 0026, durable encrypted backup storage/restore status is unconfigured, receipt-inbox attestation is pending, and the retention deployment schedule is unverified |
| Live connector depth | 4 | 2026-07-21 | Registry ≠ live |
| Data / network moat | 3 | 2026-07-21 | No network data yet |
| Business validation | 1.5 | 2026-07-21 | Pipeline not asked — founder Phase A |
| Distribution | 1.5 | 2026-07-21 | No loops running |
| **COMPOSITE (min)** | **1.5** | 2026-07-21 | Still floor = business |

## 90-day operating metrics

| Metric | Day 0 | Day 30 target | Day 90 target | Current |
| --- | ---: | ---: | ---: | ---: |
| Connected accounts with active mandates | 0 | 10 | 40 | |
| Accounts with an eligible candidate | 0 | 5 | 15 | |
| Supported actions with no post-mandate customer work | 0 | 3 | 10 | |
| Covered clean financial windows | 0 | 2 | 8 | |
| Actual payments of 20 real offers | 0 | 5 | 15 | |
| Written pay intent (separate; not the paid gate) | 0 | track | track | |
| D30 active-source-and-mandate retention | — | ≥40% | ≥60% | |

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Hygiene | DONE | 2026-07-21 |
| A Market contact | ACTIVE | Private autopilot pilots; gitignored CRM has 20 sourced-target rows; funnel 20→5→2→1→1 defined; conversations/connected/mandate/paid remain 0; nothing sent |
| B Loop shipping | ACTIVE | WP-A.2 is on `main` (PR #34). Autopilot integrity work is on `feat/autopilot-loop` through additive 0047. Final orchestrator: code CI, disposable PostgreSQL, complete browser/axe, production smoke, and load budgets PASS; strict corpora, operations, and strict production activation FAIL. Focused proof: migration rehearsal 27/27; source authority 26/26; receipt-inbox PostgreSQL 14/14; direct/concurrent billed-window inserts fail closed. WP-C–E are not complete. No live receipt/notice/provider/payment evidence. No measured scoreboard raise |
| C Production min | ACTIVE | Authenticated endpoints pass and Google/persistence/rate limiting/Sentry are ready. Blocked: production schema stops at 0026; durable encrypted backup/restore status, receipt-inbox attestation, and retention schedule proof are absent |
| D Intelligence moat | PENDING | Needs corpus |
| E Distribution | PENDING | After A signal |
| F Platform | BLOCKED | Until A–E |

## Day-21 stop/go

```
Date:
Decision: GO / STOP / REWORK
Evidence summary:
```
