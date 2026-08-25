# Market signal bank — recurring software money (evidence-first)

> **Operating motto: Take smart risks. Do not play safe.** Seek asymmetric,
> falsifiable opportunities without promoting hypotheses into facts. Full
> doctrine: [`THE-LAW.md`](../THE-LAW.md).

> Parent law: [`docs/THE-LAW.md`](../THE-LAW.md). Built 2026-08-22 from public web research.
> Every entry is labeled FACT (observable in the linked source), INFERENCE (our reasoning), or HYPOTHESIS (untested belief).
> Never promote an inference into copy as if it were a fact. Vendor blogs are marketing — lowest confidence tier.

## A. Signal entries

| # | Source / date | Class | Observable problem (FACT unless noted) | Trigger | Vognary relevance | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | r/Entrepreneur, ~Apr 2026 ([thread](https://www.reddit.com/r/Entrepreneur/comments/1s5i577/)) | Public behavior statement | 12-person company ran an annual software audit: 23 subscriptions, $4,100/mo (~$50k/yr), "the number genuinely startled me"; tools don't talk to each other so they added middleware | Annual audit moment | Exact ICP shape (12 ppl, no finance ops). Trigger = periodic audit, not monthly habit | HIGH (first-person, specific numbers) |
| A2 | X @pvbuilds Prashanth Vaidya, Aug 2026 ([post](https://x.com/pvbuilds/status/2090155802158084243)) | Live conversation | Posted Claude Max at ₹24k after Indian localisation; told founder he is sticking to Claude + Codex | Price hike on renewal (localisation repricing) | Live ICP conversation #1; linger question unanswered. AI-subscription switching is real in India | HIGHEST (direct reply) |
| A3 | wellstsai.com review, 2026-08-15 ([post](https://wellstsai.com/en/post/ai-subscription-shakeout-2026-claude)) | Public behavior statement | Copilot moved to token-based AI Credits → "team pool drained in a week" → switched heavy work to Claude Code; Perplexity quotas cut quietly; pattern: "everyone moved from hooking you with low pricing to quietly charging you real cost" | Quota/pricing change mid-cycle | Validates what-changed detection on AI tools; price/quota changes are the moment users re-evaluate stacks | MEDIUM-HIGH |
| A4 | pandev-metrics.com, May 2026 ([study](https://pandev-metrics.com/docs/blog/claude-vs-chatgpt-vs-copilot-2026)) | Vendor-tracked data | Of 112 engineers tracked, 61% used two AI coding tools daily; Claude Code real cost often 2–4× per-seat estimate for teams >10 | Tool proliferation | Overlap families (Cursor↔Claude↔Copilot) already modeled by the engine | MEDIUM (vendor methodology unknown) |
| A5 | StackTrim AI landing, 2026 ([site](https://stacktrim.ai/)) | Competitor fact | A product now markets "audits your stack, exposes redundant subscriptions, calculates savings from switching to API" across 107 AI tools | AI-subscription fatigue | Direct overlap with the overlap-detection wedge; also validates demand | FACT (product exists); savings claims UNVERIFIED |
| A6 | hiddenbill.com, 2026 ([blog](https://hiddenbill.com/blog/find-forgotten-saas-subscriptions/)) | Competitor fact | Product positions on finding forgotten SaaS subscriptions from email | Forgotten-renewal moment | Closest methodological neighbor (email as evidence source); consumer-ish positioning | FACT (positioning); traction UNKNOWN |
| A7 | saastweaks.com guide citing Zylo/BetterCloud 2026 ([post](https://saastweaks.com/blog/real-cost-saas-stack-2026)) | Secondary stat | Claims $7,900 SaaS spend/employee/yr (+27% in 2y), 371 apps/org avg, 30% of spend wasted, "audit of your credit card typically surfaces 3–5 zombie tools in an afternoon" | Audit season | Useful framing stats; numbers are third-party marketing aggregates | LOW-MEDIUM (unverified chain) |
| A8 | trackallsubs.com guide, 2026-08-18 ([post](https://trackallsubs.com/blog/saas-subscription-tracking)) | Vendor essay | "Most teams pay for software twice — once when someone signs up, and again when nobody notices the renewal." Card-owner problem: signer ≠ reviewer | Renewal surprise | Names the structural cause (oversight-proof design of small charges) | MEDIUM (marketing, but structurally coherent) |
| A9 | r/SaaS, ~Aug 2026 ([thread](https://www.reddit.com/r/SaaS/comments/1uxseg0/)) | Public behavior statement | Shopify owner says he cancelled $100+/mo app pile and rebuilt internally with AI ("zero coding experience"). **UNVERIFIED BY DIRECT FETCH** — thread did not resolve on fetch 2026-08-22; evidence is a search-result excerpt only. Do not cite in copy or outreach until re-verified. | App-cost creep | Counter-signal hypothesis: some ICP members respond to spend pain by *building*, not tracking. Qualification question needed | LOW (excerpt-only) |
| A10 | Innovatrix Infotech blog, Rishabh Sethia, 1 Oct 2025, updated 14 Aug 2026 ([live URL](https://www.innovatrixinfotech.com/blog/solo-founder-ai-agency-tech-stack-tools-2026)) | Public itemized disclosure | Founder of a **12-person Kolkata dev agency** (marketing run solo — he is not a solo founder) publishes his complete recurring tool stack with per-tool INR prices: Claude Pro ₹1,700 + GPT-4o ₹1,700 + Perplexity ₹1,700 + Cursor ₹1,700 + Copilot ₹850 + Vercel ₹1,700 + Zapier ₹1,700 (legacy) + WhatsApp API ~₹3,500 + n8n/Directus VPS ₹800×2 + ClickUp ₹600 = **~₹16,750/month (~₹2 lakh/year)**, vs a quoted ₹1.2–1.9 lakh/month marketing team. The post also contains the line "under ₹30,000/month… runs 24/7", which contradicts its own table. | Hiring-vs-tools decision | India ICP magnitude confirmation with an actual itemized multi-vendor recurring stack; note he pays for overlapping AI tools simultaneously (Claude+GPT+Perplexity, Cursor+Copilot) | HIGH for stack contents (itemized, named author); MEDIUM for self-reported totals |

## B. Clustered themes (with counts)

1. **Renewal/forgotten-charge surprise** — A1, A7, A8, plus entire vendor ecosystems (StackBill, TrackAllSubs, Termedora, ClauseWarn, Binadox chargeback data). Recurring behavioral line: audits happen *after* pain, once or yearly, not continuously.
2. **AI-subscription churn & stacking** — A2, A3, A4, A5. Pricing/quota changes are the trigger; users hold 2–3 overlapping subs during transition.
3. **Aggregate-blindness** — A1, A7, A8. Founders can name individual bills but not their total or next-7-day exposure.
4. **Alternatives people actually use** (Phase U input): memory + card statements (A1, A7), spreadsheets (A8), email search for "subscription/renewal/invoice" (Beancount guide), consumer trackers (Rocket Money-style), new niche trackers (A5, A6).

## C. Customer-language extraction (usable phrasing only from first-person sources)

From A1/A3 (paraphrase-safe fragments; A9 excluded until re-verified): "annual software audit", "the number startled me", "paying for 23 subscriptions", "tools don't talk to each other", "quietly charging you real cost", "nobody notices the renewal".

Do NOT use vendor-blog coinages ("zombie spend", "SaaS sprawl") in customer-facing copy until a customer says them.

## D. Implications (INFERENCE — each needs product/customer validation)

1. The audit moment (yearly/quarterly) is when founders feel the pain; Vognary's bet is that continuous evidence beats annual audit. First-session flow ("add 2–5 bills, see decisions") mirrors the audit they already run — this matches how they already behave. (Supports current onboarding design.)
2. AI-tool price/quota changes are frequent, emotional triggers in 2026 — the engine's PRICE_INCREASE/change detection should lead first-session demos for this ICP.
3. Objection to pre-empt (Phase V): "I can just check my card statement" — answer per A1/A7: statements show history, not commitments, not next-week exposure, not which of two overlapping AI tools is redundant. Must be demonstrated in-product, not just argued.
4. Watch A5/A6 as competitor motion; differentiate on cited receipts + decision memory + India-first rails, not feature parity.

## E. Gaps in this bank

- No consented customer interview evidence yet (n=0). Highest-priority addition.
- No quantified frequency data from first-person sources beyond A1/A4.
- India-specific first-person complaints thin in this sweep; Prashanth thread is the strongest India datum. Next sweep should target Indian founder communities directly.
