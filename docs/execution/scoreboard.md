# Live scoreboard (update with measured evidence only)

> Parent: [`docs/THE-LAW.md`](../THE-LAW.md) §5  
> Rule: never invent metrics. Empty cells mean “not measured yet.”

## Company composite (min-row)

| Dimension | Score | As of | Evidence |
| --- | ---: | --- | --- |
| Wedge sharpness | 8 | 2026-07-21 | Strategy review |
| Intelligence engine | 6 | 2026-07-21 | Engines strong; corpus empty |
| Trust & honesty | 9 | 2026-07-21 | Claims CI + fail-closed design |
| Product UX | 8 | 2026-08-19 | B2B landing promise + Review my software stack CTA. Value-first 2–5 bill scan. Home decision queue for possible overlap. Purpose/importance collected on the commitment, not in onboarding. Real-human <3 min remains unmeasured |
| Backend readiness | 8 | 2026-07-21 | SLOs met in production |
| Production activation | 7 | 2026-08-19 | Code schema through `0054`. Durable R2 backup GET-restore remains proven at `0053` by GitHub run `32109925496`. Inbox processing is on (unsigned inbound 401). Google forwarding confirmation URL is stored; `forwarding_verified_at` is still null. HMAC key id remains `receipt-alias-v1`. Real automatic receipt, second automatic receipt, and replay remain unproven |
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
| C Production min | ACTIVE | Code schema through `0054`. Durable R2 GET-restore proven at `0053`. Inbox processing is on. B2B V1 freeze SHA is not yet the production web SHA until this deploy. Real receipt/replay unproven |
| D Intelligence moat | PENDING | Needs corpus |
| E Distribution | PENDING | After A signal |
| F Platform | BLOCKED | Until A–E |

## Day-21 stop/go

```
Date:
Decision: GO / STOP / REWORK
Evidence summary:
```
