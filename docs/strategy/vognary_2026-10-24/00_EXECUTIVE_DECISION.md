# Executive decision — 2026-10-24

**Decision: validate first. Do not build, do not pivot, do not launch.**

This directory is a founder-requested strategy review. It does not amend [`docs/THE-LAW.md`](../../THE-LAW.md) or [`docs/CONTINUE-HERE.md`](../../CONTINUE-HERE.md). Product truth stays Commitment Control until the founder accepts a later gate in writing. No production code, schema, billing, or customer data was changed to produce these files.

## What to do first

Test one job, with conversations, for 14 days:

> A founder or finance owner at an India-operating AI product company records a material AI, API, or cloud commitment before the money is spent, then later matches the real bill to the cap a named person froze.

If that test fails, stop spending engineering time on Commitment Control. Do not start a new product in the same week.

## Current evidence, separated from ambition

| | Statement | Label |
| --- | --- | --- |
| Product that is public | [vognary.com](https://www.vognary.com/) sells Commitment Control: a proposed amount, a named human decision, a frozen cap, and a later observed bill. Price shown: one-time ₹14,999 for one month. Online collection is labeled not configured. | FACT, pages read 2026-10-24 |
| Product that is in git | `main` at `3604496` (2026-09-10) implements that loop in code, plus an older Recovery bill desk, a Zoho Books bill-review candidate, and large retired surfaces (autopilot, connectors, checkout). | FACT |
| Product that customers use | Scoreboard and CONTINUE-HERE record 0 current-thesis conversations, 0 offers, 0 cleared payments, 0 real proposals. This review did not re-open the private CRM or production database. | FACT as of the last recorded scoreboard (2026-09-02 to 2026-09-09). UNKNOWN after that date |
| Demand for the job | AI spend is a documented management problem for FinOps practitioners and a vendor marketing theme for CloudZero and Ramp. That is not evidence that a 20–100 person Indian company will pay Vognary. | FACT for the practitioner survey; HYPOTHESIS for this buyer |
| Long-term ambition | A system of record for resource commitments could matter if the first job becomes a habit and later sits in front of real spend. A trillion-dollar company is an ambition. Nothing in the repo, the site, or the sources inspected makes it a forecast. | HYPOTHESIS |

## Why this, and not the neighbouring ideas

- **Keep improving the public subscription-review product (A).** The live homepage no longer sells that job. The category is crowded with cards, expense tools, and SaaS-renewal tools. Recovery code stays as the evidence shelf, not as the company.
- **Narrow to AI/cloud commitment control (B).** This is the only option that matches the code already built, a painful and frequent adjacent problem, and a buyer the founder can reach without a card licence or an enterprise sales team. It is not yet a business. It is the cheapest falsifiable bet.
- **Founder capital-allocation operating system (C).** Real founder pain, no single workflow, no right to win against accounting, cards, and spreadsheets. Reject as the entry product.
- **A new problem (D), including the supplier-payment Instruction Ledger.** Not selected. A–C were not all empty: B still has a two-week test that is cheaper than opening a new search. The untracked `research/` notes that prefer an Instruction Ledger were not re-verified in this review and stay parked.

## Go / no-go

**Gate date: 2026-11-07** (14 days from this review).

Proceed to a paid-pilot design only if all of these are true:

1. At least 5 completed conversations with the person who actually approves the AI or cloud bill.
2. At least 3 of those 5 describe the painful moment as *before* the commitment, without being led there.
3. At least 2 name a price, or accept a stated price, for a one-month record-and-reconcile pilot.
4. At least 1 will look at their own redacted bill with the founder after the data boundary is explained.

Otherwise: **no-go for build.** Freeze new product scope. Do not automatically adopt another thesis. The next review, if any, starts from the evidence ledger, not from a new idea.

## Unresolved risks that can kill B even if conversations sound warm

- The record does not stop the API call or the card charge. Buyers may want a block, not a ledger. Gateways and India corporate cards already block.
- Ramp, CloudZero, Vantage, Finout, Zip, and LiteLLM already cover pieces of visibility, budgets, and approval. The vacant seam is narrow and may be a spreadsheet.
- Production still accepts anonymous receipt text on `POST /api/audit` while `/security` says customer financial data is blocked. No pilot data until that contradiction is closed. This review did not patch it.
- Zero willingness-to-pay evidence exists. A polished loop is not demand.

## What would have to become true for a very large company

Vognary would have to become the place a large number of companies record commitments and later proof, with other systems treating that record as authoritative. That requires distribution Vognary does not have, a workflow people refuse to leave, and a data asset they agree to contribute. None of those exist today. Global AI spend forecasts are not a serviceable market. See `10_LONG_TERM_THESIS.md`.

## Addendum — 2026-10-24 execution packet

The conversation gate in this file was called G0. The execution runbook calls the same four conditions **G1**, dated 2026-11-07. Use G1 in the sprint. This file's "pilot month" gate is the later check, after G1, and it is not a result yet.

A same-day research pass narrowed the public-evidence claim: provider hard limits and gateways already exist (OpenAI help center, LiteLLM docs, AWS Budgets, Harness user budgets). The thing still being tested is a cross-vendor purpose-and-cap record for the small-company approver. Demand remains unvalidated. See `docs/discovery/2026-10-24_sprint/00_EXECUTION_RUNBOOK.md`.

THE-LAW §0.1 still requires offers and payments before the company is commercially validated. G1 does not replace that. No product code was changed.
