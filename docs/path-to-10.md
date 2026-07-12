# Vognary: The Path to 10/10

Date: 2026-07-10
Status: adopted master plan. Supersedes nothing; sequences everything. The 7-day plan (`docs/7-day-execution-plan.md`) is Phase 0, Week 1 of this document.

---

## Part I — What 10/10 Means (measurable, or it doesn't count)

A 10 is not a feeling. Each dimension below has an exit criterion that can be checked by a script, a ledger, or a bank statement. The company is a 10 when every row is green.

| Dimension | Today | 10/10 exit criterion |
| --- | ---: | --- |
| Wedge sharpness | 8.5 | Category language exists outside our own site: users/press/CAs say "recurring-money audit" unprompted. ≥3 organic inbound requests/week. |
| Intelligence engine | 7.5 | ≥97% precision / ≥92% recall on a 500-file golden corpus of real (redacted) Indian bank/card statements; every release gated on corpus regression. |
| Trust & honesty | 8.5 | Offline audit-pack checksums plus optional Ed25519 issuer signatures, public trust page with live readiness, zero connector claims above proven state — enforced by CI and still requiring external security review. |
| Product UX | 7 | Time-to-first-insight < 3 minutes from landing; ≥60% of new users reach a proven ledger in session 1; mobile parity audited. |
| Backend code readiness | 7 | SLOs published and met: 99.9% uptime, p95 audit < 1.5s, quarterly automated restore drills green in CI history. |
| Production activation | 4.5 | Every runbook gate READY in strict mode: `production:check --strict` passes against production. |
| Live connector depth | 5 | ≥12 connectors at honesty state `live` with persisted evidence; Gmail verified for public users; ≥1 regulated rail in production. |
| Data durability | 4 | Normalized per-workspace history with month-over-month diffs; 12 months of review history reconstructible for any workspace. |
| Business validation | 2 | ₹25L+ ARR equivalent run-rate, ≥60% D90 retention on monitoring, ≥₹1Cr cumulative *verified* savings minted for users. |
| Distribution | 2.5 | Two repeatable loops running without founder push: CA/accountant channel + shareable audit artifacts; CAC < 1/3 LTV measured. |

**Composite rule:** the overall score is the *minimum* of the rows, not the average. That is the discipline: a company with a 10 engine and a 2 business is a 2. Everything below is ordered to raise the minimum.

---

## Part II — The Five Leaps (the creative core)

These are the bets that make Vognary category-defining rather than incrementally better. Each is designed so competitors must rebuild culture, data, or regulatory standing — not just features — to copy it.

### Leap 1 — The Proof Graph
**From:** a list of recurring items with evidence arrays.
**To:** a typed, queryable evidence graph with checksummed exports and optional trusted issuer signatures.

- Model: `Commitment ↔ Evidence ↔ Source ↔ MerchantEntity ↔ Rail` as first-class nodes/edges in Postgres (the schema's `recurring_items`, `evidence_links`, `connector_evidence`, `data_sources` tables already sketch this — promote it to the product's spine, not just storage).
- Confidence becomes a *computed property of graph structure*: proof density × source diversity × freshness × cadence stability. Explainable: clicking a confidence score shows the exact subgraph that produced it.
- Provenance queries as product features: "every commitment whose only proof is older than 60 days", "every rupee of monthly burn proven by a single source", "which source, if connected, would raise the most confidence" (this powers a *ranked* next-source recommendation, replacing the static coverage checklist).
- **Audit-pack integrity with explicit trust levels:** every export gets a recomputable SHA-256 content checksum and local previous-hash metadata. That checksum detects accidental or post-export edits but is self-generated and can be recreated by anyone. Authenticated exports receive an optional Ed25519 issuer signature when signing keys are configured; the signature binds the hash, chain metadata, timestamp, and opaque workspace reference. `/verify` checks both without uploading financial content. A valid signature proves Vognary's signing service issued that hash, not that every financial claim is correct or that the local chain is complete.

### Leap 2 — Verified Savings
**From:** "we recommend you cancel" (every tracker says this).
**To:** "we *proved* you stopped paying" (nobody does this).

- Closed loop: when a user marks `cancel` or `downgrade` executed, the engine watches the next 2 expected cycles. If the charge does not recur (or recurs smaller), it mints a **Verified Saving**: `{commitment, action, expected_amount, cycles_clean, annualized_value, evidence_of_absence}`. Absence-of-evidence is itself evidence here — the engine already predicts exact next-debit dates, so a missed prediction after a cancel is a provable outcome.
- Product surface: a cumulative "Money you verifiably stopped paying" counter per workspace — the single most shareable number in the product — plus per-item savings receipts in the audit pack.
- Business surface: the pricing anchor. Monitoring can be sold flat *or* as a % of verified savings (users who doubt value pay nothing until value is proven — an offer only an evidence-first product can make).
- Growth surface: quarterly "burn cut" cards (redacted, user-triggered) — "Vognary verified ₹43,000/yr stopped leaving my account" — the founder-community share loop.

### Leap 3 — Collective Merchant Intelligence (the data moat)
**From:** static regex merchant rules.
**To:** an opt-in, privacy-preserving network where every user's evidence improves everyone's detection — India's recurring-price observatory.

- Users opt in to contribute *merchant-level facts only*: normalized merchant fingerprints (descriptor patterns), cadence distributions, plan price points, price-change events, cancellation-difficulty ratings. Never amounts tied to identity; k-anonymity threshold (no fact published under n=25 contributors); differential noise on counts.
- What it unlocks: (a) detection recall for long-tail Indian merchants no regex list will ever cover; (b) **price-hike radar** — "Merchant X raised plan Y for 78% of contributors this month" pushed to affected users *before* their renewal; (c) cancellation playbooks ranked by what actually worked; (d) a public monthly "India Recurring Price Index" report — an owned-media asset that compounds (press cite it, merchants fear it, users trust it).
- This is the moat that ages like wine: a competitor can copy the UI in a quarter; they cannot copy three years of India-specific cadence fingerprints and price-event history.

### Leap 4 — Guided Proof Capture now, Regulated Rails after
**From:** "UPI/card mandates are blocked on partners" (true, passive).
**To:** the best *legal* mandate coverage in the market while the partner rails are earned.

- **Guided Proof Capture:** a wizard that walks the user through their own GPay/PhonePe/Paytm mandate screens, App Store and Play subscription pages, and bank e-mandate lists — step-by-step per app, structured entry fields matching each screen's exact layout, screenshot attach (parsed on-device where possible, encrypted at rest otherwise). Ten minutes, once — and Vognary holds the only complete mandate inventory the user has ever had. Honest state: `evidence-only`, proudly. This converts our biggest blocker into a product experience competitors with fake "bank sync" can't match on truthfulness.
- **Pre-debit notification parsing:** RBI mandates pre-debit notifications by email/SMS. Email versions arrive in Gmail — the connector we already have. Build the notification-pattern library (top issuers/PSPs) so mandate state stays *fresh* through the rail we already legally own. (SMS stays out until a user-initiated export-file import with explicit consent clears legal review — no scraping, ever.)
- **Regulated rails, sequenced:** AA path = Sahamati ecosystem onboarding → TSP partnership (Setu/Finvu-class) for FIU access → sandbox consent flow → security review → production. Mandate path = PSP/payment-aggregator conversations for mandate-visibility APIs. Tracked only through the partner-rail env statuses that `partner-rails:check` already validates; product claims move only when status is `production-live`. Target: one rail live within 6 months, both within 12.

### Leap 5 — Cited AI ("no citation, no claim")
**From:** the industry's LLM-guesses-your-finances slop.
**To:** an AI layer that is only allowed to speak with receipts.

- The deterministic engine remains the sole source of truth. The LLM gets three jobs, each with a hard rule that every claim must cite evidence node IDs from the Proof Graph — outputs without citations are discarded before render:
  1. **Extraction fallback:** messy receipts/statement rows the deterministic parsers reject → strict-JSON-schema extraction → user confirms → becomes normal evidence (confidence-capped until corroborated).
  2. **Ask your ledger:** natural-language Q&A ("what did my AI stack cost last quarter and what changed?") compiled to graph queries; the answer renders with clickable proof rows.
  3. **Action drafting:** cancellation/negotiation emails and DPDP data-request letters, pre-filled from evidence, sent by the user.
- Positioning writes itself: *"Every finance app added AI that guesses. Vognary added AI that must show its receipts."*

---

## Part III — The Operating Chassis (core → advanced engineering)

The leaps stand on a chassis that must be boring, tested, and durable.

### C1. Durable Graph Backend (the biggest engineering lift)
- Promote from encrypted JSON snapshots to normalized per-workspace history: `transactions`, `recurring_items`, `evidence_links`, `connector_evidence`, `recommendations`, `audit_reports` as living rows (schema exists — write the repository layer and migration of snapshot data).
- Event-sourced change log on top of `audit_log`: every mutation (new evidence, merge, action, price change) is an event; the **Month-over-Month Diff Engine** is a pure fold over events: "since your June review: 2 new commitments, 1 price hike (+₹550/yr), 1 lapsed, coverage 71→84, ₹1,940 verified savings."
- The monthly review becomes a *generated artifact* (web + PDF + email), not a manual ritual. This is the retention engine: monitoring subscribers get a review that writes itself.

### C2. Parser Corpus & Format Registry
- Golden-file corpus: 500+ real redacted statements across the top 20 Indian banks/cards (HDFC, ICICI, SBI, Axis, Kotak, AmEx, …), CSV and PDF layouts, collected from consenting audit customers (redaction tooling included).
- Format registry: per-institution column maps, date formats, PDF table geometries; auto-detection with per-file parse-confidence surfaced to the user.
- CI gate: `npm run corpus` — precision/recall computed per release; a regression blocks merge. (Extends the 21 unit tests shipped today into statistical guarantees.)
- Receipt side: HTML email parsing for full Gmail messages (not just snippets), merchant email fingerprint library for the top 200 recurring merchants, fed by Leap 3 contributions.

### C3. Entity Resolution v2
- Replace exact-match merge gates with explainable probabilistic scoring: descriptor similarity + amount proximity + cadence phase alignment + source independence → merge score with human-readable reasons ("merged: same ₹1,999 amount, 30-day phase-aligned, independent sources"). Below-threshold pairs surface as "possible duplicate — confirm?" cards instead of silent guesses. Every merge is an event (C1) and reversible.

### C4. Team & Multiplayer
- Real workspace members (schema exists): invites, roles, persisted owner assignments and notes, review-completion history, approval flow for cancel decisions above a threshold, weekly Slack/email renewal digest. Founder→ops-hire handoff is the natural expansion motion inside every paying workspace.

### C5. Reliability, Security, Compliance to a 10
- SLOs published: 99.9% uptime, p95 stateless audit < 1.5s, sync-job success ≥ 99% weekly; error budgets enforced.
- Envelope encryption (per-workspace data keys under the master key), documented key-rotation runbook, quarterly *automated* restore drills recorded in CI history.
- DPDP Act compliance mapping, automated data-subject requests (export + erasure already exist — add request tracking), `security.txt` + vulnerability disclosure policy, threat-model doc, SOC 2 Type I within 12 months (Type II following), external penetration test before the regulated rail ships.
- The `/security` page upgrades from claims to *live proof*: real readiness states, last restore-drill date, last pen-test date.

### C6. Modularity end-state
- Keep the modular monolith until sync volume demands otherwise; then extract exactly two services: the sync-worker pool and the parser service. Engines (`recurring-audit`, `renewal-timeline`, entity resolution, diff engine) stay pure, dependency-free libraries — the tests-first discipline shipped this session is the permanent rule: **no engine change without a failing test first.**

---

## Part IV — Business & Distribution (the score can't be a 10 without this)

### Revenue ladder
1. **Free self-audit** (forever): the honesty funnel — full engine, local-first, export included.
2. **Audit packs:** ₹999 personal / ₹4,999 founder white-glove (human-assisted pack with an offline checksum and a Vognary issuer signature when signing is configured).
3. **Monitoring:** ₹199/mo personal, ₹999/mo founder, ₹4,999/mo team — auto-generated monthly reviews, price-hike radar, renewal digests. *Verified-savings pricing option:* pay 20% of verified savings instead, capped — the offer only we can make (Leap 2).
4. **CA/accountant channel:** multi-client console + white-label audit packs; CAs run recurring audits as a service line. India-specific distribution hack: thousands of CAs, each carrying dozens of exactly-ICP clients.
5. **B2B2C white-label:** bank/issuer/fintech embed of the graph + engine (the `bank-issuer-white-label` connector target), earned *after* the consumer proof, priced per-account.
6. **API:** the audit engine and verification endpoints for partners (readonly, metered).

### Distribution loops (two must run without founder push)
- **Artifact loop:** shareable redacted burn cards + verified-savings receipts + the public pack verifier — every export is a referral surface.
- **CA loop:** partner program with rev-share; their client reviews generate corpus contributions (C2) and network facts (Leap 3) — distribution that *feeds the moat*.
- **Observatory loop:** the monthly India Recurring Price Index (Leap 3) as owned media; price-hike news cites us.

---

## Part V — Phased Execution (gates continue G1–G7 from the 7-day plan)

Each phase has numeric exit gates. **A phase does not close on shipped code; it closes on the metric.** Failing a gate twice triggers the phase's stop condition, not a workaround.

### Phase 0 — Foundation Lock (Weeks 0–2)
Run `docs/7-day-execution-plan.md` twice through. Adds: redaction tooling v0 so every audit customer can consent to corpus contribution from day one.
**Exit (G8):** G1–G6 green; ≥5 paid audits; ≥3 monitoring commitments; corpus at ≥25 files.
**Stop:** the existing stop/go criteria in `current-state-and-market-gap-analysis.md`. If users won't pay after value is shown twice, halt build-out and rework the offer — nothing in Phases 1–4 fixes an unwanted product.

### Phase 1 — Proof Economy (Weeks 2–8)
Build: Proof Graph v1 (computed confidence + provenance queries + ranked next-source), checksum/signature-aware packs + `/verify`, Verified Savings v1, Guided Proof Capture wizard (GPay/PhonePe/Play/App Store flows), durable backend migration (C1) behind a flag for new workspaces.
GTM: 30 paid audits; CA pilot with 3 accountants; Gmail verification (submitted Phase 0) lands → open Gmail to public.
**Exit (G9):** ≥₹1L collected revenue; ≥10 verified savings minted; ≥50% of audit customers complete guided capture; corpus ≥100 files; durable backend holds 100% of new workspaces with zero data-loss incidents.
**Stop:** if guided capture completion < 25%, the wizard is too heavy — cut per-app scope before adding rails.

### Phase 2 — The Living Ledger (Weeks 8–16)
Build: Diff Engine + auto-generated monthly reviews, entity resolution v2, parser format registry for top 10 banks with corpus CI gate, price-hike radar v0 (rules on own-workspace data), team multiplayer (C4), Cited AI job #1 (extraction fallback).
GTM: monitoring becomes the lead offer; verified-savings pricing experiment on 20% of new subscribers; first Price Index published from opt-in data (only if n≥25 per fact).
**Exit (G10):** ≥100 monitoring subscribers; D60 retention ≥60%; corpus precision ≥95% / recall ≥88%; ≥₹5L cumulative verified savings; monthly review open rate ≥70%.
**Stop:** retention < 40% at D60 means the monthly review isn't valuable yet — freeze connector expansion, fix the review artifact.

### Phase 3 — Rails & Network (Months 4–9)
Build: AA/TSP sandbox → production consent flow (per the sequenced path in Leap 4), pre-debit notification parsing, Cited AI jobs #2–3, merchant intelligence network v1 (fingerprints + price events with k-anonymity), SOC 2 Type I, pen test, envelope encryption.
GTM: CA program to 25 partners; "connect your bank — the RBI-regulated way" as the first honest bank connection in the category; PSP mandate-API partnership signed (sandbox acceptable).
**Exit (G11):** AA rail `production-live` with ≥100 real consents; ≥500 monitoring subscribers; network facts covering ≥1,000 merchants; strict production check green continuously for 30 days.
**Stop:** if AA production access stalls > 2 quarters, deepen Guided Capture + notification parsing instead — coverage honesty is the brand; timeline slips are survivable, faked rails are not.

### Phase 4 — Category King (Months 9–18)
Build: card-mandate rail, white-label embed v1 with one signed issuer/fintech pilot, public API, Recurring Clarity Score as a shareable standard, Price Index as a monthly institution, SOC 2 Type II.
**Exit (G12 = the 10/10 audit):** every row of the Part I scorecard green, re-scored by someone incentivized to say no.

---

## Part VI — Anti-Goals (what we will never do, at any score)

1. Never claim a connector above its proven honesty state — CI-enforced, forever.
2. Never store bank passwords, card numbers, or scrape SMS.
3. Never sell or cross-sell user financial data; the network (Leap 3) is opt-in, merchant-level, k-anonymous, and auditable.
4. Never let an AI answer render without evidence citations.
5. Never become a budgeting app, a lending funnel, or an enterprise procurement suite — the wedge is recurring commitments, proven.
6. Never ship an engine change without a failing test first; never ship a release that regresses the corpus.

---

## Part VII — Scorecard Traceability (which work moves which number to 10)

| Dimension → 10 | Moved by |
| --- | --- |
| Wedge sharpness | Price Index, Verified Savings cards, category language in CA channel (Leaps 2–3, Part IV) |
| Intelligence engine | Parser corpus + registry, entity resolution v2, network fingerprints (C2, C3, Leap 3) |
| Trust & honesty | Tamper-evident packs, live trust page, external reviews, anti-goals (Leap 1, C5, Part VI) |
| Product UX | Guided capture, generated monthly review, Ask-your-ledger (Leap 4, C1, Leap 5) |
| Backend readiness | SLOs, envelope encryption, automated drills (C5) |
| Production activation | Phase 0 gates; strict check green for 30 days (Phase 3 exit) |
| Connector depth | Gmail public, 12+ live connectors, AA rail, mandate rail (Leap 4, Phases 2–4) |
| Data durability | Durable graph backend + diff engine (C1) |
| Business validation | Revenue ladder, verified-savings pricing, retention gates (Part IV, G9–G11) |
| Distribution | Artifact loop + CA loop running unattended (Part IV) |

The composite is the minimum of the rows. Phase order exists precisely to raise the current minimums first: **validation and activation before rails, rails before scale, truth before everything.**

---

## Implementation Log

### 2026-07-10 — Phase 1/2 engineering wave (all validated: 55 unit tests, lint, build, smoke green)

Shipped in code:

- **Leap 1 · Proof Graph v1** — `src/lib/proof-graph.ts`: single-source vs multi-source spend, stale-evidence spend, evidence freshness (future-dated rows excluded), and ranked next-best-source by monthly ₹ at stake. Workspace panel in section 04; included in sealed packs.
- **Leap 1 · Audit-pack trust levels** — `src/lib/audit-pack.ts`: canonical JSON + offline SHA-256 self-checksum, local chain metadata, optional server-side Ed25519 signature for authenticated workspaces, and `/verify` client-side validation against published public keys. Exported evidence text remains redacted; checksum and signature claims are presented separately.
- **Leap 2 · Verified Savings v1** — `src/lib/verified-savings.ts`: cancel/downgrade decisions carry timestamps; expected debits are walked forward; a clean cycle counts **only when evidence coverage extends past the debit's grace window**. Statuses: watching / verifying / verified / not-eliminated. Panel in section 03; totals in packs.
- **Leap 4 · Guided Proof Capture** — `src/lib/guided-capture.ts` + wizard panel: step-by-step GPay/PhonePe/Paytm/Play/App Store/bank e-mandate inventory producing user-confirmed ledger items.
- **Leap 4 · Pre-debit notification parsing** — receipt parser understands RBI pre-debit/e-mandate notices ("towards X … will be debited on …"), day-first Indian dates, Mandates category, confidence 78.
- **C1 seed · Diff engine** — `src/lib/review-diff.ts`: review-completion snapshots + month-over-month diff (added/removed/price changes/cost & coverage deltas). "Since last review" panel opens the review chapter.
- **C2 seed · Format registry** — `src/lib/statement-formats.ts`: HDFC/ICICI/SBI/Axis/Kotak header fingerprints with detection confidence, engine header synonyms extended, ingest labels detected formats. Golden-corpus harness still pending real redacted files.
- **C3 seed · Entity resolution v2** — engine emits explainable duplicate candidates; user decisions (merge/keep-separate) persist in the workspace and recompute all totals; merges tagged `user-confirmed same commitment`.
- **P0 · Redaction engine** — `src/lib/redaction.ts` masks Aadhaar/card/PAN/IFSC/phone/account/UPI handles in exported evidence and PDF previews while preserving audit signals.

Still external (cannot be completed by code, per anti-goals):

- Paid audits/monitoring revenue (Phase 0 gates G3/G6) — outreach.
- Google restricted-scope verification — submission + review time.
- Durable Postgres-backed graph history (C1 full) — needs provisioned production DB to migrate against.
- AA/TSP + PSP mandate partnerships (Leap 4 end-state), merchant-intelligence network (needs ≥25 opted-in contributors per fact), Cited AI (needs provider key + spend approval), SOC 2 / pen test (external firms).
