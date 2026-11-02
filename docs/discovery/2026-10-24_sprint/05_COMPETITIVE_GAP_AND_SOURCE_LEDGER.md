# Competitive gap and source ledger

**Conclusion: hypothesis narrows. Demand is not validated.**

The wide claim "small product companies have no way to control AI spend" does not survive the documents opened on 2026-10-24. Providers, gateways, FinOps products, and cards already alert or hard-stop spend. What remains untested is narrower: a named person, at an India-operating company of about 15–80 people, wants a cross-vendor record of *purpose and cap* before a material AI, API, or cloud commitment, and will pay ₹14,999 for a month of that record even though it cannot stop the provider. No conversation has tested that sentence.

## Problem statement

Before a material AI, API, or cloud bill is agreed, a named person records what it is for and the most it may cost. When the bill arrives, the record shows whether the bill kept that promise. The record does not decline the card or the API.

## Evidence the broad problem exists

| Claim | Source inspected | Date | Kind | Establishes | Does not establish |
| --- | --- | --- | --- | --- | --- |
| FinOps for AI is the top forward-looking priority; 98% of respondents manage AI spend; pre-deployment costing is a top tool request | [State of FinOps 2026](https://data.finops.org/) | Page read 2026-10-24. Survey is the 2026 edition | Survey of FinOps practitioners. SMB on that page means under 1,000 employees | Practitioners who already do this work want earlier cost information | That a 30-person Indian company has the pain or a budget |
| Worldwide AI spending forecast $2.7 trillion in 2026, infrastructure $1.48 trillion, generative models $28.3 billion | [Gartner press release](https://www.gartner.com/en/newsroom/press-releases/2026-09-16-gartner-forecasts-worldwide-ai-spending-to-grow-49-point-5-percent-in-2026) | 16 September 2026, page modified 22 October 2026 | Analyst forecast | A large spending category exists | Any count of buyers for a ledger. Not a TAM |
| Harness marketing: two in three organisations spend more than $250,000 a month on AI; 73% have a policy; 47% enforce it | [Harness ebook page](https://www.harness.io/resources/autonomy-you-control-a-practical-guide-to-ai-cost-governance) | 22 October 2026 | Vendor claim. Sample not opened | Harness is selling the policy-versus-enforcement gap to large spenders | The 15–80 person segment. The $250,000 figure is not this ICP |

**Reachable market: unknown.** No credible count of India-operating product companies of 15–80 people with a material model bill was found. Multiplying a startup census by ₹14,999 would be a fiction. It is not done here.

## Segment pain, still a hypothesis

**HYPOTHESIS.** The approver at a 15–80 person India-operating product company agrees an OpenAI, Anthropic, AWS, or GPU commitment in chat or on a card, then cannot show, later, what the yes included. The trigger "a renewal in the next 30 days that is larger than they remember allowing" was not found as a measured behaviour. It is a prompt for the interview, not a finding.

## What the tools actually do

Operational words: **hard block** (the call or the resource is refused), **alert** (someone is told, spend continues), **report** (after the fact), **approval** (a person must say yes before a request proceeds), **record** (purpose, owner, cap, later match), **invoice match**, **outcome** (business result, not the bill).

| Product | What was inspected | Class | Operation |
| --- | --- | --- | --- |
| LiteLLM | [Budgets, rate limits](https://docs.litellm.ai/docs/proxy/users), extract dated 2026-10-24 | Verified live docs | Hard block. Team, member, key, and project `max_budget` reject the request. A July 2026 release note shows a bad budget check locked users out. No business purpose. No vendor tax invoice |
| Harness user budgets | [Manage your AI budget](https://developer.harness.io/cloud-cost-management/cost-governance/user-budgets/manage-your-ai-budget), 22 October 2026; [overview](https://developer.harness.io/cloud-cost-management/cost-governance/user-budgets/user-budgets), 6 October 2026 | Verified live docs. Feature is Limited GA and needs enablement | Per-user cap, notify, and optional **block**. Increase request carries a reason and routes to an approver. Separate cloud budgets are alerts on ingested cost, and the AI cost page says alerts fire on ingested data, often hours later, not on the live call |
| Harness marketing "AI Budgets" | [Introducing AI Budgets](https://www.harness.io/blog/introducing-ai-budgets), 20 October 2026 | Vendor claim | Says a policy becomes a watched limit and an audit trail. Treat the docs above as the capability, the blog as the pitch |
| CloudZero | Blog extracts from 22–23 October 2026 and 28 September 2026, not the full product UI | Vendor claim | Estimated AI spend by team and model; reconciled cost on the billing cycle; a job-budget estimator for agent work. Not shown as a frozen business cap matched to a GST invoice |
| Ramp | [Pricing](https://ramp.com/pricing) extract 2026-10-24 shows a $0 per-user plan with cards and AP approvals. [TechCrunch, 15 October 2026](https://techcrunch.com/2026/10/15/ramp-reaches-60b-valuation-as-it-pushes-deeper-into-ai/) reports company claims of token spend, agent cards, 85,000 customers | Vendor plus press | Hard block at the card. Approval flows for purchases. Token view is a report plus controls when the spend is on Ramp. A rival, [Xflow, 29 September 2026](https://www.xflowpay.com/blog/best-corporate-cards-for-startups-in-india), says Ramp wants a US entity. That eligibility line is a competitor's claim, not Ramp's policy page |
| Zip | [zip.com/compare](https://zip.com/compare) extract | Vendor claim | Approval before purchase for companies that force intake through Zip. Quote-only. Not a 15-person tool on the evidence opened |
| OpenAI API | [Managing projects](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform) and [429 troubleshooting](https://help.openai.com/en/articles/5955604-troubleshooting-api-rate-limits-and-429-errors), help center, "updated" recently as of the fetch on 2026-10-24 | Verified live help | Monthly spend limit can be alert-only. **Enforce a hard limit** makes requests fail with `organization_spend_limit_exceeded` or `project_spend_limit_exceeded`. Enforcement can lag, so spend can slightly exceed the cap. Prepaid balance exhaustion is also a hard stop. No purpose field. No link to the company's other vendors |
| AWS Budgets | [Managing costs](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html), fetched 2026-10-24 | Verified live docs | Default is alert. Optional budget actions can apply an IAM or SCP deny, or stop certain instances, automatically or after approval. Data updates up to three times a day. AWS states you can incur more cost before the alert. Not a purpose record. Not an OpenAI invoice |
| India cards (Xflow, EnKash, Kodo, RazorpayX, Volopay) | Xflow comparison, 29 September 2026 | Vendor claim, one page describing rivals | Prepaid balance or credit limit is a hard block at swipe. Merchant locks exist on some products. No purpose-to-invoice object was documented on that page |
| Zoho Expense / Books | Not re-opened on Zoho's own site this sprint | Unknown for a pre-spend AI cap | Vognary already has a local Zoho bill snapshot path. That is evidence ingest, not enforcement |
| Vognary | Source at `3604496` and the public site read 2026-10-24 | Verified in repo. Unused by any recorded customer | Record, human approval, later invoice match, user-typed outcome. Explicitly not a hard block |

Azure budgets and Google Cloud budget alerts were **not** opened this sprint. Do not describe them as absent. **UNKNOWN** whether either offers a purpose field. Both are expected, from general product knowledge, to be alerts first. That expectation is not a citation. The interview should ask what the buyer actually turned on.

Anthropic's console limits were **not** opened this sprint. **UNKNOWN.** Ask the buyer.

## Pricing that is public enough to cite

| Offer | Price | Source | Limit of the evidence |
| --- | --- | --- | --- |
| Vognary pilot | ₹14,999 once, one month, ten proposals, four reviews, two extra hours | `src/lib/pilot-offer.ts` and live `/pay` copy | Not collected online. Not a proven willingness to pay |
| Ramp free plan | $0 per user on the pricing page extract | [ramp.com/pricing](https://ramp.com/pricing), 2026-10-24 | Plus dollar price was not in the extract. Secondary pages say $15. Do not treat $15 as Ramp's page |
| LiteLLM core | Software licence $0 if self-hosted. Enterprise features are paid | Docs above | Operating cost is the founder's time, not a list price |
| Harness, CloudZero, Zip | No list price opened that applies to a 30-person company | — | Unknown. Do not invent a quote |
| ChatGPT Business seats | Third-party page cited $20 and $100 per seat from an OpenAI help/pricing read on 14 October 2026 | [colombani.ai summary](https://colombani.ai/en/blog/chatgpt-business-for-companies/) | Confirm on OpenAI's own price page before quoting it in a call. Not required for the script |

## Argument for the narrowed idea

A company that will not run LiteLLM, will not turn on an OpenAI hard limit, and cannot get Ramp, still has no single place that stores why the commitment existed. Harness is the closest product to "cap plus a reason plus an approver," and its user-budget feature is Limited GA inside a FinOps platform aimed at teams that already connect providers. That is a poor fit for a founder who will not connect a billing account. The record could still be the job if the interview shows they refuse those tools and still lose money.

## Argument against, the one the calls must test

The useful control is the hard stop, and it is already available at $0 in the provider or in an open-source proxy. A spreadsheet holds the purpose. A ₹14,999 ledger that cannot stop the call asks the buyer to pay for a memory they can keep themselves. If two approvers say that in their own words, the hypothesis fails even if they are polite about the demo.

## Falsifiers

- Three approvers already have a record, in a sheet or a provider screen, of purpose, person, cap, and the later amount, and they will not pay to move it.
- The pain they describe is forex, GST, or "what is this line," which is after the bill.
- They will continue only if Vognary declines the API or the card.
- Zero of five will discuss a price.

## Source ledger

Every URL in the tables above was opened or returned as a full extract by the research tools on 2026-10-24, except where the row says "extract" or "not opened." CloudZero and Ramp token features remain vendor or press, not a clicked-through product trial.
