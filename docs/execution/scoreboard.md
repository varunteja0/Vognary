# Live scoreboard (update with measured evidence only)

> Parent: [`docs/THE-LAW.md`](../THE-LAW.md) §5  
> Rule: never invent metrics. Empty cells mean “not measured yet.”

## Company composite (min-row)

| Dimension | Score | As of | Evidence |
| --- | ---: | --- | --- |
| Wedge sharpness | 8 | 2026-07-21 | Strategy review |
| Intelligence engine | 6 | 2026-07-21 | Engines strong; corpus empty |
| Trust & honesty | 9 | 2026-08-21 | Retired demo modes are crawlable 410/noindex tombstones; retired audit intake and checkout cannot collect or charge regardless of env; README, sitemap, legal, ops, and outreach story now match the frozen product. Sensitive routes use script nonces and bounded style hashes. No score raise without external/user proof |
| Product UX | 8 | 2026-08-22 | First-session `/start` and signed-in Home share spoken cards. Decision cards, upcoming rows, and the quiet charge name the last cited bill — never a blend no receipt contains. Coming later omits queued vendors at the presenter layer; `home.next` stays the full upcoming timeline. Keep hook uses a calendar date. Unit 1001/1001, postgres 159/159, 34/34 focused e2e on this exact tree. Live SHA session, live user, and <3 min remain unmeasured |
| Backend readiness | 8 | 2026-07-21 | SLOs met in production |
| Production activation | 7 | 2026-08-19 | Code schema through `0055_recovery_decision_cycles` (applied on production Neon 2026-08-19; checksum matches this tree; one deterministic Notion `PLAN_TO_CANCEL` backfill, no fabricated verification). Durable R2 backup GET-restore remains proven at `0053` by GitHub run `32109925496`. Inbox processing is on (unsigned inbound 401). Google forwarding confirmation URL is stored; `forwarding_verified_at` is still null. HMAC key id remains `receipt-alias-v1`. Real automatic receipt, second automatic receipt, and replay remain unproven |
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
| A Market contact | ACTIVE | Gitignored CRM still has sourced-target rows. Funnel 20→5→2→1→1. **Conversations = 1** as of 2026-08-22: Prashanth Vaidya / Indie Genie Labs, X thread [2090155802158084243](https://x.com/pvbuilds/status/2090155802158084243) (Claude Max localisation → Claude+Codex). Connected / mandate / paid remain 0. F01/F02 first touches were already sent 2026-08-20; do not resend. |
| B Loop shipping | ACTIVE | WP-A.2 is on `main` (PR #34). Autopilot integrity work is on `feat/autopilot-loop` through additive 0047. Final orchestrator: code CI, disposable PostgreSQL, complete browser/axe, production smoke, and load budgets PASS; strict corpora, operations, and strict production activation FAIL. Focused proof: migration rehearsal 27/27; source authority 26/26; receipt-inbox PostgreSQL 14/14; direct/concurrent billed-window inserts fail closed. WP-C–E are not complete. No live receipt/notice/provider/payment evidence. No measured scoreboard raise |
| C Production min | ACTIVE | Code schema through `0055`. Durable R2 GET-restore proven at `0053`. Inbox processing is on. Public trust hardening locally passes unit 965/965, PostgreSQL 159/159, built desktop/mobile trust journeys 16/16, smoke, bundle budgets, and Lighthouse; normal GitHub Turbopack CI is the publication gate. Real receipt/replay and first ICP completion remain unproven |
| D Intelligence moat | PENDING | Needs corpus |
| E Distribution | PENDING | After A signal |
| F Platform | BLOCKED | Until A–E |

## Day-21 stop/go

```
Date:
Decision: GO / STOP / REWORK
Evidence summary:
```
