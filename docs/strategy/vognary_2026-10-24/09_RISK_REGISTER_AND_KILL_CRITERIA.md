# Risk register and kill criteria

Scores are judgments: likelihood of hurting the next 90 days, and severity if it hits. 1 low, 5 high. They are not measured probabilities.

| ID | Risk | L | S | Early sign | Action |
| --- | --- | --- | --- | --- | --- |
| M1 | The painful moment is the invoice, not the commitment. The product solves the wrong minute | 4 | 5 | In the first three calls, people talk about GST, forex, "what is this line," or a forgotten seat, and go quiet when asked where the yes was written | Kill B at G0. Do not retune the script to fish for pre-spend language |
| M2 | Buyers want a block, and a record is not a block | 4 | 5 | They say yes only if the API key or the card dies at the ceiling | Stop. A gateway or a card is a different company. Do not bolt a weak block onto the ledger |
| M3 | An incumbent copies the screen | 3 | 3 | CloudZero, Ramp, or Zoho ships "purpose + approver + cap + invoice" for this segment | Expected. Survive only if the workflow is already a habit. If no habit exists, copying does not matter because there was no business |
| M4 | Platform absorption | 4 | 4 | OpenAI, Anthropic, AWS, or Zoho shows a native approval object good enough for a 40-person team | If the native object includes purpose and a later match, the wedge is gone. Confirm on their docs, then stop |
| C1 | Competitor saturation was misread | 3 | 4 | A buyer opens a sheet or a card tool that already answers the five questions | Record the tool. If two buyers do this, G0 fails |
| I1 | Integration fantasy | 3 | 4 | The pilot cannot start until Zoho, AWS, and mail all connect | Refuse. Paste is the first month. If they refuse paste, they are not the pilot |
| P1 | Privacy incident or the live intake hole | 3 | 5 | Another anonymous analysis of real-looking text; a log line with a bill; a buyer pastes into `/start` because a page invited them | No invitations to `/start`. Fix production only under a separate authorization. If a real bill was processed, follow the privacy notice and tell the founder the same day |
| P2 | False attribution | 3 | 5 | A verdict or a landing number is read as a saving, a cancellation, or proof of ROI | Keep the labels. If a pilot customer repeats a false claim publicly, correct it. Do not let a model write the verdict |
| B1 | Buyer inertia | 4 | 4 | "Send a deck," then silence. Or they like the demo and will not put a live decision in | Silence is a no. Two silences do not justify a new feature |
| D1 | No distribution | 5 | 5 | The founder cannot name 8 approvers he can reach without a stunt | The 14-day test fails for lack of access. That is a company problem, not a prompt for ads |
| $1 | Price is a services price | 3 | 3 | They pay only when the founder does the typing | Label the revenue as assisted. Do not raise a software valuation story on it |
| $2 | Refund and tax surprises | 2 | 3 | Payment is taken before the ten-day activation conditions can be met | Do not take payment until assessment and activation are honestly schedulable |
| F1 | Founder bandwidth and thesis churn | 5 | 4 | A new category appears in week one of the conversations (agents, trading, instruction ledger, compute) | Park it in the decision log. Do not staff it. The kill criteria, not novelty, reopen a thesis |
| F2 | Building during the test | 3 | 4 | A "small" schema or landing change lands before 2026-11-07 | Revert the urge. The test is invalid if the product moves under the answers |
| L1 | Live site trust | 4 | 4 | A prospect reads `/security` and then successfully pastes a bill | Already true for the anonymous audit route. Do not deny it if asked |

## Kill, narrow, or change

**Stop Commitment Control investment** if any of these is true:

- G0 fails on 2026-11-07.
- G0 passes and the data gate is still open 30 days later because assessment or production truth was not pursued. The idea is then a slide, not a pilot.
- G1 ends with no named changed decision.
- Two independent buyers describe the same substitute that already does the job, and neither will pay to leave it.
- The only way to make the pilot true is autonomous money movement, a card, or an uncited model. Those are hard stops in THE-LAW, not features.

**Narrow** if G0 passes only for a thinner group than this file assumes. Example: only companies with a monthly model bill above a threshold they themselves name, or only founders who are also the approver. Rewrite the ICP in one paragraph. Do not add a second segment in the same edit.

**Change the hypothesis** only when a kill condition above has fired and a new ledger, not a new essay, shows a repeated job. The Instruction Ledger, trading, ComputeShift, and a universal payments protocol stay closed through this gate. A future review may re-open one of them only by re-checking primary sources and running its own conversation gate. The untracked `research/` directory is not that review.

## What is not a kill

- A small number of conversations. Five is the design. Fifty is procrastination.
- A competitor blog post. Shipping a feature is not the same as a buyer in this segment using it.
- The absence of a trillion-dollar path. The first gate does not need one.
- Low historical usage of Vognary. That falsifies "the current site is already working," which this plan already accepts. It does not, alone, falsify the job.

## Review cadence

One decision meeting on 2026-11-07. If G0 passes, the next meeting is the last day of the pilot month. No weekly strategy rewrite. New articles about AI spend go into a note. They do not move the gate.

## Addendum — 2026-10-24

The 2026-11-07 meeting is G1 in the execution runbook (same four tests as G0 here). OpenAI, AWS, LiteLLM, and Harness now have inspected pages showing alert or hard-stop controls. That raises M2 and C1. It does not by itself fail the sprint. The calls still have to show whether those controls leave a purpose-record gap the buyer will pay for. No result is in the ledger.
