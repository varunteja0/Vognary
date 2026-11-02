# Discovery Sprint — Interview Scripts & Evidence Scoring Sheet

Scope: **Stage-A P1 (machine-money trust rails) + P2 (counterfeit-reality / money-moment verification). P3 tokenization = watch-list only.**
Rule: **Zero building until Gate 3.** Conversations produce evidence; nothing else does.

---

## 0. Interview principles (print these)

1. **Never pitch before minute 25.** The first 25 minutes are extraction, not selling. Any pitch before that poisons the severity data.
2. **Ask "last time", not "in general".** General answers are marketing; specific incidents are evidence.
3. **Count unprompted words as evidence.** If THEY raise the fear without being asked, that is a severity signal. If you have to drag it out, it is weaker (score lower).
4. **Do not defend the wedge.** When they attack it, write their objection down verbatim. Objections are worth more than praise.
5. **Ask "who do you currently trust and how do you prove it?"** on every call. That single question is the trust-gap detector.
6. **30 minutes hard cap.** Referral ask always closes the call.

---

## 1. The four wedge statements (shown at minute 25+)

| # | Statement (say it, 2 sentences max) | Primary pool |
|---|---|---|
| **WH-1** | "A neutral identity / authorization layer for AI agents acting in money flows — so rails and PSPs can answer *'is this agent authorized, by whom, within what limits?'* — the Indian, UPI-native version of the KYA seat." | P1 |
| **WH-2** | "A money-moment countersign — an independent verification signal a human or an agent must present at the exact moment a large transfer is authorized, so a cloned voice or face alone can never move money." | P2 |
| **WH-3** | "A records-and-standards layer: auditable, immutable decision-records of every authorization an agent (or a suspicious human) made in a money flow, exportable to the bank, the auditor, or the regulator." | P1 |
| **WH-4** | "An evidence-first compliance channel: fraud/AML teams prove what they blocked and what they trusted using shared verified records — the shared evidence layer their dashboards can't produce." | P2 |

Calibrate per persona: show the 2 wedges relevant to them, never all four.

---

## 2. Persona scripts (exact question order)

### Persona A — Rails / PSP / agentic-payments product people
*(Razorpay / Cashfree / PayU / Juspay / NPCI-adjacent / agentic pilot teams. Wedges shown: WH-1, WH-3.)*

1. "What do you personally own day to day?"
2. "Where are agents or automation actually touching your payments flows today — internally or with partners?"
3. "The founding question: **the last time one of those automations did something nobody could fully explain — walk me through it.** What happened, how did you find out, what did it cost you in time or money?"
4. "When an agent (yours, a partner's, a merchant's) initiates or mediates a payment — **who or what verifies it was authorized, by whom, within what limit? How, exactly?**"
5. "How often does the verification fail or need manual patching? Last time?"
6. "What is the cost of getting it wrong — for you personally, and for the company?"
7. *(wedge reactions: WH-1 then WH-3)* "Does this describe a problem you would pay for? What's missing? What's naïve about it?"
8. "If a startup had this — **would you fund it, pilot it, or ignore it?** What's most naïve in these two statements, given how banks and regulators actually work?"
9. "Who else in this ecosystem is angriest about this? **Can you introduce me to two people?**"

### Persona B — Bank fraud & compliance heads
*(Wedges shown: WH-2, WH-4.)*

1. "What's on your desk this quarter? What keeps coming back?"
2. "The founding question: **the last time fraud or a social-engineering attempt reached an authorization decision — walk me through it.** Where did the verification break, where did it hold?"
3. "Voice / synthetic deepfake attempts specifically: **what actually happens when one hits?** How often? What's the cost of a miss?"
4. "Today, what makes your team trust — or refuse — a large transfer? Walk me through the exact steps for ₹50L+."
5. "Where in that chain do you feel **the evidence is not good enough to trust it** — and what do you do about it today?"
6. "What share of your alerts are junk? What does chasing those cost in man-hours?"
7. *(wedge reactions: WH-2 then WH-4)* "Which of these describes a problem you would fight for budget on? What's wrong with either?"
8. "If a startup had it — fund / pilot / ignore? **What would the perfect pilot look like — one branch, one metric?**"
9. "Who else feels this pain — who's the fraud head that needs this most? **Two introductions, please.**"

### Persona C — The human authorizer (treasury / family office / CFO office / wealth manager)
*(Wedges shown: WH-2.)*

1. "What does your signature actually control? What's the largest authorization you've personally signed off this month?"
2. "The founding question: **the last time you had to decide on a transfer/credit request and something felt off — yet the evidence looked fine, or vice versa.** Walk me through it."
3. "Have you caught voice/video/email fraud or a manipulated instruction? What tipped you off? What would you do if it hadn't been tipped off?"
4. "What did you do to verify it, honestly? Was there a defined, provable procedure — or judgment?"
5. "If that call went wrong, who ate it? What's the personal downside for you?"
6. "How often does this happen — per month? What are you doing to survive it?"
7. *(wedge reaction: WH-2 only)* "Does this describe a problem you would pay for out of your own budget? What's missing?"
8. "If it existed — fund / pilot / ignore? **What would make you adopt it tomorrow?**"
9. "Who else authorizes money like this? **Two introductions?**"

### Persona D — Records / audit / compliance-adjacent (WH-3/WH-4 group)
*(Internal-audit leads, RPA/automation directors who deploy agents, insurance & risk auditors, prop-firm operations. Wedges shown: WH-3, WH-4.)*

1. "What processes in your org are now running on automation/agents, and who is accountable for what they do?"
2. "The founding question: **the last time an automation did something and nobody could prove afterwards exactly what it did or why.** Walk me through it."
3. "When an auditor or regulator asks for end-to-end evidence of an automated decision — how do you produce it today? How long does that take?"
4. "How often is that evidence incomplete? What happens then?"
5. "Where would you be personally exposed if it was incomplete and it mattered?"
6. "What's the cost of producing that evidence — **name one number: man-days per month, or budget, or both**?"
7. *(wedge reactions: WH-3 then WH-4)* "Which describes a problem you would fund? What's wrong with them?"
8. "If a startup had it — fund / pilot / ignore? **What's the record format the ecosystem could agree on?**"
9. "Introduction time as in other prompts. **Two names?**"

### Persona E — Finance operations: vendor-payment changes (the Vognary seam)
*(AP managers, controllers, CFOs, treasury of mid-market companies. Wedges shown: WH-2-vendor first, WH-3 second. See also file 04 for the competitive probe step.)*

1. "Walk me through what happens when a supplier says their bank account changed. Who touches it, and how long does it take?"
2. "The founding question: **the last time a vendor bank-detail change was fraudulent — or nearly was.** How did it come in, what tipped you off, what did it cost in money or anxiety or hours?"
3. "What do you run today: penny-drop? callback on a stored number? maker-checker in the ERP? How much time does that add per change, and how many changes do you see a month?"
4. "Honestly — **who authorized the change, and could you prove it afterwards** to an auditor, your bank, or your insurer with something better than an email thread?"
5. "If the callback answered but the voice was a clone, or the mailbox was the supplier's real one — what protects you then?"
6. "Did you ever evaluate Trustpair / Eftsure / PaymentWorks -class tools? What was the price, and what did they NOT answer for you?"
7. *(wedge, WH-2-vendor)* "One independent confirmation of the exact change, captured through the supplier's pre-registered contact, stored as evidence you can hand to an auditor or bank — describe what in this misses the mark for how you actually work?"
8. "Would your company pay for that out of AP/finance-ops budget, or is this a treasury/risk budget? What would a fair price look like — per vendor, per change, per month?"
9. "Fund / pilot / ignore: **would you define a pilot on 25 of your real suppliers so we could judge it against your callback process?**"
10. "Who is the most fraud-worn finance leader you know? **Two introductions, please.**"

### Insider variants (founders/PMs of Skyfire / nekuda / Basis Theory-class companies)
*(Wedges shown: WH-1. Purpose: map the landscape, not evaluate the wedges.)*

1. "Where is the agent-identity market in 12 months? What does the consolidation look like?"
2. "Why has KYA penetration so far been banks/platforms but not rails? What's blocking?"
3. "Does an Indian, UPI-native lane have product surface a global player won't just absorb? What would beat absorption?"
4. "What would make a PSP actually switch, rather than bolt on?"
5. **Two introductions** to fraud-side or rails-side people who feel this pain most.

---

## 3. Scoring rubric (0–3 each, on every conversation)

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Severe** (cost of miss) | never comes up | admitted only when asked | unprompted, emotive ("nightmare", "my neck") | quantified losses or a real incident with money moved |
| **Recurring** | one-off/none | occasional | monthly cadence | **weekly or per-transaction** frequency; standing process exists because it keeps happening |
| **Untrusted** | verification exists and works | process exists but they admit it's weak/procedure-less | mostly manual / judgment calls they know are fragile | **"we don't really have a way" / "we hope" / evidence poor and they know it** |
| **Spend** | none budgeted | paying via person-hours nobody budgets | internal tools built to patch it | real external spend/budget line for verifying these decisions |
| **Wedge fire** (per relevant wedge) | yawn | "interesting" | "we'd test that" | **"we'd fund/pilot that" — unprompted budget-floor language** |
| **Authority** | student / no seat | advisor / tooling | manager who owns the pain | **signs a budget or edits regulation-adjacent policy** |

**Trust-Gap Score = Severe + Recurring + Untrusted (max 9).**
- **Gap ≥ 7** → "bold signal" conversation.
- **Gap = 6** → counts for G1 with a written incident behind score 3s.
- **Gap ≤ 5** → runs but doesn't count toward G1 (log it; look for pattern).

**Falsifiers (auto-gates):** if Severe ≤1 or Untrusted ≤1, note the wedge set for this persona — you are either talking to the wrong person or the wedge is a nice-to-have; adjust targeting, not the wedge, until 5+ conversations say otherwise.

---

## 4. Conversation tracker columns (one row per call)

`#` · `date` · `name/org (initials ok)` · `persona (A/B/C/D/INS)` · `wedges shown` · `Severe/Recur/Untrust/Spend` · `Trust-Gap` · `wedge fire WH-? (0-3)` · `authority (0-3)` · `one verbatim quote (max 30 words)` · `referrals produced (n)` · `funds/pilot/ignore`

**Archive rule:** every call gets a row the same day. Names/IP stay private; the row is the asset. The tracker is the first compounding artifact of the new company — it never resets.
