# Validation and discovery

Public research can show that a problem is discussed. Only a buyer can show that this product will be used and paid for. This file keeps those apart.

## What is already known from public sources

See `02_PROBLEM_AND_CUSTOMER.md` and `03_COMPETITIVE_LANDSCAPE.md`. Short version: FinOps practitioners say AI cost and pre-commitment costing matter; card, gateway, and FinOps vendors already sell pieces of the job; Vognary has no recorded payer. That is enough to justify conversations. It is not enough to justify code.

## What direct buyer evidence must add

For each conversation, the evidence ledger row (template below) must separate:

- **Problem evidence.** They describe a recent bill, a decision, and a consequence in their own words.
- **Solution evidence.** After the workflow is understood, they react to the specific promise. Politeness is not solution evidence.
- **Willingness to pay.** A number, a refusal, or a named substitute they already pay for.

The founder of Vognary does not count as a respondent.

## Who to talk to

No names and no contact details belong in this document. Do not scrape inboxes. Use people the founder can reach without pretending to be a customer, plus introductions those people offer.

| Role | Why they are in the set | How many in 14 days | Disqualify if |
| --- | --- | --- | --- |
| Founder or CEO of an India-operating product company, roughly 15–80 people, that pays a model provider or a cloud bill monthly | Closest to the buyer who can say yes this month | 5 completed | They have a FinOps hire, or their only "AI spend" is a personal ChatGPT seat |
| Person who actually approves the vendor invoice, if that person is not the founder | Tests whether THE-LAW's "named finance owner" exists in this size band | Up to 3, counted inside the 5 if they are the approver | They only file GST and never see the commitment |
| Fractional finance operator who closes books for several such companies | Can say whether the pain repeats across clients. One operator is not five customers | 2 conversations, reported separately, not padded into the count of 5 | They want a bookkeeping tool |
| Engineering lead who holds the API key | Explains whether a gateway budget already exists | 2, also separate | They want Vognary to host the key |

Target list construction: write the company description and the role before the call, not after. A row with no company description is not an interview. Communities and founder networks are legitimate. Paid ads are not part of this gate. Spending cap for the 14 days: ₹0 on ads. Founder time is the cost.

Do not contact the same Headstart, Reddit, or curator threads already marked exhausted in CONTINUE-HERE. This gate is new conversations about the workflow, not a restart of the September campaign.

## Interview script

Open with their month, not with Vognary. Do not show the site, the price, or a diagram until the questions below are answered, or until they ask what this is about. If they ask earlier, answer in one sentence and return to their workflow.

1. Walk me through the last time the company agreed to spend money on a model, an API, or cloud. Who said yes, and where was that yes written?
2. What arrived afterwards (invoice, card charge, usage screen)? How long after the yes?
3. Did the later number match what you thought you had allowed? What did you do when it did not?
4. What did that cost you, in money, time, or a delayed decision? A range is enough. Do not push for a precise rupee figure they do not have.
5. What tools were open while this happened? Card dashboard, Zoho, a sheet, the provider console, WhatsApp, something else?
6. What have you already tried that did not stick?
7. While we are talking, is there a commitment in the next 30 days that does not have a ceiling yet?
8. If a tool only wrote the decision down and later showed the bill against that decision, and could not block the provider, would you use it? Why or why not?
9. Only now, if the pain was real: what would a useful month of that look like, and what would you pay for that month? Let them name a number before you mention ₹14,999.
10. If you stopped using it after one month, what would you lose?

Competitor rebuttals, ask only if they have not already named a tool:

- "Have you set a budget inside the provider, or on a company card?"
- "If that limit already declines the spend, what is left that a separate record would do?"
- "Would you connect a billing account to a FinOps tool if it was free? If not, why would you paste bills into a new one?"

Stop the call if they want to upload a live invoice. Offer a later session with a redacted PDF only after the data gate in `05_ARCHITECTURE_AND_DATA.md` is actually closed. Until then, words and ranges only.

## Evidence ledger template

Store the ledger outside git if it contains company names. A private note is enough. Do not commit prospect names. Columns:

| Field | Rule |
| --- | --- |
| Date | |
| Role and company band | Size band and city or "remote India." No legal name in git |
| Trigger they described | Quote, short |
| Where the yes lives today | Tool or "nowhere" |
| Consequence | Their words, plus a range if they gave one |
| Substitute | Named product or "sheet" |
| Pre-spend or post-spend | Your classification, marked as inference, with the quote that supports it |
| Reaction to a record that cannot block spend | Yes / no / "only if it blocks" |
| Price they named | Blank if they were not asked. Do not invent |
| Asked for a pilot conversation | Yes / no |
| Founder interpretation | Separate from the quote |
| Follow-up allowed | Yes / no. No means do not write again |

## Experiments, timeboxes, success, kill

### Experiment 0 — conversations

- **Start:** 2026-10-24. **End:** 2026-11-07.
- **Owner:** founder.
- **Activity:** at least 8 asks, at least 5 completed approver conversations, using the script. Fractional and engineering calls are extra.
- **Success:** all four conditions in `00_EXECUTIVE_DECISION.md`.
- **Kill:** fewer than 3 of 5 locate the pain before the commitment; or zero of 5 will pay more than they pay for a spreadsheet; or the only enthusiastic buyers already run Ramp, a gateway budget, or a FinOps tool and will not add a ledger.
- **If kill:** no code. Write the ledger into the next decision-log entry. Do not open a new product thesis in the same week.

### Experiment 1 — concierge pilot, only if Experiment 0 passes

- **Window:** the following 30 days, one or two companies, not ten.
- **Offer:** the existing one-time ₹14,999 month, unless Experiment 0 produced a different number the founder accepts in writing. One-time. Month two is another explicit purchase.
- **Data:** still blocked until the assurance and production-lock conditions in the architecture file are true. If they are not true, the pilot is a conversation over redacted documents and the software is not given real data. A paid invoice does not waive that.
- **Success:** the customer completes at least three proposals before the spend, at least one reconciliation against a real or redacted bill, and names one decision that changed because the record existed. They can say whether they would buy month two.
- **Kill:** they will only continue if Vognary blocks the API or the card; or they stop showing up after policy setup; or the founder spends more than the two included support hours plus the four reviews and the customer still cannot complete a loop alone.

### Experiment 2 — second month

Not designed here. It exists only if Experiment 1's customer asks for it without a new feature promise. A second customer is not required to learn. It is required before any claim of repeatability.

## Public research versus buyer evidence

| Claim | Allowed source |
| --- | --- |
| "FinOps teams want earlier cost information" | The FinOps survey. Label the population |
| "A 40-person Bengaluru company will pay" | A ledger row. Not the survey |
| "Competitors are weak" | Forbidden unless a primary page shows the missing capability and a buyer says they feel the gap |
| "The live site is the product customers use" | Forbidden. The site is public and unused until a ledger row says otherwise |

## Founder rules during the 14 days

- Do not change the product, the price page, or the schema to make the conversations easier.
- Do not send `https://www.vognary.com/start` as a place to paste a real bill.
- The synthetic `/demo` may be shown only after question 8, and only with the sentence "every figure on this page is fake."
- A "maybe, send a deck" is not a yes.
- Two conversations that repeat the founder's own story back to him are not independent evidence. Write that down when it happens.

## Addendum — 2026-10-24

The operational script, empty ledger, unsent outreach, and blank G1 memo now live in `docs/discovery/2026-10-24_sprint/`. Follow those files for the sprint. This page remains the reasoning. The runbook's G1 is this page's Experiment 0. Do not run Experiment 1 until that gate passes and the safety blocker is closed.
