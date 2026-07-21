# Vognary — Master Build Plan (the one file every agent opens first)

> **Executing the UI/UX quality + AI live-path leap?** The step-by-step work
> packages (WP-0 … WP-6) live in
> [execution-plan-ui-ai-quality.md](execution-plan-ui-ai-quality.md). This file
> is the law (Parts 3 and 5); that file is the ordered execution of it.

Date: 2026-07-20
Status: **canonical index + new-work spec.** This is the single entry point. It
does two things: (1) it points every topic at the one doc that already owns it,
so we never fork the truth; (2) it adds — in full depth — the four things no
existing doc yet specifies: the **AI layer**, the **Financial Twin engine**, the
**UI/UX quality system**, and the **one consolidated execution sequence with
costs**. Read Part 0, then jump to your part.

> **Why this file exists.** We have excellent scattered plans. An agent picking
> up work cold needs one map that says "here is the whole thing, here is your
> slice, here is the doc that is law for it." That is this file. It is an index
> plus the missing specs — not a replacement for the docs it points to.

---

## Part 0 — The contract (read before touching anything)

### 0.1 Single source of truth per topic
Do **not** restate these here; edit them at their home and link back:

| Topic | The doc that is law |
| --- | --- |
| The scoreboard, the 5 Leaps, the chassis (C1–C6), phases G8–G12, anti-goals | [path-to-10.md](path-to-10.md) |
| The wow ladder (WOW-1..5), architecture as-it-stands, execution protocol | [leap-plan-2026-07-20.md](leap-plan-2026-07-20.md) |
| The 10 external activation gates (exact env vars + one verify command each) | [founder-gate-runbook.md](founder-gate-runbook.md) |
| The 18 durable surfaces + module map + intelligence rules | [product-architecture.md](product-architecture.md) |
| Current state vs market, competitor teardown, stop/go criteria | [current-state-and-market-gap-analysis.md](current-state-and-market-gap-analysis.md) |

New material this file **owns** (edit it here): the AI layer (Part 3), the Twin
engine (Part 4), the UI quality system (Part 5), the consolidated sequence and
cost model (Parts 7–8).

### 0.2 The five invariants (from leap-plan Part 0 — non-negotiable)
1. **Isolated worktree per work package**, cut from the freshest committed HEAD.
   Multiple agents edit concurrently; never work over someone else's dirty files.
2. **The brand is fixed**: Nakul the mongoose, Fraunces display, graphite/gold.
   Deepen, never swap.
3. **Honesty is machine-enforced.** Merchants are *watched*, never *linked*;
   rails/sources use *connect* voice; nothing claims more than the deployment
   proves. `scripts/check-public-claims.mjs` fails the build on violation. The
   `*_STATUS=""` env-attestation pattern is the spine, not an inconvenience.
4. **Scoring is minimum-row** (path-to-10 Part I): the composite equals the
   weakest row. Before building anything ask: *does this raise the lowest row?*
5. **No engine change without a failing test first.** The gate chain before any
   merge: `npm run lint && npm run typecheck && npm run claims:check && npm test`,
   then `npm run build && npm run perf:budget`. UI: the signed-in e2e recipe in
   `.github/workflows/ci.yml`.

### 0.3 The one-line identity everything must serve
**"The recurring-money audit that measures, never promises — the finance AI that
cites or shuts up, built India-first."** If a feature can't be stated as a
*proven* claim, it is not shippable copy. This is the moat: competitors would
have to rebuild their data layer to support citation at all.

---

## Part 1 — The thesis in one page

**The market** (detail: gap-analysis doc). Mint's 2024 exit fragmented tens of
millions of users across six single-problem apps (Rocket Money = subscriptions +
negotiation; Monarch = all-accounts, manual; Copilot = pretty analytics; YNAB =
manual budgeting; Empower = net worth; Origin = early AI). **Nobody owns the
whole problem, and every AI bolt-on hallucinates amounts and merchants.** The
subscription-management slice alone grows ~$5.5B (2025) → ~$19B (2033).

**Our wedge is not "another dashboard."** It is the **evidence-first recurring-
money graph**: for every rupee you're committed to pay again, we show *what
proved it, what renews next, what it will cost, and what source is missing* —
and when we recommend an action we cite the exact evidence. US leaders are
US-centric and don't understand UPI AutoPay, card e-mandates, SIPs, EMIs, EPF,
app-store receipts, or Indian bank statement formats. We do.

**Why we win, stated as things competitors must *rebuild culture/data/regulatory
standing* to copy** (the 5 Leaps, path-to-10 Part II):
1. **Proof Graph** — confidence is a computed property of evidence structure, and
   every export is tamper-evident.
2. **Verified Savings** — we don't say "cancel"; we *prove you stopped paying* by
   watching the predicted debit fail to recur.
3. **Collective Merchant Intelligence** — an opt-in, k-anonymous India recurring-
   price observatory that ages like wine.
4. **Guided Proof Capture now, regulated rails after** — the best *legal* mandate
   coverage while AA/UPI partnerships are earned.
5. **Cited AI** — the AI is only allowed to speak with receipts (Part 3 below).

**The honest reality** (gap-analysis): the code is ~code-complete and CI-green;
what stands between us and the product is (a) **production activation** (10
external gates), (b) **the AI layer** (no LLM in the stack yet), (c) **the Twin
engine** (not built), and (d) **first paying users**. Only (b) and (c) are code.

---

## Part 2 — The architecture (high + low level)

Full surface list and module map live in
[product-architecture.md](product-architecture.md). The **spine**, so any agent
holds the shape in their head:

```
                         GUEST (client-only, stateless — scales to a crowd free)
receipt-parser.ts → recurring-audit.ts → renewal-timeline.ts → suggested-cuts.ts
   (paste/CSV/PDF)      (cadence engine)     (45-day calendar)    (keep/watch/cut)
                                   │  guest-audit-client.tsx / instant-audit.tsx
                                   ▼
─────────────────────────── SIGNED-IN WORKSPACE ────────────────────────────────
  vognary-mvp-client.tsx (the 5.5k-line monolith — decompose only in a quiet
  window) over raw Postgres, custom auth (cookies + magic link + Google OIDC),
  AES-256-GCM token vault, encrypted revisioned snapshots.
                                   │
        ┌──────────────────┬───────┴────────┬────────────────────┐
        ▼                  ▼                 ▼                    ▼
  Living Proof Graph   Living Ledger    Connect Rails        Money + Ops
  proof-graph-store    living-ledger-   connectors.ts,       fail-closed
  .ts (typed nodes,    store.ts         connector-runtime,   Razorpay, cron
  temporal edges,      (canonical       adapters (Gmail RO,  routes, backups,
  hash-chained events) sources/txns/    Setu AA, cost APIs)  shared rate limit
                       recurring/links)
                                   │
                          THE GATE WALL (CI): claims / brand / research checks,
                          statement+receipt corpus gates, perf + Lighthouse
                          budgets, 71+ unit files, 9 Playwright+axe specs,
                          release:gate orchestrator.
```

**The load-bearing design decision, everywhere:** *nothing claims what is not
proven.* Blank env → "Not yet proven"; checkout hidden; connector states tell the
truth. This is the wow if we surface it (WOW ladder, leap-plan Part 3).

**Where the two NEW engines plug in** (Parts 3–4): the **AI layer** sits *beside*
the deterministic engines as `src/lib/server/ai/*` — it never becomes a source of
facts, only reads the Proof Graph and writes cited drafts. The **Twin engine**
sits *next to* `renewal-timeline.ts` as a pure library `src/lib/twin/*` — it
extends the 45-day projection to 6–12 months and answers what-if deltas. Both
obey invariant 0.2.5 (failing test first) and 0.2.3 (honesty).

---

## Part 3 — The AI layer: "cite or shut up" (NEW — this file is law)

There is **no LLM in the stack today** (`package.json` has none). That was
correct — it forced the deterministic spine that makes safe AI *possible*. Now we
add AI as a thin, fail-closed layer with one rule.

### 3.0 The one rule
**The deterministic engine + Proof Graph are the sole source of every financial
fact. The LLM may never originate an amount, date, merchant, or recommendation
that is not backed by evidence node IDs. Any model output whose claims don't
resolve to citations is discarded before render.** This is enforced in code by a
citation validator, not by prompt politeness. Positioning: *"Every finance app
added AI that guesses. Vognary added AI that must show its receipts."*

### 3.1 The three jobs (and nothing else)
The LLM does exactly three things, in this priority order:

1. **Extraction assist (high volume, structured).** The ~20% of receipts/
   statement rows the deterministic parsers reject go to the model under a
   **strict JSON schema**. The extracted line items must **reconcile against the
   parsed document total** (arithmetic check) before acceptance; on mismatch the
   item degrades to `needs-review`, never a silent wrong number. Accepted items
   enter as normal evidence, **confidence-capped** until corroborated.
2. **Ask-your-ledger (LLM as compiler, not oracle).** A free-form question
   ("why did my spend spike?", "what am I forgetting?", "what did my AI stack cost
   last quarter?") is compiled to one of the **bounded deterministic graph
   queries** that `src/lib/proof-questions.ts` already defines. The model only
   *selects the query and its params*; the deterministic compiler executes and
   returns cited rows. If no query supports the question, the honest answer is
   *"your evidence can't answer that — connect source X"* — which is on-brand.
3. **Action drafting + narration (low volume, quality-sensitive).** Turn an
   already-computed fact ("Netflix +₹150, escalated keep→watch") into the sentence
   the user acts on, and draft cancellation / negotiation emails and DPDP
   data-request letters, pre-filled from evidence, **sent by the user** — never
   auto-sent (respects the Permissioned Outcome Loop + action-category rules).

### 3.2 Model selection per job (the answer to "which model, how much")
Use the **Anthropic SDK** (`@anthropic-ai/sdk`), one server-only module
`src/lib/server/ai/client.ts`, env `ANTHROPIC_API_KEY`. Split by workload —
**cheap high-volume tier for structured work, reasoning tier only where quality
changes the outcome**:

| Job | Model | Why | Key features to use |
| --- | --- | --- | --- |
| 1 · Extraction assist | **Haiku 4.5** (`claude-haiku-4-5`, $1 in / $5 out per MTok) | Structured extraction is a cheap, high-volume classification-shaped task; Haiku is fast and 5× cheaper than Opus | **Structured outputs** (`output_config.format` JSON schema, `strict: true`); **Batch API** for non-interactive backfills (50% off); **prompt caching** the static schema+instructions |
| 2 · Query compilation | **Haiku 4.5** | Intent→bounded-query is classification; tiny input (question + query menu), tiny output (query id + params) | Structured outputs (enum of query ids); **prompt-cache the query menu** (static prefix) so repeat questions read cache at ~0.1× |
| 3 · Narration + drafting | **Opus 4.8** (`claude-opus-4-8`, $5 in / $25 out per MTok) | Reasoning/recommendation quality is user-visible and trust-critical; worth the reasoning tier | Adaptive thinking (`thinking:{type:"adaptive"}`), `output_config.effort:"high"`; **streaming** for Q&A UX; **prompt-cache** the workspace context prefix |

Do **not** use Fable 5 here — the reasoning tier is Opus 4.8; extraction is Haiku.
(Model IDs are exact strings; never append date suffixes.)

### 3.3 The cost model (real numbers, zero → 10k users)
Per-unit (₹ at ~₹84/$; extraction gated so **only the ~20% parser-reject docs hit
the model**):

| Unit | Cold | With caching / batch |
| --- | ---: | ---: |
| One extraction call (Haiku, ~800 in / 300 out) | ~₹0.19 | ~₹0.10 (batch) |
| One query compile (Haiku, cached menu) | ~₹0.06 | ~₹0.02 |
| One narration/reasoning turn (Opus, ~2k in / 500 out) | ~₹1.9 | <₹1 (cached context) |

Monthly **fleet** cost, gated + cached, at realistic engagement (30 docs/user/mo,
20% fallback; 10 questions/user/mo, ~30% needing Opus narration):

| Active users | Extraction | Compile | Narration | **Total / mo** | **Per user** |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 50 (beta) | ~₹30 | ~₹30 | ~₹280 | **~₹340** | ~₹7 |
| 1,000 | ~₹600 | ~₹550 | ~₹5,700 | **~₹6,850** | ~₹7 |
| 10,000 | ~₹6k | ~₹5.5k | ~₹57k | **~₹68k** | ~₹7 |

**Read:** ~**₹7/engaged-user/month**, dwarfed by a ₹999 audit or any monitoring
SKU, and an order of magnitude below Plaid-style US aggregation (India's Account
Aggregator pulls are far cheaper — a quiet unit-economics edge over every US
competitor). The **naive upper bound** (every doc to the LLM, no batch/cache) is
~₹4,500–9,000/mo at 1k users — still trivial. **Guardrail:** a hard monthly spend
cap in `src/lib/server/ai/budget.ts`; when exceeded, AI degrades to
deterministic-only (fail-closed, never a broken experience).

### 3.4 Integration architecture (low-level)
```
src/lib/server/ai/
  client.ts        — the single Anthropic() client; reads ANTHROPIC_API_KEY;
                     throws→degrade if unset (no crash, AI just "off")
  extract.ts       — job 1: strict-JSON schema call + reconcile-against-total
  compile.ts       — job 2: question → {queryId, params} via enum output
  narrate.ts       — job 3: fact → sentence / draft (streaming)
  citations.ts     — THE GUARDRAIL: validateCited(output, graph): drops any
                     claim whose node IDs don't resolve; returns cited-only text
  budget.ts        — monthly spend cap + per-workspace rate limit (reuse
                     src/lib/rate-limit.ts Postgres buckets)
```
- **API routes:** `/api/workspaces/current/ask` already exists for cited answers —
  wire compile.ts + the existing deterministic executor behind it (the route
  stays the authority; the model only picks the query). Add
  `/api/ingest` extraction fallback path (guarded: parser first, model only on
  reject). Narration renders inside the Action Center via a streamed route.
- **Fail-closed everywhere:** API down, over budget, or answer can't cite →
  deterministic-only result + honest "AI unavailable" state. AI is never on the
  critical path for a correct answer.
- **Never bypass the claims gate**, even for a demo. The "no control is a demo"
  guard tests are the brand.

### 3.5 Testing the AI layer (failing-test-first still applies)
- **Golden extraction set:** redacted docs the parser rejects + expected JSON;
  assert reconcile-against-total logic (a fabricated line item must fail the
  arithmetic check and degrade to `needs-review`).
- **Citation validator unit tests:** feed synthetic model output with (a) valid
  node IDs, (b) hallucinated IDs, (c) no IDs — assert (b) and (c) are dropped.
- **Compiler tests:** a bank of questions → expected `queryId`; unsupported
  questions → the honest "connect source X" branch.
- **Budget cap test:** over-cap → AI functions return the deterministic fallback,
  not an exception.
- **No live-API calls in CI:** mock the client; the guardrail and reconcile logic
  are pure and fully testable offline.

### 3.6 With AI vs without AI (the UX delta, honestly)
Without AI, Vognary is already strong and free-per-request: prediction engine,
calendar, proof graph, verified savings all deterministic. **AI changes the
*interface*, not the facts** — from "user reads dashboards" to "user asks and gets
a *cited* answer," and from "here's a renewal" to "here's the one sentence that
tells you what to do about it." That is the Generation-3→4 jump — for us an
interface upgrade on existing engines, not a rebuild.

---

## Part 4 — The Financial Twin / Simulator engine (NEW — this file is law)

The one big idea from the market research we have **not** built, and it needs
**no AI** — it's deterministic math over the recurring graph. AI only *narrates*
the result.

### 4.1 What it is
A continuously-updated projection of the user's committed cash flow, and a
**what-if** function over it. Users ask decision questions instead of reading
charts: *"Can I afford a ₹1.5L vacation next month?"*, *"If I cut these 3 tools,
how much runway do I gain?"*, *"If I lose income today, how many months do I
survive?"* Nobody in the India market has this.

### 4.2 Spec (low-level)
```
src/lib/twin/
  project.ts   — extend buildRenewalTimeline (renewal-timeline.ts) from 45 days
                 to a configurable horizon (default 12 months); fold every known
                 recurring commitment forward by its cadence into a dated outflow
                 series. Pure function; every projected debit carries the evidence
                 node IDs that justify it (citations flow through).
  whatif.ts    — apply deltas to the projection: {type: add-onetime | cancel |
                 downgrade | change-amount | add-income, at, amount, evidenceRef}.
                 Returns the new series + a diff (runway change, month a balance
                 goes negative, goal-date shift).
  runway.ts    — given an opening balance + the projection, compute months-of-
                 survival and the first negative-balance date.
```
- **Inputs are only proven commitments** + a user-entered opening balance /
  income (labelled as user-entered, not "proven" — honesty rule holds).
- **Output is citable:** "runway extends 1.4 months" links to the exact debits
  that stop. This is the killer founder demo: *"cut Cursor + one duplicate AI
  sub, gain 1.4 months of runway."*
- **AI's only role:** `narrate.ts` (Part 3, job 3) turns the diff into the
  sentence. The math is deterministic and free.

### 4.3 Testing
Pure functions → exhaustive unit tests: cadence fold correctness (month-length
edge cases, leap Feb, quarterly/yearly), what-if delta arithmetic, runway zero-
crossing, and **citation propagation** (every projected debit resolves to a real
evidence node). Failing test first, always.

### 4.4 Where it surfaces (UI)
A "Runway" strip on Home and a "what-if" sheet in the workspace (Part 5). Guest
mode gets a lightweight client-only version (projection over the guest audit) so
the wow lands with zero login — consistent with the guest-first architecture.

---

## Part 5 — The UI/UX quality system (the "100× improvement" demand)

The concern raised — *"presentation and design and placement quality is worst …
fragile … nothing implemented properly … needs a huge upscale"* — is a **quality
system** problem, not a rewrite. We fix it with tokens, a component inventory, and
hard gates, not vibes. **The brand is fixed (invariant 0.2.2); we deepen it.**

### 5.1 The design foundation (make it a system, not per-screen guesses)
- **Tokens are law.** One source for color (graphite/gold), type (Fraunces
  display + the body pairing), spacing scale, radius, elevation, motion durations.
  Every component reads tokens — no hard-coded hex, no magic px. Audit for
  violations the way `claims:check` audits copy.
- **Motion respects `prefers-reduced-motion`** (the `reduced-motion.spec.ts`
  pattern already proves this) — every animation degrades to a still.
- **Nakul is a guide, not decoration** — restrained moments only (WOW-2), never
  blocking the task.

### 5.2 The component inventory (build once, reuse everywhere)
The fragility comes from bespoke one-off markup. Consolidate into a small,
tested set the whole app composes from:

| Component | Job | Quality bar |
| --- | --- | --- |
| `EvidenceChip` | show a citation, click → proof subgraph | keyboard-reachable, axe-clean, works in the pack + web |
| `LedgerRow` | one commitment: merchant, cadence, next debit, confidence, action | single implementation used by guest + workspace + detail sheet |
| `RenewalTimeline` | the 45-day → 12-month dated series (Twin) | virtualized if long; reduced-motion safe |
| `ActionCard` | keep/watch/downgrade/cancel/investigate + the cited narration | never renders an uncited claim (Part 3 guardrail) |
| `ProofPanel` | the confidence subgraph on click | pure read of proof-graph |
| `RunwayStrip` | Twin runway + what-if entry | user-entered inputs clearly labelled |
| `TrustSignal` | live readiness / attestation states | reads real `*_STATUS`, honest empty state |

Rule: **no new bespoke markup for a concept a component already covers.** New
concept → new component + test, then reuse.

### 5.3 The three-screen daily-use workspace (already shipped in surface-10)
Home (burn trend + renewal radar + proof chips + runway) → Subscriptions (ledger,
one-tap detail sheet) → Sources (connect + health). The `wp-*` commits and the
`docs/evidence/surface-10/` screenshots are the DoD reference. Extend, don't
re-invent.

### 5.4 The wow surfaces (leap-plan Part 3 is law — do not restate, execute)
WOW-1 (landing does the audit) → WOW-3 + WOW-5 in parallel → WOW-2 → WOW-4.
Sequencing and acceptance criteria are in
[leap-plan-2026-07-20.md](leap-plan-2026-07-20.md). The Twin `RunwayStrip` is a
natural WOW-1.5.

### 5.5 The quality gates that make "fragile" impossible to merge
Every UI PR must pass, or it does not merge:
- `axe` serious/critical = **0** (Playwright + `@axe-core/playwright`).
- **Perf budget holds** (`npm run perf:budget`; the 214.8 KB JS ceiling on
  `/`, `/app`, `/verify` is hard) and **Lighthouse ≥ 95**, mobile LCP < 2s.
- **`eslint-plugin-jsx-a11y` recommended set** on.
- A **named e2e spec** proving the journey, plus desktop+mobile screenshots
  appended to the PR (the surface-10 evidence pattern).
- **Reduced-motion** proven for anything animated.

100× quality is not a heroic redesign; it is: tokens + a reused component set +
these five gates, applied relentlessly.

---

## Part 6 — Testing, integration, API, and the gate wall

- **The merge gate chain** (invariant 0.2.5) + the signed-in e2e recipe in
  `.github/workflows/ci.yml`. `release:gate` orchestrates the full set.
- **Corpus gates** (the intelligence guarantee): `npm run corpus:strict` (≥100
  statements, ≥97% precision / ≥92% recall) and `npm run receipt-corpus:strict`
  (≥200 receipts, p95 < 5s). These wait on **real consented redacted fixtures**
  (founder gate 9) — engineering can't fake them.
- **The read-only Platform API** (`/api/v1/ledger`, `/api/v1/sources`, hashed
  expiring scoped tokens, OpenAPI contract) is the B2B/CA-console surface —
  keep it read-only until a separately reviewed mutation contract exists.
- **Integration truth:** every connector's honesty state is derived, not
  declared; `partner-rails:check` and `core-connectors:check` are the gates.
  Registry presence ≠ production access.

---

## Part 7 — The consolidated execution sequence (one ordered timeline)

This unifies the founder gates, the wow ladder, the AI layer, and the Twin into a
single sequence. **A phase closes on its metric, not on shipped code.** Each
item's deeper spec lives in the linked doc; this is the order and the owner.

### Phase 0 — Activate + validate (Weeks 0–2) — *the real critical path*
- **Founder (external, no code):** execute [founder-gate-runbook.md](founder-gate-runbook.md)
  gates 0→1 then 2–9 in parallel. Finish line: `npm run production:check -- <url> --beta` green.
- **Agents (code):** land open program work; finish the monolith-safe small-fixes
  queue; ship **WOW-1** (landing does the audit) — highest leverage in the repo.
- **Exit (G8):** gate chain green; **≥5 paid audits; ≥3 monitoring commitments;
  corpus ≥25 files.**
- **Stop condition:** if users won't pay after value is shown twice, halt build-out
  and rework the offer (gap-analysis stop/go). Nothing downstream fixes an unwanted
  product.

### Phase 1 — Proof economy + first AI (Weeks 2–8)
- **Agents:** WOW-3 + WOW-5 (parallel), then WOW-2; **Twin engine** (`src/lib/twin/*`
  + `RunwayStrip`); **AI job 1 (extraction assist)** behind the reconcile guardrail;
  durable backend migration (C1) behind a flag for new workspaces.
- **Founder:** Gmail verification lands → open Gmail to public; CA pilot (3
  accountants); connectors-real with true credentials.
- **Exit (G9):** ≥₹1L revenue; ≥10 verified savings minted; corpus ≥100; durable
  backend holds 100% of new workspaces with zero data-loss.

### Phase 2 — Living ledger + cited AI (Weeks 8–16)
- **Agents:** diff engine + auto-generated monthly review; entity-resolution v2;
  parser format registry (top 10 banks) with corpus CI gate; **AI job 2
  (ask-your-ledger over the query compiler)** on `/api/workspaces/current/ask`;
  price-hike radar v0.
- **Exit (G10):** ≥100 monitoring subscribers; D60 retention ≥60%; corpus
  precision ≥95% / recall ≥88%; ≥₹5L cumulative verified savings; review open
  rate ≥70%.

### Phase 3 — Rails, network, action AI (Months 4–9)
- **Agents:** **AI job 3 (action drafting + narration)** on the Action Center;
  merchant-intelligence network v1 (k-anonymous); SOC 2 Type I, pen test, envelope
  encryption.
- **Founder:** AA/TSP sandbox → production consent flow; PSP mandate-API partnership.
- **Exit (G11):** AA rail `production-live` with ≥100 real consents; ≥500
  subscribers; network facts ≥1,000 merchants; strict production check green 30 days.

### Phase 4 — Category king (Months 9–18)
White-label embed v1, public API, card-mandate rail, Price Index as a monthly
institution, SOC 2 Type II. **Exit (G12):** every scoreboard row green, re-scored
by someone incentivized to say no.

**The discipline in one line:** *validation and activation before rails, rails
before scale, truth before everything.* AI and the Twin ride *on top* of proven
engines — they never lead.

---

## Part 8 — Cost to first users (the money question, plainly)

**Pre-revenue monthly burn (beta, ~50 users):**

| Line | Choice | ~Monthly |
| --- | --- | --- |
| Hosting | Vercel Pro | ~$20 |
| Postgres | Neon/Supabase (free → small paid) | $0–25 |
| Email | Resend (free tier covers beta) | $0 |
| Monitoring | Sentry/Better Stack free tier | $0 |
| **AI** | Haiku + Opus, gated + capped (Part 3.3) | **<$5** |
| Domain | vognary.com (amortized) | ~$1 |
| **Total** | | **~$50–75/mo (~₹4k–6k)** |

**One-time / external (mostly time, not money):**
- Google restricted-scope (`gmail.readonly`) **CASA assessment** — the one line
  that can cost real money if you use a third-party assessor (budget for it);
  the OAuth app itself is free.
- Setu **FIU/TSP agreement** — no upfront fee, but real onboarding time.
- Razorpay **live KYC + legal review** of Terms/Privacy — KYC is free; qualified
  legal review is the cost.
- Redacted **corpus collection** — consented fixtures from your first audit
  customers (redaction tooling exists); time, not money.

**The headline:** you can run to first paying users on **~₹4–6k/month of infra +
AI**, capped so AI can never surprise-bill. The gating factors to first revenue
are **not cost** — they're the founder gates (approvals, legal, real consented
data) and the five paid audits. Spend agent-hours on WOW-1 and the AI/Twin
engines; spend founder-hours on the gate runbook. That combination — activation +
five paying audits + an AI that inherits the citation discipline — is a position
no one in the researched market can copy quickly.

---

## Part 9 — Anti-goals (never, at any score — from path-to-10 Part VI)

1. Never claim a connector above its proven honesty state (CI-enforced, forever).
2. Never store bank passwords / card numbers; never scrape SMS.
3. Never sell or cross-sell user financial data; the network is opt-in, merchant-
   level, k-anonymous, auditable.
4. **Never let an AI answer render without evidence citations.**
5. Never become a budgeting app, a lending funnel, or an enterprise procurement
   suite — the wedge is *recurring commitments, proven*.
6. Never ship an engine change without a failing test first; never regress the
   corpus.

---

*This file is the index. The scoreboard is [path-to-10.md](path-to-10.md); the
wow ladder is [leap-plan-2026-07-20.md](leap-plan-2026-07-20.md); the activation
gates are [founder-gate-runbook.md](founder-gate-runbook.md); the surfaces are
[product-architecture.md](product-architecture.md). Parts 3, 4, 5, 7, and 8 above
are owned here. Raise the lowest row. Cite or shut up.*
