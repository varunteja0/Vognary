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
| Product UX | 7.5 | 2026-08-26 | Score unchanged: five T0–T4 sessions and measured <3 min value remain unproven. This checkout’s public promise is Commitment Control (decide before the obligation exists), not the 2026-08-24 “Know what renews” / `Now / Bills / Receipts` copy. Control e2e 20/20 locally. No score raise until live-session evidence |
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
| Explicit ₹14,999/month offers | 0 | 10 | 30 | 0 |
| Upfront paid pilots | 0 | 3 | 10 | 0 |
| Pre-spend proposals evaluated | 0 | 30 | 150 | 0 |
| Materially changed / capped / declined decisions | 0 | 3 | 15 | 0 |
| Requests received before spend | — | ≥80% | ≥90% | unmeasured |
| Paid pilot renewals | 0 | 2 | 7 | 0 |

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Hygiene | DONE | 2026-07-21 |
| A Paid proof | ACTIVE / INSTRUMENTS READY | First beachhead is India-registered, recently funded 20–100-person AI-native companies with a named finance owner and buyer-confirmed ≥₹8 lakh/month controllable exposure. 2026-08-26 public audit and founder review: 5 founder-qualified / 0 contacted. P02 and P03 are explicit stress-test targets; verified shortfall is 15 of 20. Historical Autopilot outreach does not count. `/pay` is the public ₹14,999/month subscription page; it is not a paid-customer measurement until CRM records a settlement. |
| B Control V0 | CODE COMPLETE / HARD STOP | CC-0–7 remain the V0 spine. Operability Waves 1–4 (Control identity, `0058` invites, `0059` loop binds, ₹14,999 invoice pack) are on this SHA. Control stays fail-closed until track F applies `0057` then `0058`/`0059` and enrolls an exact UUID. Founder next: send five qualified drafts **and** execute track F in parallel. No further product until a live session or money/trust defect. No measured scoreboard raise until a conversation, offer, or payment exists. |
| C Production min | ACTIVE / EXTERNAL BLOCK | Deployed production remains SHA `8286b04` / later docs SHAs on `origin/main`; live health is 200; Control remains unenrolled/fail-closed on verified schema `0056`. Local CI-equivalent gates pass on the operability candidate. GitHub CI/backup jobs cannot start because the account has failed payments or reached its Actions spending limit. Track F is unexecuted: `pre-0057` backup, bounded `0057`, then `0058`/`0059`, then exact UUID enrollment. Production migration, pilot UUIDs, real automatic receipts, reminder delivery, retention attestation, and first ICP completion remain unproven. |
| D Intelligence moat | PENDING | Needs corpus |
| E Distribution | PENDING | After A signal |
| F Platform | BLOCKED | Until A–E |

## Day-21 stop/go

```
Date:
Decision: GO / STOP / REWORK
Evidence summary:
```
