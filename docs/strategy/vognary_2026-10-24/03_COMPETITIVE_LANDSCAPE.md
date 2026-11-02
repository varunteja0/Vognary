# Competitive landscape — sources inspected 2026-10-24

Labels used in the matrix:

- **Live** — official docs or pricing page inspected, or a behaviour this review fetched.
- **Vendor** — the company's own marketing or blog. Not independently measured.
- **Press** — a news article quoting the company. The number is still the company's claim unless the article measured it.
- **Survey** — a named study. Generalises only to its respondents.
- **Third party** — a comparison site or a competitor describing someone else.
- **Unknown** — not found in the pages opened. Absence from this file is not absence from the product.

No private-company revenue is stated unless a filing or the company itself published it. Ramp's valuation and volume below are the company's claims as reported by TechCrunch, not audited revenue.

## The job, split into capabilities

A buyer can already assemble "see the cost," "cap the card," "cap the API key," and "approve a purchase request" from other products. Vognary's proposed gap is the join: a business commitment written *before* spend, with purpose and owner, later matched to a bill, without becoming the card, the gateway, or the ERP.

The strongest argument against that gap: the join is a screen an incumbent adds once a customer asks, and for a small company a row in a sheet plus the provider invoice is enough. Vognary does not sit on the request path, so it cannot make the overrun impossible. It can only make the overrun legible.

## Capability matrix

Status words are the best label this review could support. "Vendor" means claimed, not tested.

| Capability | Vognary today | CloudZero | Vantage / Finout | Ramp | Zip | LiteLLM | India cards (Xflow, EnKash, Kodo, RazorpayX, Volopay) | Zoho Expense / Books | SaaS renewal tools (Zylo, Torii, Cledara class) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create a commitment before spend | Live in code and on the marketing site. Not used by a known customer | Vendor: cap with an outcome attached. Not the same object as Vognary's proposal | Vendor: budgets, anomaly alerts. Commitment usually means a cloud Savings Plan, not a business purpose | Vendor: procurement request, spend program, agent budget before a card charge | Vendor: intake request and approval before purchase | Live docs: team, key, project `max_budget` before the API call. No business purpose or invoice match | Vendor: card limits and merchant locks before the charge. No purpose record required | Third party: multi-level approval of expenses, which is usually after or at claim time | Vendor: renewal calendar and owner alerts. The commitment is the contract already signed |
| Human approval | Live. Policy cannot approve | Vendor, exception requests | Unknown as a frozen business cap | Vendor, including thresholds and agent approval chains | Vendor, core product | Docs: an admin sets the budget. The gateway then refuses. That is a control, not an approval of a purpose | Vendor: a person sets the limit. The card then declines | Third party: approval workflows | Vendor: renewal owners, not a pre-spend cap |
| Hard enforcement | Explicitly none. A cap is a record | Vendor: limits exist; the blog argues context matters more than a blind cap | Vantage Autopilot can buy AWS Savings Plans. That is enforcement of a cloud commitment, fee claimed at 5% of savings | Vendor: card and merchant locks. Procurement for larger contracts | Vendor: the workflow is the gate for companies that force requests through it | Live docs: over-budget requests return a budget error | Vendor: prepaid balance or credit limit and MCC locks | Unknown for an API key. Strong for an expense report | Weak. They remind; they do not decline the vendor |
| Cost and usage attribution | Only if a person links a receipt or a provider bill | Vendor: AI Explorer groups estimated spend by model, team, activity. Reconciled cost waits for the billing cycle | Vendor: both ingest OpenAI, Anthropic, Cursor and cloud bills | Vendor: token spend in one place, tied to the card when the card is theirs | Not a usage meter | Live docs: spend per key, team, user, project | Vendor: spend per card. Not per model or purpose | Books holds the bill. It does not know the prompt | Usage is seat usage, not tokens |
| Invoice linkage | Live in code: reconciliation to Recovery evidence or an admitted provider bill | Vendor: billing-cycle reconciliation in Explorer | Vendor: billing ingest | Vendor: receipts and AP invoices on the same ledger as the card | Vendor: PO and invoice match for customers on the suite | No. The gateway sees requests, not the provider's tax invoice | The card charge is the record. A separate tax invoice may still arrive | Native, if the company already uses Zoho | Contract and invoice metadata. Vendor for Zylo Contract Assist |
| Variance versus what was approved | Live: matched, within cap, over cap, expired, currency mismatch | Vendor: budgets versus actual, plus ROI narrative | Vendor: anomaly and budget alerts | Vendor: budget alerts and policy flags | Vendor: approval versus later PO | Docs: spend versus `max_budget`. No "this invoice exceeded the business reason" | Limit versus swipe | Expense over policy. Not a pre-commitment | Renewal price versus last contract. Vendor |
| Outcome attribution | Live and deliberately weak: user-typed observation, labeled unverified | Vendor: "what the dollar returned." Method not independently checked | Unit cost is the claim. Business outcome is not | Not established in the pages read | Not established | Not the product | Not the product | Not the product | Not the product |
| Autonomous action | Refused by product rule. Autopilot code exists and defaults off | Vendor agents and recommendations. Not inspected end to end | Vendor: Finout agents into Jira/Slack; Vantage waste automation | Press and vendor: procurement agents, routing, agent cards | Vendor: superagents draft; a person still sends in the descriptions read | The gateway blocks automatically once a number is set. That is the point | Card decline is automatic | Unknown | Some cleanup actions in enterprise tiers. Not inspected |
| Who it is for | Stated: India, 20–100 people, AI-native. Unsold | Mid-market and enterprise cloud and AI spend. Price on request | Vantage self-serve from a free tier; Finout is a committed-spend fee. Both are FinOps teams | US-centric card and finance platform. Company claims 85,000 customers | Procurement teams that will sit through a quote. One public pilot price is enterprise-shaped | Platform engineers who will run a proxy | Indian startups paying SaaS on cards | Indian and global SMBs already on Zoho | Mid-market and enterprise SaaS estates. Public SMB prices exist and are still a different job |
| Price signal | ₹14,999 once, not collectable on the live site | Custom. A third-party page said "pricing on request" as of September 2026 | Third party (Finout's comparison, 14 October 2026): Vantage free to $2,500 tracked, Pro $30, Business $200. Treat as rival marketing until Vantage's own page is re-read | Ramp's own pricing page shows a $0 per-user free plan. Secondary pages say Plus is $15 per user plus an unpublished platform fee | Quote. A third-party review cites an AWS Marketplace pilot at $75,000 for 12 months and 100 users. Not re-fetched from AWS | Open-source core. Enterprise licence for SSO and some admin features. Software cost can be zero; operations cost is not | Card economics, not a SaaS seat. FX and rewards matter more than a subscription | A comparison site said Zoho Expense starts at $4 per user. Not confirmed on Zoho's own page in this review | Often quote-only. One renewal-tool roundup said Tropic lists $3,083 per month. Vendor page of Tropic, not re-opened |

## Notes on each camp

### FinOps and AI unit economics

**FACT.** The FinOps Foundation's 2026 report, inspected at [data.finops.org](https://data.finops.org/), says FinOps for AI is the top forward-looking priority, 98% of respondents manage AI spend, and practitioners want granular AI monitoring and pre-deployment costing. The same page says workload optimisation is still the top *current* priority. Respondents are FinOps practitioners. A fifth are in organisations under 1,000 people. This is not a startup sample.

**Vendor.** [CloudZero, 22 October 2026](https://www.cloudzero.com/blog/capping-ai-spend/) argues that a hard cap without an outcome creates exception theatre, and that CloudZero connects spend to team, person, and result. [CloudZero, 23 October 2026](https://www.cloudzero.com/blog/shipped-slice-ai-spend-in-ai-explorer/) describes AI Explorer as estimated token spend, with reconciled figures landing on the billing cycle. [CloudZero, 28 September 2026](https://www.cloudzero.com/blog/shipped-model-rightsizer-token-budgets/) describes a model that proposes a job budget before agent work runs. That is close to "cost before the work," and it is theirs.

**Vendor, rival blog.** [Finout, 14 October 2026](https://www.finout.io/blog/finout-vs-vantage-which-platform-is-right-for-your-team) describes both products as ingesting OpenAI, Anthropic, and Cursor, and publishes a Vantage price ladder. Use the capabilities. Do not treat Finout's prices for Vantage as audited.

**INFERENCE.** A company with an engineer who will connect a billing account does not need Vognary to *see* AI spend. Vognary is only interesting if they will not connect a billing account and still want a decision record. That is a smaller market than "AI FinOps."

### Procurement and cards

**Press.** [TechCrunch, 15 October 2026](https://techcrunch.com/2026/10/15/ramp-reaches-60b-valuation-as-it-pushes-deeper-into-ai/) reports Ramp's claim of a $60 billion valuation, $1.85 billion raised in that round, more than $275 billion annualised purchase volume, and 85,000 customers, plus token spend management and a card for agents. [Payments Dive, 4 September 2026](https://www.paymentsdive.com/news/ramp-takes-on-ai-expense/829642/) reports the August Router release. [Ramp's pricing page](https://ramp.com/pricing), extracted 2026-10-24, shows a free per-user plan with cards, expense, and approval-capable AP. The Plus dollar price was not in that extract; secondary write-ups say $15 per user. Mark the $15 as third-party.

**Vendor, competitor.** [Xflow, 29 September 2026](https://www.xflowpay.com/blog/best-corporate-cards-for-startups-in-india) says Brex, Ramp, and Rho require a US entity and a US EIN, and that Ramp also wants a US address and at least $25,000 in a linked US bank account. This is a rival's eligibility claim, not Ramp's policy page. Confidence: medium. It is specific enough to treat Ramp as *not* the default incumbent for an India-only private limited company, until Ramp's own eligibility page says otherwise.

**Vendor.** The same Xflow page describes EnKash merchant-locked SaaS cards and renewal limits, Kodo per-card limits, RazorpayX credit limits and alerts, and Volopay cards that sync to Zoho Books, Tally, Xero, NetSuite, and QuickBooks. Those products already give an Indian startup a hard ceiling at swipe time. They do not record "this cap was for the customer launch, and the September invoice exceeded it."

**Vendor.** [Zip's comparison page](https://zip.com/compare), extracted 2026-10-24, claims Zip is on the 2026 Gartner Magic Quadrant for source-to-pay and that Ramp added procurement in January 2024. Zip's price is quote-only. A September 2026 review at auditfriendly.co cites an AWS Marketplace pilot of $75,000 and a Vendr median near $88,000. Those figures are third-party. They are enough to say Zip is not how a 30-person company buys a tool next week.

**INFERENCE.** Against Ramp and Zip, Vognary is not "better procurement." Against Indian cards, Vognary is not "better control at the moment of payment." The open question is whether the missing business record is painful after the card has already done its job.

### Gateways

**Live docs.** [LiteLLM budgets](https://docs.litellm.ai/docs/proxy/users), page dates in the extract include 2026-10-24, document personal, team, team-member, key, and project budgets that reject calls when spend exceeds `max_budget`. A July 2026 release note shows this enforcement is real enough to lock users out of an admin UI when mis-applied. Enterprise features (SSO, richer audit) are paid. The open-source proxy is a credible substitute for *technical* commitment control, operated by the company itself.

**Third party, conflicting.** Write-ups in 2026 disagree on Helicone and Langfuse prices and on whether Cloudflare's gateway has a hard dollar cap. Portkey's Production plan is repeatedly described at $49 per month, and a May 2026 acquisition by Palo Alto Networks is repeated across secondary pages. This review did not open those pricing pages in full. Do not hang the strategy on those dollar amounts. The qualitative fact is enough: request-time budgets are a populated category, and they do not know the company's purpose or its tax invoice.

### SaaS renewal tools

**Vendor roundups inspected via search, 7–19 October 2026.** Torii, Zylo, Zluri, Spendflo, and Tropic sell renewal calendars, owners, benchmarks, and sometimes negotiation. Public list prices are rare. Cledara and similar card-led tools sit closer to "pay for SaaS on our card." SaveMySaaS-style trackers are cheap or free and do the reminder job.

**INFERENCE.** If interviews say the pain is "we forgot a Notion renewal," Vognary should not build it. That product already exists at a lower price, and Vognary's old Recovery desk is that product. The live site has already walked away from it.

### Founder finance and "AI company OS"

Named examples in the brief (Piveth, CFO.ai, Compyte, FAX, BlankCollar, Runable) were not required to settle the decision, because the broader operating-system shape loses even if those brands are weak. Accounting (Zoho Books, Tally), the bank, and a sheet already hold the cash view. A new system of record for "all commitments in the company" is a migration, which this founder cannot force. No page opened in this review showed a vacant, paid, founder-level capital-allocation category with a distribution path. **UNKNOWN** whether any one of those named brands is a direct feature match. That unknown does not rescue option C.

## Gap worth testing, and the rebuttal

**Gap, as a hypothesis.** For an India-operating company that will not adopt Ramp, will not run LiteLLM, and will not buy CloudZero, there is no system that stores:

1. the purpose and the owner,
2. the maximum exposure a named person froze,
3. the later invoice,
4. the variance,
5. without moving the money.

**Rebuttal, equally serious.**

1. Those companies also do not buy software for record-keeping. They buy software that declines a charge or files GST.
2. CloudZero, Ramp, and the FinOps survey all show the industry moving toward "context before the spend" from the tools that already have the billing feed. A ledger without the feed is the part that is easy to copy and hard to trust.
3. Vognary's own public product has had months to find one payer and has none on the scoreboard. Competitor velocity is not the only problem. Silence from buyers is a problem.

**FALSIFIER.** Three interviews in which the buyer opens their current tool and shows a record that already contains purpose, approver, cap, and the later invoice. If that record is a sheet, ask whether the sheet failed often enough to pay ₹14,999 to replace it. If they will not pay to replace a working sheet, the gap is not a business.

## Addendum — 2026-10-24

A same-day pass opened primary pages that this file had only partly covered. OpenAI documents a hard spend limit. AWS documents budget alerts plus optional actions, with delay. Harness documents per-user AI budgets that can block, in Limited GA. The narrowed verdict and the URL ledger are in `docs/discovery/2026-10-24_sprint/05_COMPETITIVE_GAP_AND_SOURCE_LEDGER.md`. This file is not rewritten. Azure, Google Cloud, and Anthropic console limits were not opened. Do not treat them as missing.
