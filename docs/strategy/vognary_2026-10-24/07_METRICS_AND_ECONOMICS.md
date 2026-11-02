# Metrics and economics

Numbers below are arithmetic on stated assumptions. They are not a forecast. A blank means this review did not measure it.

## Do not use these as the market

| Figure | What it is | What it is not |
| --- | --- | --- |
| Gartner: $2.67 trillion worldwide AI spending in 2026, of which infrastructure is $1.48 trillion and generative AI models are $28.3 billion. [Press release, 16 September 2026](https://www.gartner.com/en/newsroom/press-releases/2026-09-16-gartner-forecasts-worldwide-ai-spending-to-grow-49-point-5-percent-in-2026) | An analyst forecast of global spending, mostly infrastructure | TAM for a commitment ledger. Vognary cannot invoice a hyperscaler's capex |
| FinOps Foundation: 98% of respondents manage AI spend. [data.finops.org](https://data.finops.org/), inspected 2026-10-24 | Share of a practitioner survey | Share of Indian startups, and not a count of buyers |
| Ramp: company-claimed 85,000 customers and $275 billion annualised purchase volume, via [TechCrunch, 15 October 2026](https://techcrunch.com/2026/10/15/ramp-reaches-60b-valuation-as-it-pushes-deeper-into-ai/) | A scale comparison for a US spend platform | A market Vognary can take a percent of |

**TAM.** Unknown, and not needed. Any TAM built by multiplying a startup count by ₹14,999 would be fiction. This file refuses that multiplication.

**Serviceable market.** Unknown. A defensible description, not a size: India-operating product companies small enough to lack FinOps staff and a US card platform, and large enough to feel an AI or cloud invoice. No census of that set was found in the pages opened.

**Reachable first market.** The number of approvers the founder can speak to in 14 days without ads. Plan for 8 to 15 conversations. That is the market that exists this month.

## Metrics that match the workflow

Vanity: page views, demo completions, "interested" replies, founder hours spent.

Use these, in order. Do not add a dashboard until Experiment 1 has a second user.

| Metric | Definition | First threshold | Why |
| --- | --- | --- | --- |
| Completed approver conversations | Script in `06`, with a ledger row | 5 by 2026-11-07 | Nothing else is interpretable before this |
| Pre-spend pain share | Share of those 5 whose painful moment is before the commitment | At least 3 of 5 | Otherwise the product is a bill viewer |
| Priced yes | Buyer names a price or accepts one | At least 2 | Interest without a price is not demand |
| Time to first frozen cap | From workspace open to a stored decision, on a real proposal | Under 30 minutes with the founder present | The loop is already built. If it takes a day, the software is not the pilot |
| Proposals before spend | Proposals whose decision timestamp is earlier than the evidence date | At least 3 in a paid month, and at least half of all proposals | THE-LAW already uses this shape of test. Keep it |
| Changed decision | Buyer states one allow, cap, or refuse they would not have made the same way | At least 1 per paid month | The outcome the product is for |
| Reconciliation completed | A verdict on a cited bill | At least 1 per paid month | A cap with no later bill is a note |
| Month-two ask | Customer requests another month without a new feature | 1 of 1 pilots, or the thesis is unproven | Retention of a single user is still an anecdote, but zero is a kill |
| Founder hours per customer | Setup plus reviews plus rescue | Within 4 × 30 minutes + 2 hours | Above that, the offer is mispriced even if they pay |
| Activation leak | Paid customers who never freeze a cap | Zero tolerated in a two-customer sample | A payment that does not reach the job is a services sale |

Instrumentation already in the repo (`product-events`, funnel script) was not read against production. **UNKNOWN** whether any anonymous `/start` use is counted. Do not turn analytics on in a way that stores receipt text.

## Pricing hypothesis

**Anchor in the product.** ₹14,999 once, for one policy, ten proposals, four reviews, and two founder hours. Terms version `terms-2026-09-01`. Not collectable on the live `/pay` page as of 2026-10-24.

**Anchors outside.** Ramp's public page shows a free per-user entry. Vantage's self-serve ladder, as repeated by a competitor on 14 October 2026, is $30 and $200 per month for limited tracked spend. Zip is a quote, with third-party reports in the tens of thousands of dollars a year. LiteLLM's open-source proxy can be run without a software licence. Indian card products are paid for in FX and float, not in a workflow seat.

**INFERENCE.** ₹14,999 is expensive next to a sheet and a free card dashboard, cheap next to Zip, and in the same band as one or two months of a small FinOps tool if the third-party Vantage prices are right. It is priced as a concierge month, not as self-serve software. That is appropriate for learning and wrong as a silent assumption about next year's price.

**HYPOTHESIS to test, not to publish as a change.** Ask for their number first. If both priced yeses land under ₹5,000, the current offer is the wrong instrument and the gate fails even if the pain is real. If they accept ₹14,999 only because the founder will sit with them, record the sale as services-led. Do not model it as software gross margin.

No price change is authorized by this file.

## Scenarios

Assumptions, shared:

- Price stays ₹14,999 per company per month, one-time, no renewal unless a new purchase is made.
- The founder is unpaid in these tables. His hours are the real cost and are counted separately.
- Software cash cost for one pilot (hosting, database, email) is treated as under ₹2,000 for the month. **UNKNOWN** as an invoice. The repo can run locally with no third-party AI call on the signed-in path. Do not buy a new vendor to learn.
- No market-share percentage is applied to any external forecast.

### Low — current evidence, extended

| | 30 days | 90 days | 365 days |
| --- | ---: | ---: | ---: |
| Paid months | 0 | 0 | 0 |
| Cash collected | ₹0 | ₹0 | ₹0 |
| Founder hours | ~20 on conversations | ~30 including write-up | Stop after the kill |

This is the base case until a ledger row says otherwise. Probability: not assigned. It is the case the scoreboard already describes.

### Base — gate passes, learning works, scale does not

| | 30 days | 90 days | 365 days |
| --- | ---: | ---: | ---: |
| New paid months | 1 | 3 | 8 |
| Of which are the same company buying again | 0 | 1 | 3 |
| Cash | ₹14,999 | ₹44,997 | ₹1,19,992 |
| Founder hours at 6 per paid month | 6 | 18 | 48 |

Arithmetic: 1, 3, and 8 times ₹14,999. Eight paid months in a year is two customers who stay a few months plus a handful of one-offs. It pays for a small amount of hosting and does not pay a salary. It is a successful *learning* year only if the changed-decision metric hit. It is not a company.

### High — the workflow sticks, still without a fantasy share

| | 30 days | 90 days | 365 days |
| --- | ---: | ---: | ---: |
| New paid months | 2 | 8 | 40 |
| Distinct companies | 2 | 6 | 15 |
| Cash | ₹29,998 | ₹1,19,992 | ₹5,99,960 |
| Founder hours if still 6 each | 12 | 48 | 240 |

Forty paid months is 15 companies, some repeating. At 6 founder hours each, 40 months is 240 hours, about six full weeks of support. That is the point at which concierge breaks. The high case is only coherent if most of those months are self-serve, which means founder hours must fall under 1 per month by company number five. **HYPOTHESIS.** Nothing in the product's history shows self-serve activation. If hours do not fall, the high case is a services ceiling, and the honest annual cash is still under ₹6 lakh.

Gross margin on software, if hours are ignored and AI is not called: high, because the cost is a small database. Gross margin on the actual offer, with the founder included at any serious rate, is low or negative. Example: 6 hours at a modest ₹2,000 per hour is ₹12,000 of time against ₹14,999 cash, before tax, payment fees, and a failed pilot's refund. The offer's refund term (full refund if activation misses ten business days, and before work starts) can wipe the cash. **INFERENCE.** Do not describe this as a high-margin SaaS business while the founder is the implementation team.

## Sales cycle and support

For this ICP the cycle should be one or two conversations plus a payment, or it is the wrong buyer. A security questionnaire, a vendor form, or a "loop in procurement" means that company is outside the first market. Politely stop.

Support load is the four reviews. If customers need the founder to parse every invoice, the parser is not ready and the pilot must say so rather than silently absorbing the work.

## Tax and payment operations

`/pay` already says GST is charged only when a GSTIN is on the invoice, and that TDS under section 194J may apply. This review did not verify the tax position with a professional. Do not collect money until the founder accepts the legal and Razorpay setup as a separate decision. The architecture file's data gate is independent of that decision.

## What a good month looks like in one line

One approver froze a cap before a real commitment, a later cited bill received a verdict, and the approver either paid for another month or gave a specific reason they would not. Both results are worth more than another redesign.
