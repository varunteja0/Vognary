# Vognary Seam — Verified Evidence & Competitive Map (2026-10-23)

Status: research artifact for the locked P1+P2 scope. Nothing here is a product claim. All items below were source-verified on 2026-10-23.

---

## 1. Verified problem evidence

| Fact | Source (verified) |
|---|---|
| 76% of US organizations experienced attempted/actual payments fraud in 2025; BEC affected 74% — "Fraudsters primarily impersonate vendors or executives to request changes to payment instructions" | 2026 AFP Payments Fraud and Control Survey (22nd annual, n=465, underwritten by Truist, published Apr 14 2026) |
| BEC = $2.77B in reported losses in 2024; FBI-published cumulative "Business Email Compromise: The $55 Billion Scam" (2013–2023 exposed losses $55.5B); FBI guidance = independently verify payment-instruction changes via a trusted, separately sourced channel | FBI IC3 2024 Annual Report; FBI BEC PSA (Sep 2024); FBI BEC advisory page |
| 48% of organizations under $1B revenue that experienced payments fraud incurred a loss; 24% recovered nothing; only 17% use AI to fight fraud | Same AFP 2026 survey (Truist key-highlights PDF; PRNewswire release) |
| Supplier invoice fraud ≈ 55% of all UK fraud; average annual loss £295k | Norton Rose Fulbright "Supplier invoice fraud: who pays up?" (Sep 2023) |
| "Ghost Executive" (fabricated internal approvals so payments appear pre-authorized): 255 incidents in H1 2026; "Deadline Deception": 97; 70% of employees rely on typos/grammar to spot fraud | Trustmi research via FF News (Aug 2026), ~600 intent-driven attacks analyzed |

**Meta-reading:** the attack pattern has already migrated from *fake accounts* to *fake authority* (impersonated supply-side identity AND fabricated internal approvals). Verification responses below are organized around the older threat.

---

## 2. Verified competitive landscape — three waves, all real

| Wave | Companies (verified) | What they own | What they stop short of |
|---|---|---|---|
| **W1: Account-data verification** | Trustpair (550+ enterprise customers, 190 countries, Nacha Preferred Partner, "zero successful fraud events" claim, up to $1M liability, 90% callback reduction); Eftsure (network+ database model, red/green-thumb, procure-to-pay coverage, acquired US AI vendor-data specialist Relish Sep 2026); VendorInfo | Bank-account ownership/legitimacy + continuous monitoring, replacing manual callbacks with data checks | Per-instruction **authorization** evidence; outside US/EU enterprise price band; data needs differ |
| **W2: Vendor identity network** | PaymentWorks (Mar 2026: $2M base indemnity + up to $5M excess coverage via Lockton; Aug 2026: "Payee Profile" portable, reusable vendor credential; Vendor Identity Network >1.5M credentialed businesses); Trustmi (Israel, $21M disclosed, Nacha Preferred Partner May 2026) | Payee onboarding/identity; protection economics via insurance | Not per-instruction authorization records; US-centric; identity ≠ authority |
| **W3: AI investigation/behavioral detection** | Trustmi AI Investigation Agent (Aug 2026) "connect evidence across ERPs and emails"; ScamShield AI (India: WhatsApp/email invoice-time checks, "14 fraud types ... pay-or-hold verdict") | At-time detection, risk scores | Detection ≠ proof; scores don't answer "who authorized this" |

**The open seam (hypothesis — this is what conversations must test, NOT assert):**
**Instruction-level authorization proof at the money-moment**: an independent, verifiable record of *who authorized WHAT instruction, via WHat evidence, when* — captured via the supplier's pre-registered authority channel, portable to auditors / banks / insurers / rails, and extensible to agent-issued instructions. W1 defends the account. W2 defends the entity. W3 guesses the fraud. Nobody visibly owns the proof-of-authority for the instruction itself — and the threat data (Ghost Executive) says the attack surface moved exactly there.

**India note:** penny-drop/beneficiary-name checks exist for account matching; ScamShield-type email scoring exists; one small Indian SaaS is detection-first. No verified Indian incumbent owns instruction-level authorization proof for corporate payments. (To be confirmed in Tier-4 conversations.)

---

## 3. Falsifiers for this seam (pre-written)

1. If mid-market controllers say penny-drop + callback + GST/ERP trails leave no felt gap they'd pay for → Vognary-as-stage-1 dies; the records/standards asset (WH-3) carries forward per the ratchet rule.
2. If ≥3 conversations say Trustpair/Eftsure-class tools already solve the instruction-authorization gap at their reachable price → the seat is closed internationally; test the India/mid-market price wedge OR the agent-era extension, else park.
3. If the "authorization proof" is dismissed as "that's just my ERP approval workflow" correctly → the seam is really about portability/audit/agent-era, not the record itself; probe accordingly in the same conversations.

## 4. Do-not-do list for this seam
- Do NOT pitch "an AI detector" — every wave already sells detection; the memo's own instinct (evidence-of-authorization, AI as assistive) is right.
- Do NOT claim zero-fraud or guarantee prevention — wave promises live at Trustpair/PaymentWorks with $1–5M liability carries; a new entrant sells *evidence quality and control design*, not perfection.
- Do NOT enter with an enterprise price umbrella. The India/mid-market seat is the wedge; enterprise-international is the later expansion.
