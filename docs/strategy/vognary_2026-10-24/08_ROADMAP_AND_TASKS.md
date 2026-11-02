# Roadmap and tasks

Code is not a task in the first 14 days. A task that changes `src/`, `infra/postgres/`, billing, or auth is out of scope until the founder accepts the relevant gate in writing. This file is the sequence. It does not authorize the work by itself.

Effort ranges are founder-time, one person, part-time. They are judgments, not estimates from a team.

## Days 0–14 — research gate (now through 2026-11-07)

No production change. No new outreach on exhausted September threads.

| ID | Priority | Task | Depends on | Effort | Acceptance | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | P0 | Book and hold 8 approver conversations. Log asks the same day | Nothing | 4–8 h to book, 5–8 h to hold | Ledger has 8 ask-rows and at least 5 completed approver rows, quotes separated from interpretation | Founder describes the product in minute 2 and contaminates the sample |
| R2 | P0 | Run the script in `06_VALIDATION_AND_DISCOVERY.md` | R1 | Inside the calls | Each completed row answers pre-spend versus post-spend, substitute, and price | Leading questions |
| R3 | P0 | Write the gate memo on 2026-11-07: go or no-go, with the four conditions | R2 | 2 h | A dated paragraph in `11_DECISION_LOG.md` style, stored with the ledger. Counts match the rows | Declaring a go from enthusiasm |
| R4 | P1 | List, without fixing, the production intake contradiction and the unpaid `/pay` path as pilot blockers | This audit | 1 h | The memo names `POST /api/audit` 200 versus source 403, and collection not configured | Someone "quickly fixes" production during the interviews |
| R5 | P2 | Re-read only the competitor page a buyer names | A name in a ledger row | 30 min each | The ledger links the page and says whether that tool already stores purpose plus cap plus later bill | Spending the 14 days on more market essays |

**Gate G0, 2026-11-07.** Pass: the four conditions in `00_EXECUTIVE_DECISION.md`. Fail: stop. Do not start G1.

## Days 15–30 — pilot setup, only if G0 passes

Still no new product surface. The work is to make the existing loop safe enough for one company, or to refuse to admit data and run the month on redacted documents.

| ID | Priority | Task | Depends on | Effort | Acceptance | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | P0 | Founder decides whether to fund an independent security assessment | G0 pass | A decision, not code | Written yes or no. No means the pilot cannot take real bills | Treating a friend's review as independent |
| P2 | P0 | Confirm production git SHA, schema head, and backup restore evidence | G0 pass and access | 0.5–2 days | A private note with SHA, migration id, and restore hash status. No secrets | Migrating production "to get to 0077" without a restore plan |
| P3 | P0 | If P2 shows production is behind `main`, plan the smallest deploy that makes anonymous financial intake fail closed. Do not deploy until the founder authorizes that deploy alone | P2 | 0.5–2 days of planning; implementation is a separate authorization | A written deploy scope: intake lock only, no feature work, rollback named | Bundling a redesign into the hotfix |
| P4 | P0 | One company, one workspace, existing control desk, categories limited in conversation to AI model and cloud even if the enum is wider | P1 and P3 done, or an explicit redacted-document pilot with no workspace data | 1 day of setup | Buyer freezes one cap on a proposal whose bill has not arrived | Demo data left in the workspace |
| P5 | P0 | Four weekly reviews on the calendar before the invoice is sent | P4 | 2 h scheduling | Dates accepted by the buyer | Reviews become unstructured consulting |
| P6 | P1 | Collect payment only through a path the founder has legally accepted | Separate founder decision | Outside this plan | A receipt that matches ₹14,999 or the price G0 actually validated, one-time | Turning on Razorpay inside this strategy task |

**Gate G1, end of the pilot month.** Pass: at least three pre-spend proposals, one cited reconciliation, one changed decision the buyer can name, and a clear month-two yes or no. Fail: stop feature work. Honour the refund terms if they apply.

## Days 30–90 — only if G1 passes

The build list is a short repair list, not a roadmap of ideas.

| ID | Priority | Task | Depends on | Effort | Acceptance | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | P0 | Remove founder heroics from the one path the pilot actually used. If paste failed, fix paste. If the verdict was misread, fix the sentence | G1 notes | 2–5 days | The buyer completes a second reconciliation without the founder typing | Generalised redesign |
| M2 | P1 | Zoho bill read, only if the pilot buyer already lives in Zoho and asked | G1 and the existing Zoho contract in the README | 3–8 days | A bill snapshot reconciles under the existing basis rules on a synthetic bill, then on theirs | Connecting Zoho because the code exists |
| M3 | P1 | Second paying company on the same offer, no new feature | M1 | Founder time | They reach a frozen cap in week one | Customising the second workspace |
| M4 | P2 | Self-serve payment, only after two companies have paid by invoice and the data gate is boringly reliable | Two receipts | A separate project | A buyer can pay and still cannot upload data until assessment clears | Equating payment with activation |
| M5 | Not scheduled | Gateway, card, Gmail, bank, agent, new visual system | None | Do not estimate | — | This is how the repo got large |

## Reuse and do not build

**Reuse if G0 passes:** control policy, proposals, decisions, reconciliations, outcome labels, exception reviews, evidence encryption, workspace roles, invites, synthetic demo for training the founder not the customer, privacy export and delete.

**Do not build in the next 90 days even if G1 passes:** a new design system, an AI narrator, autopilot, provider execution grants, a mobile app, benchmarks, a savings number, multi-company rollup, an instruction ledger, anything related to trading.

**Do not delete** Recovery, Zoho, or autopilot code as part of strategy. Retirement is a later change with its own tests. Positioning can stop mentioning them immediately, in conversation. The website copy is a product change and waits for an explicit edit request.

## Owners

| Work | Owner |
| --- | --- |
| Conversations, price, legal, Razorpay, assessment purchase | Founder. Agents do not send mail, take payment, or claim an assessment |
| Ledger hygiene and this document set | Whoever the founder asks. This review wrote the initial set |
| Any later code | One git owner on `main`, after the gate, with the existing test chain in `AGENTS.md` |

## Decision gates, collected

| Gate | Date | Pass | Fail |
| --- | --- | --- | --- |
| G0 conversations | 2026-11-07 | 5 approver calls, 3 pre-spend, 2 priced, 1 pilot conversation | No code. Thesis frozen |
| Data gate | Before any real bill | Intake lock on production, schema known, assessment cleared, restore evidence | Redacted documents only, or no pilot |
| G1 first month | About 30 days after the pilot starts | 3 pre-spend proposals, 1 reconciliation, 1 named changed decision, month-two answer | Stop |
| G2 repeat | 90 days from G0 | A second company, or the first company paid again, with founder hours falling | Keep as a one-client service or stop. Do not hire or raise on it |

## Addendum — 2026-10-24

The dated schedule, owners, and status labels for 2026-10-24 through 2026-11-07 are in `docs/discovery/2026-10-24_sprint/00_EXECUTION_RUNBOOK.md`. In that file the conversation gate is named G1. It is the same test as G0 in the table above. R1–R3 are founder work and are not done. No code task has started.
