# Product thesis and PRD for the thing worth testing

This PRD is not a build order. It becomes a build order only after the 2026-11-07 gate in `06_VALIDATION_AND_DISCOVERY.md` passes. Until then the engineering scope is zero.

## Promise, one sentence

Before a material AI, API, or cloud bill is agreed, a named person writes down what it is for and the most it may cost; when the bill arrives, Vognary shows whether the bill kept that promise.

## Why this is not an AI wrapper or a FinOps clone

The signed-in product does not need a model to keep the promise. Amounts are either user-entered assumptions or figures copied from evidence the user supplies. A model that guesses a merchant or a saving is out of scope. FinOps products win by ingesting the billing feed and allocating it. This product wins only if the *decision* is the thing the buyer came for, and the feed is optional evidence afterwards. If buyers want the feed first, this PRD is the wrong product and the gate should fail.

## Persona

**Primary.** Founder of an India-operating AI product company, 15–80 people, who personally approves a model or cloud commitment at least once a quarter and is surprised, at least sometimes, by the later invoice.

**In the room, not the buyer.** The engineer who holds the API key. They may submit the proposal. They may not freeze the cap.

**Out of scope.** A FinOps manager. A procurement team. A company whose spend already runs through Ramp or Zip. An agency reselling AI hours, until five product-company interviews have been done. Agencies are a possible second segment, not a reason to widen the first screen.

## End-to-end workflow

1. **Trigger.** A vendor asks for a new plan, a reserved capacity block, or a higher monthly cap, or last month's invoice is already over what the founder remembers allowing.
2. **Propose.** Someone enters merchant, purpose, category (`AI_MODEL` or `CLOUD_INFRASTRUCTURE` only, in the first pilot), currency, amount as a minor-unit assumption, first charge date, cadence, and one measurable intended outcome. They attach or point at any existing bill already in the workspace. If they have no prior bill, the product says exposure is unknown. It does not invent a stack.
3. **Policy.** A versioned rule the founder wrote earlier (per-charge, 13-week, annual ceilings, and a posture per category) marks the proposal within policy, review, or outside policy. The screen says a rule cannot approve it.
4. **Decide.** The founder approves, approves a lower cap with a date the authorisation dies, or declines. The cap and the reason are stored and are not recomputed when the bill arrives.
5. **Wait.** Vognary does not call the vendor, buy the commitment, or issue a key.
6. **Evidence.** The founder pastes or uploads the later invoice, or, only if they already asked for it, a Zoho Books bill snapshot. The line is cited. Unsupported fields stay blank.
7. **Reconcile.** The product compares the cited observed amount with the frozen cap and returns one verdict: matched, within cap, over cap, wrong currency, expired authorisation, or cannot evaluate.
8. **Optional outcome.** The founder may type what happened in the business. The product labels it user-entered and computes only met, missed, or not observed. It does not call that a saving.
9. **Next decision.** The founder either opens a new proposal or records that nothing further will be done. The old cap does not silently rise.

## User stories and acceptance

| Story | Acceptance |
| --- | --- |
| As the founder I can see that a proposed figure is an assumption | The UI and the API both carry `assumptionBasis: USER_ENTERED_ASSUMPTION`. A proposal with no evidence does not render as spend |
| As the founder I can set a ceiling once | Saving policy creates a new version. Old decisions keep the version they were judged against |
| As the founder I can approve less than was asked, and that lower number is what the later bill is judged against | An over-cap verdict uses the frozen cap, not the original request |
| As the founder I cannot approve my own proposal if a second admin exists | Maker-checker already exists in the control code. In a one-founder pilot, record that the same person proposed and decided. Do not pretend there were two people |
| As the founder I can decline | A decline stores the person, the time, and the reason. It does not say the vendor was cancelled |
| As the founder I can match one later bill | The reconciliation stores evidence id, observed amount, currency, and verdict. A second bill needs its own reconciliation, not an edit of the first |
| As the founder I can export or delete the workspace | Existing privacy export and deletion stay in force. The pilot does not add a new store |
| As a buyer I can tell the demo from my company | Synthetic pages keep the synthetic label. The pilot workspace never loads `syntheticDeskRecords` |

## Non-goals for the first paid month

- No card issuance, no UPI, no vendor payment, no refund of a vendor charge.
- No API gateway, no key custody, no hard stop inside OpenAI, Anthropic, AWS, Azure, or GCP.
- No automatic approval, denial, or "agent that watches spend."
- No Gmail OAuth, no bank login, no Account Aggregator.
- No SaaS discovery, no seat harvesting, no "you could save ₹X."
- No multi-entity consolidation, no budget versus payroll, no runway forecast.
- No mobile app, no Slack bot, no marketplace.
- No second category beyond AI model and cloud infrastructure until five pilots have reconciled at least one real bill. Software, contractors, and campaigns stay in the enum and stay off the first-run composer if the gate's buyers only talked about AI and cloud.
- No claim that a matched bill means the spend was wise.

## Initial scope, if the gate passes

Use the loop already implemented under `src/lib/commitment-control/` and the control desk UI. The pilot is configuration and concierge, not a new platform:

- One workspace, one policy, at most ten proposals, four founder-assisted reconciliations.
- Evidence is paste, upload, or a bill the customer already holds. Inbox forwarding is optional and off by default.
- Currency is whatever the bill uses, stored exactly. Do not convert USD to INR inside a verdict.
- The founder of Vognary operates the account with the customer for that month. Software must let the customer repeat the loop without him, but the pilot does not have to be self-serve on day one.

## What the customer loses if they leave

After one month: a small set of frozen decisions and the bills linked to them. That is a real inconvenience and a weak lock-in. Say so. Do not design artificial lock-in. Export remains available.

## Compounding asset, only if the loop repeats

The asset is not a model. It is a sequence of decisions with later evidence, permissioned to that company, that makes the next decision faster and makes an audit possible. It compounds only if the second month happens without being rebuilt in a spreadsheet. One pilot does not create a moat. See `10_LONG_TERM_THESIS.md`.

## Falsifier inside the product itself

If a pilot customer completes the month and cannot point to one decision they made differently because the record existed, the product failed even if they were polite. Refund under the published terms if the activation conditions say so. Do not add features to talk them out of that result.
