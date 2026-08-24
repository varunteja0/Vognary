# Live scoreboard (update with measured evidence only)

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
| A Market contact | ACTIVE | Gitignored CRM still has sourced-target rows. Funnel 20→5→2→1→1. **Conversations = 1** as of 2026-08-24: Prashanth Vaidya / Indie Genie Labs, X thread [2090155802158084243](https://x.com/pvbuilds/status/2090155802158084243). Fable-limits public reply sent 2026-08-22, no reply; next is a non-pitch reply on the 2026-08-23 Codex-switch post, not a bump. Connected / mandate / paid / live session remain 0. F03–F06 unconfirmed as sent. |
| B Loop shipping | ACTIVE | WP-A.2 is on `main` (PR #34). Autopilot integrity work is on `feat/autopilot-loop` through additive 0047. Final orchestrator: code CI, disposable PostgreSQL, complete browser/axe, production smoke, and load budgets PASS; strict corpora, operations, and strict production activation FAIL. Focused proof: migration rehearsal 27/27; source authority 26/26; receipt-inbox PostgreSQL 14/14; direct/concurrent billed-window inserts fail closed. WP-C–E are not complete. No live receipt/notice/provider/payment evidence. No measured scoreboard raise |
| C Production min | ACTIVE | Production schema is through `0056`; durable R2 GET-restore remains proven. Inbox processing is on. The comprehension-reset candidate passes unit 1013/1013, public e2e 34/34, signed-in UI 46/46, Customer #0 2/2, build, claims, tokens, and bundle budgets. Exact-head GitHub CI and live deployment are the publication gates. Real automatic receipts, reminder delivery, retention attestation, and first ICP completion remain unproven |
| D Intelligence moat | PENDING | Needs corpus |
| E Distribution | PENDING | After A signal |
| F Platform | BLOCKED | Until A–E |

## Day-21 stop/go

```
Date:
Decision: GO / STOP / REWORK
Evidence summary:
```
