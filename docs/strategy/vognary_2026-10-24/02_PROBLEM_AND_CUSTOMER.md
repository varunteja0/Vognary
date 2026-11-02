# Problem and customer

## Problem, in plain English

An AI product company agrees, often informally, to spend money on a model API, a GPU block, or a cloud account. The agreement lives in a chat message, a founder's memory, or a card limit. The bill arrives later, in a different shape: tokens, a tax line, a second project key, a renewal. Nobody can answer, from one record, who allowed the spend, what it was for, what the ceiling was, and whether the bill kept that promise.

That is the job to test. It is not "AI is expensive," and it is not "founders need a CFO."

## One user, one buyer, one moment

| | Choice for the first test | Label |
| --- | --- | --- |
| User | The person who will be asked to explain the bill. Often the founder. Sometimes a finance owner or a fractional bookkeeper | HYPOTHESIS |
| Economic buyer | The same person, if they can pay ₹14,999 without a committee. At 20 people that is usually the founder. A separate finance title is not assumed | HYPOTHESIS |
| Company | India-operating product company, about 15–80 people, shipping with paid model APIs or cloud, no FinOps hire, no US entity required to operate | HYPOTHESIS. The canonical ICP in THE-LAW is 20–100. This band is the reachable slice of that ICP |
| Trigger | A specific bill or renewal in the next 30 days that is larger than the last one, or a new annual or reserved commitment someone is about to sign | HYPOTHESIS |
| Decision | Allow, cap, or refuse that commitment, and write the reason down before the invoice | The product action |
| Proof the job happened | A frozen cap exists before the bill, and a later line says matched, within cap, or over cap, and the buyer says that comparison changed what they did next | Acceptance, not yet observed |

Companies already on Ramp, Brex, Zip, or a staffed FinOps team are out of the first ten. They have a closer tool. India-only companies are in, because the US card platforms are a poor default for them (see the competitive file). A company whose entire "AI spend" is two ₹2,000 seats is out. The commitment has to be large enough that being wrong hurts. The rupee threshold is unknown until interviews name it. Do not invent one.

## Current workflow, as far as public evidence can see

**FACT, product behaviour of substitutes, not of a named Vognary customer.** A small company today can:

1. Put the vendor on a founder card or an India corporate or prepaid card (RazorpayX, EnKash, Kodo, Volopay, Xflow, a bank card).
2. Let engineering hold the provider key. LiteLLM and similar gateways can refuse a request when a key or team budget is exhausted. That is a technical ceiling, not a business approval.
3. See the damage in the provider invoice, AWS Cost Explorer, or a Zoho Books bill.
4. Approve expenses after the fact in Zoho Expense or a sheet.
5. Discuss renewals in WhatsApp or email. The approval is not tied to the later invoice inside one system.

**UNKNOWN.** How often step 5 fails badly enough, in this exact segment, that someone will pay. Vognary has not recorded a single conversation that answers it.

## Why the failure can be costly

| Evidence | What it establishes | What it does not | Source | Kind | Confidence |
| --- | --- | --- | --- | --- | --- |
| 98% of FinOps survey respondents now manage AI spend, up from 31% two years earlier. Top challenges include visibility, allocation, and value. Pre-deployment architecture costing is a top requested tool capability | Practitioners who already do FinOps say AI cost is now normal work, and they want cost information earlier than the bill | That a 30-person Indian startup has a FinOps practice, a budget for a new tool, or the same pain. The report's size chart labels SMB as under 1,000 employees. 47% of responses are large enterprise | [State of FinOps 2026](https://data.finops.org/), page inspected 2026-10-24. Chart bases on that page include N=693 for the AI-spend figure and N=685 for priorities | Primary survey of practitioners | High for the practitioner population. Low as a proxy for the ICP |
| Gartner forecasts worldwide AI spending of $2.7 trillion in 2026. AI infrastructure is $1.48 trillion of that. Generative AI models are $28.3 billion. Gartner also says enterprises want providers to help manage costs and embed usage tracking | Spend is large and growing, and cost management is something buyers ask incumbent providers for | Any number of companies that would buy a commitment ledger. Most of the $2.7 trillion is infrastructure bought by hyperscalers and vendors, not software seats at 20-person firms | [Gartner press release, 16 September 2026](https://www.gartner.com/en/newsroom/press-releases/2026-09-16-gartner-forecasts-worldwide-ai-spending-to-grow-49-point-5-percent-in-2026), page inspected 2026-10-24 | Analyst forecast | High that Gartner published it. Low as an addressable market |
| CloudZero's own articles say 87% of senior finance leaders are raising FY2027 AI budgets and 61% cannot justify current spend; 44% approved spend without reliable projections | A vendor is selling "cap with context" into budget season | Independent confirmation. Sample, geography, and company size were not in the extract reviewed | CloudZero blog posts dated 13–22 October 2026, including [Capping the AI free-for-all](https://www.cloudzero.com/blog/capping-ai-spend/). Search extract, not the underlying survey microdata | Vendor marketing | Low until the survey instrument is read |
| Ramp says AI is among the fastest-growing and least measurable expenses, and sells token spend management, procurement approvals, and agent cards with budgets | A well-funded spend platform believes the measurement gap is large enough to build for | That the gap remains open for Indian companies Ramp does not serve, or that those companies want a ledger instead of a card | Payments Dive, 4 September 2026, quoting Ramp's CTO; TechCrunch, 15 October 2026. Ramp pricing page extract, 2026-10-24 | Press plus vendor | Medium for "Ramp is building this." Low for "therefore Vognary's buyer is in pain" |

**INFERENCE.** The expensive version of the problem is real in organisations that already have FinOps staff and large AI bills. The version Vognary can reach is a milder, more manual cousin: a founder staring at an OpenAI or AWS invoice that does not match what they remember allowing. Frequency and rupee loss for that cousin are hypotheses.

## Consequence of doing nothing, for the test customer

If the hypothesis is true, the consequence is one of:

- A bill that overshoots a number someone thought they had agreed.
- A renewal that starts because nobody owned the end date.
- An engineering key that keeps spending after the business reason ended.
- A founder who cannot tell an investor or a co-founder what the last "yes" included.

**UNKNOWN** which of those four is the one people will pay to avoid. The interviews exist to force a ranking. If the answer is "forex markup on a rupee card" or "I need the invoice in Zoho," this product is the wrong tool.

## Budget ownership

**FACT.** The live offer asks for ₹14,999 once, from a named finance owner, and does not renew itself.

**INFERENCE.** At 15–80 people the founder can approve that without procurement. That is a distribution advantage and a ceiling. It also means the buyer is comparing Vognary with a spreadsheet and a Saturday afternoon, not with Zip's enterprise quote.

**HYPOTHESIS.** The buyer will pay for a month of records only if the next bill is already uncomfortable. Curiosity will not clear ₹14,999. The current offer bundles founder hours (four 30-minute reviews plus two hours). Buyers may be paying for the founder's time, not for software. The interview has to separate those.

## What still needs a direct conversation

1. Does the painful moment happen before the commitment, or only when the invoice is confusing?
2. What is the last AI or cloud bill, in a range, and what did they wish they had decided earlier?
3. What did they already try (sheet, card limit, gateway budget, Zoho, doing nothing)?
4. Who else must agree before they pay?
5. Would a record that cannot decline the provider's API still be worth paying for?
6. Is ₹14,999 a yes, a no, or a different number?
7. Will they do it again next month without the founder in the room?

Until those are answered by people who are not the founder of Vognary, every sentence about urgency is a hypothesis. Founder experience of managing his own tool bills is a lead, not proof. It is also a bias: he feels the problem, so he will over-hear it in other people unless the script forbids leading questions.
