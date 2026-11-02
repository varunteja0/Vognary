# Critic verdict: "Investigate ComputeShift before the machine-money trust protocol" (2026-10-25)

Trigger: founder pasted an external AI's comparative verdict recommending (a) treating the trust-protocol thesis as weakened by emerging standards (AP2→FIDO, Visa TAP, Stripe/Tempo MPP), and (b) investigating "ComputeShift" (results-bounded compute delivery: cost/deadline/reliability SLA per job). This file records verification and the pre-committed decision rules. It does not amend the Gate Contract (03) — the wedge and G1/G2 are unchanged.

---

## 1. New evidence verified today (and it is real)

| Claim in the external verdict | Status | Verified detail |
|---|---|---|
| Google AP2 donated to FIDO Alliance | ✓ VERIFIED (blog.google, Apr 28 2026) | "60+ organisations" per AP2 launch context; v0.2 adds **"Human Not Present"** autonomous payments |
| Visa Trusted Agent Protocol specs published | ✓ VERIFIED (developer.visa.com) | Public spec pages for merchant-side agent recognition |
| Stripe + Tempo Machine Payments Protocol, Mar 2026 | ✓ VERIFIED (stripe.com blog + Fortune + The Block, Mar 18 2026) | Open, **rail-agnostic** standard; Visa same-day added Card-Based MPP spec + SDK; Lightspark extended to BTC/Lightning; Tempo directory 100+ services (Anthropic, OpenAI, Shopify, Mastercard); Tempo raised $500M series A at $5B valuation (Oct 2025) |
| SkyPilot: orchestration across 20+ providers, cost-aware | ✓ VERIFIED (github/skypilot.ai/NSDI'23 paper) | Apache-2 open source, 10.7k stars, BYOC, 20+ clouds incl. CoreWeave/Nebius/Lambda/RunPod/Crusoe/Vast; Berkeley Sky Computing Lab; claims 3–6x spot savings, automatic failover; adopted by 100s of companies |
| Emerald AI $150M @ $1.05B, deployed commercially | ✓ VERIFIED (Aug 25 2026) | Grid-responsive data centres; 12 Fortune 500 investors; wedge = selling DC flexibility to the power grid, NOT job-level SLA delivery |
| FlexSysAI launched Aug 2026, shifts GPU workloads per grid conditions | ✓ VERIFIED (flexsys.ai, DCD, CSIRO) | Australia-first; NVIDIA Inception; CSIRO/ResetData pilot on H200 cluster; deploying at NVIDIA's 96MW Aurora DC; wedge = grid-side demand flexibility |
| NVIDIA DSX broad AI-factory platform | ✗ UNVERIFIED this session | Plausible; needs check before ever being cited |
| CoreWeave-class committed-capacity resellers | ✗ UNVERIFIED this session | Plausible; needs check before ever being cited |

**What this evidence kills:** *the claim that a startup becomes THE universal machine-money protocol.* The agent↔merchant↔rail trust layer is now being defined by consortia of giants (FIDO + Visa + Stripe/Tempo + Google) with $500M-backed infrastructure. That ambition is dead as a primary bet. **Conceded — no further defense.**

**What this evidence does NOT touch:** the **corporate instruction seat** — which person authorized a vendor's bank-detail change inside a mid-market company, and the immutable proof of it. Every verified standard above governs *agent-to-service and machine-to-machine* payment trust at rails level. None of them verifies on-prem corporate vendor-master authority (no evidence of overlap found; file 04's three competitive waves — Trustpair 550+ customers, PaymentWorks 1.5M businesses, Trustmi — all stop at account-data checks, verified Aug 2026). AP2 v0.2's "Human Not Present" *increases* the urgency of the corporate instruction-proof layer, because it normalizes instructions issued without a human present.

## 2. The non-sequitur in the external verdict, stated precisely

The verdict attacks "becoming the universal protocol" — a Stage-3/4 ladder ambition **we never committed to** in the gate contract. The committed bet (03) is the Stage-1 wedge: authorization-proof for vendor payment-instruction changes, measured at G1 Nov 1. The verdict's own evidence is entirely about agent-rail trust, which the Stage-1 seat does not compete with or depend on. Therefore its conclusion *"investigate ComputeShift first"* does not follow from its own evidence. The correct response to the same evidence is: **downgrade Stage-3 posture from "protocol owner" to "protocol participant/feeder," and accelerate Stage-1** — the corporate layer is the one the standards do not reach.

## 3. ComputeShift through the founder's own locks

1. **Finance-arena lock (founder's own, date unspecified):** ComputeShift is AI infrastructure. It fails the locked arena unless the founder consciously amends the lock. Register the amendment if made; do not drift silently.
2. **Instrument quality:** the proposed benchmark ("run a real flexible workload across providers vs SkyPilot") is honestly designed — but it is a **feasibility** test (cost/time/reliability). The question that killed TradeLoop was **demand**, and the verdict itself concedes: *"do customers need a service that takes this responsibility away…cannot be answered by making the architecture more ambitious."* Feasibility-first repeats the pattern we are parked for.
3. **Five-mechanics scorecard (files 07/08):** ComputeShift ≈ **2.5/5** — attaches to a huge flow ✓; cloud-neutral judge ✓(partial); compounding asset ✗ (scheduler learning is thin; hyperscalers/neoclouds own inventory data); embedded distribution ✗ (enterprise SaaS, sales-led); standard others must reference ✗ (an SLA consolidator is not cited as data or format). Compare the Instruction Ledger end-state: 5/5.
4. **Economics of the promise:** "completed job for agreed cost/deadline/reliability" makes us the **underwriter of compute variance** — failures, egress, preemption storms, license risk become our book. That requires capital and actuarial data we do not have, and SkyPilot's verified free maturity (3–6x savings automated, 20+ clouds, Apache-2) compresses the orchestration layer the SLA hides.
5. **Credit where due:** the results-bounded promise (sell the outcome, not the tooling) is the same insight as our wedge sells ("sell the authorization record, not a dashboard"), and the benchmark spec is worth freezing — registered verbatim below.

## 4. Decision rules (pre-committed)

- **R1 — Language downgrade:** all pitch/gate materials re-state Stage-3/4 as *"the corporate authority-proof layer that the machine-money protocols must interoperate with"* — never "we become the protocol." Registered here; no retro-edit of the gate contract.
- **R2 — ComputeShift = watch-list #3.** Its benchmark spec is frozen verbatim (external verdict §3: customer submits job+deadline+budget; we select infra, execute, recover, validate deliver cost/execution evidence; benchmark vs SkyPilot + best existing alternative). **Promotion rule:** only after the Nov 1 G1 verdict, only by the founder consciously amending the finance arena, and then as its own mini-G1 with pre-written kill criteria — never run in parallel with an active gate instrument.
- **R3 — Ratchet intact:** tracker, incident bank, persona map, intent register, and this protocol-crowding evidence carry forward regardless of wedge outcomes.
- **R4 — Monday unchanged:** 2 Tier-4 calls/day from Oct 26; G1 Nov 1; G2 Nov 21.

## 5. Line-by-line rulings on the external verdict

| Its claim | Ruling |
|---|---|
| Standards weaken the universal-protocol thesis | TRUE — verified; conceded in full |
| Therefore the trust-protocol company is a difficult bet | TRUE for protocol-ownership; FALSE for the Stage-1 authorization-proof wedge (different layer; gap re-verified same day) |
| ComputeShift more directly measurable than trust rails | TRUE for feasibility metrics; misleading for demand (its own §4 concedes the demand question unanswered) |
| ComputeShift can start without owning datacentres | TRUE technically; FALSE practically — the SLA makes us the underwriter of a risk book |
| Emerald AI / FlexSysAI = competition | VERIFIED that they exist and are funded; their wedge is grid-side economics — adjacent, not identical |
| "I cannot assign numerical success rates to either" | CORRECT; matches our method — and is exactly why demand-from-real-buyers beats feasibility-from-benchmarks first |
