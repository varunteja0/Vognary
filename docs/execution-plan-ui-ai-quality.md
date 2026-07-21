# Vognary — UI/UX Quality + AI Live-Path Execution Plan

> **Agents: read [THE-LAW.md](THE-LAW.md) first**, then
> [execution/phase-b-loop-shipping.md](execution/phase-b-loop-shipping.md) for
> company-ordered loop WPs. This file is the detailed WP-0…WP-6 UI/AI execution
> reference — not a competing company roadmap.
>
> Work packages (WP-0 … WP-6) in order; *parallel-safe* WPs can run in separate
> worktrees. Companion: [master-build-plan.md](master-build-plan.md) Parts 3 & 5.

---

## Context — why this work exists

`master-build-plan.md` **Part 5** specifies a UI/UX quality system ("the 100×
improvement demand") and **Part 3** specifies an AI "cite-or-shut-up" layer.
Grounding the repo against that spec:

- **The UI *infrastructure* is already decent** — an 894-line token system in
  `src/app/globals.css` (64 CSS custom properties: `--ink`, `--gold`, `--radius`,
  `--shadow`, `--ease`), `eslint-plugin-jsx-a11y` recommended set on, `axe`
  asserted across 9 Playwright e2e specs, Lighthouse + perf budgets in CI.
- **Three Part-5 pieces were never executed** — this is the felt "worst":
  1. **No token-enforcement gate** — hard-coded hex still slips into `.tsx`
     (`page.tsx`, `command-palette.tsx`, `character.tsx`, heavily in the monolith).
     Part 5.1 demands "audit for violations the way `claims:check` audits copy."
  2. **No extracted component inventory** — Part 5.2's set (EvidenceChip,
     LedgerRow, ActionCard, ProofPanel, TrustSignal, RenewalTimeline, RunwayStrip)
     is bespoke, duplicated markup across `page.tsx`, `guest-audit-client.tsx`,
     and the **281 KB** monolith `src/app/vognary-mvp-client.tsx` (62 inline
     `style={{}}`, hard-coded hex). This duplication *is* the fragility.
  3. **The AI live path** — the tested spine is on `main` (`src/lib/server/ai/*`
     incl. `extract.ts`/`narrate.ts`/`pricing.ts`/`models.ts`), but no route wires
     it and no live budget counter exists.

**Founder decision:** full sweep (front door **+** daily workspace **+** monolith
cleanup) **and** wire the live AI. Deliver the quality leap the Part-5 way —
*tokens + a reused component set + hard gates, applied to every surface* — not a
heroic per-screen redesign.

## Invariants (master-build-plan Part 0.2 — non-negotiable, every WP)

1. **Isolated worktree per WP**, cut from the freshest committed `main`. **Do not
   stack PRs on top of each other** — merge to `main` and rebase. (Stacked PRs
   merged into already-merged bases stranded RunwayStrip + the AI live layer off
   `main` once; re-landed by cherry-pick. Target `main` directly.)
2. **Brand is fixed**: Nakul mongoose, Fraunces display, graphite/gold. New
   color/type/spacing must be a *token*, never a literal.
3. **Honesty is machine-enforced**: `scripts/check-public-claims.mjs` stays green;
   merchants are *watched*, sources *connected*; nothing claims above `*_STATUS`.
4. **Minimum-row scoring**: before building, ask "does this raise the lowest row?"
5. **No engine change without a failing test first.** Gate chain:
   `lint && typecheck && claims:check && test`, then `build && perf:budget`.
6. **`AGENTS.md`: modified Next.js.** Read `node_modules/next/dist/docs/` before
   any route/server-component code (esp. WP-5).

## Local-validation trap

An **untracked** `Vognary-gate-trust/` dir in the repo root holds a built
`.next/`; bare `eslint` crawls it → ~2,135 false errors, so `npm run ci` fails
**locally** on a clean branch. Not on any branch → real CI is fine. Validate with
`npx eslint --ignore-pattern 'Vognary-gate-trust/**'`, or remove the dir (confirm
with founder — destructive).

---

## WP-0 — Land the intended state on `main` (prerequisite) · DONE via re-land

RunwayStrip (was PR #7) and the AI live layer + Sonnet-5 cost decision (was PR #8)
were merged into already-merged base branches and never reached `main`; they were
re-landed by cherry-pick (`fix/reland-stranded-ui-ai`). **DoD:** `src/app/runway-strip.tsx`,
`src/lib/server/ai/{models,pricing,extract,narrate}.ts` on `main`;
`AI_MODELS.reasoning === "claude-sonnet-5"`; gate chain green.

## WP-1 — Token-enforcement gate (Part 5.1) · *parallel-safe* · small

Model on `scripts/check-public-claims.mjs`.
- **New:** `scripts/check-design-tokens.mjs` — scan `src/**/*.tsx`; **fail** on
  raw hex (`#[0-9a-fA-F]{3,8}`) and `style={{…}}` color/spacing literals. Allow
  `globals.css`, OG/PWA/icon files (`apple-icon*`, `opengraph-image`,
  `twitter-image`, `icon.tsx`, `brand.tsx` mark geometry). Emit file:line list.
- **New script:** `"tokens:check"`; insert into `ci` after `brand:check`.
- **Burn-down:** replace hex with `var(--token)` / the design-system class; legacy
  literals go in an explicit `KNOWN_EXCEPTIONS` array with `// TODO(WP-4)` notes.
- **Failing-test-first:** `tests/design-tokens-gate.test.ts` (hex fixture fails,
  token fixture passes).

## WP-2 — Shared component inventory (Part 5.2) · blocks WP-3/WP-4 · medium

Extract the Part-5.2 set as **single, tested, token-only** components in
`src/app/components/` (barrel `index.ts`). **Reuse existing classes** (`.panel`,
`.lift`, `.btn*`, `.stamp*`, `.seg-*`, `.pill-*`, `.field*`, `.ledger-row`,
`.spectrum-*`, `.folio`, `.eyebrow`, `.tnum`, `.live-dot`) and formatters
(`formatMoney`/`formatShortDate` from `@/lib/format`; types from
`@/lib/recurring-audit`, `@/lib/renewal-timeline`, `@/lib/proof-graph-store`).

| Component | Extract from | Job |
| --- | --- | --- |
| `LedgerRow` | `.ledger-row` + bespoke rows | one commitment: merchant, cadence, next debit, confidence, action |
| `EvidenceChip` | monolith `ProofDisclosure` | citation → opens `ProofPanel` |
| `ActionCard` | `.stamp-*` + `SelectedItemPanel`/`PriorityActionPanel` | keep/watch/downgrade/cancel/investigate + **cited** narration (never uncited) |
| `ProofPanel` | `ProofDisclosure`/`ProofGraphPanel` | confidence subgraph; pure read |
| `TrustSignal` | `ReadinessPanel`/`StatusRow` | live `*_STATUS`; honest empty state |
| `RenewalTimeline` | `RenewalTimelinePanel` (~4039) | 45-day → 12-month series; reduced-motion safe |
| `RunwayStrip` | `src/app/runway-strip.tsx` | **move** into `components/`; user-entered inputs labelled |

Each: props-only, token-only, keyboard-reachable, `aria`-correct, reduced-motion
safe, one unit test. **Rule:** no new bespoke markup for a covered concept.

## WP-3 — Front-door refactor + polish (Part 5.3/5.4) · after WP-2 · medium

`src/app/page.tsx`, `src/app/guest-audit-client.tsx` (`/app` via
`src/app/app/experience-client.tsx`), `src/app/instant-audit.tsx` compose from
WP-2 components; token-driven visual rhythm + hierarchy; one restrained Nakul
moment. **DoD:** axe 0, perf budget (214.8 KB on `/`, `/app`), Lighthouse ≥ 95 /
LCP < 2s, reduced-motion proven, named e2e + desktop & mobile screenshots on PR.

## WP-4 — Signed-in workspace decomposition + tokenization (Part 5.3) · big · sub-PRs

Decompose `src/app/vognary-mvp-client.tsx` into `src/app/workspace/*`, one
component per commit, props-only, using WP-2 components, killing inline styles/hex.
- **4a Home/Overview:** `OverviewPanel` (~3350), `RecurringGraph` (~3869),
  `RenewalRadar` (~3954), `SpendSpectrum` (~4989), `Metric`/`MiniStat`.
- **4b Subscriptions:** `SubscriptionDetailSheet` (~4182), `SelectedItemPanel`
  (~4326), `PriorityActionPanel` (~4122).
- **4c Sources:** `IntegrationCommandCenter` (~2740), `RailCard` (~2899),
  `ReadinessPanel` (~4962), `StatusRow` (~5124).
- **4d Proof/Ask/Savings:** `AskProofPanel` (~3629), `ProofGraphPanel` (~4918),
  `VerifiedSavingsPanel` (~4785), `ProofDisclosure` (~3312).
- **Per sub-PR DoD:** token gate green, axe 0, perf budget, e2e + before/after
  screenshots. Behavior identical — existing specs (`sample-workspace.spec.ts`,
  `canonical-journeys.spec.ts`, `signed-in-first-value.spec.ts`) stay green.

## WP-5 — AI live path (Part 3) · needs founder key · after WP-2

Read `node_modules/next/dist/docs/` first.
- **New:** `src/lib/server/ai/compile.ts` — question → `{queryId, params}` over
  `src/lib/proof-questions.ts` (structured-output enum); failing-test-first with a
  mock client (mirror `tests/ai-live-layer.test.ts`).
- **Routes:** `/api/workspaces/current/ask` → `compile.ts` + deterministic
  executor; `/api/ingest` fallback → `extract.ts` (parser first). Narration
  (`narrate.ts`) in the Action Center via a streamed route. `getAiClient()` is
  called in the route and injected into the pure functions (DI contract).
- **Live budget:** back `budget.ts` with `src/lib/rate-limit.ts` Postgres buckets;
  over cap → deterministic fallback.
- **Fail-closed:** no key / over budget / uncitable → deterministic + honest "AI
  unavailable." **Founder inputs:** `ANTHROPIC_API_KEY` + monthly ₹ cap.

## WP-6 — Seal the gates as the merge wall (Part 5.5)

Every UI PR passes: token gate, axe 0, perf budget, Lighthouse ≥ 95 / LCP < 2s,
jsx-a11y, reduced-motion, named e2e + screenshots. Add `tokens:check` to
`release:gate` / required checks.

---

## Sequencing

```
WP-0 (done) → WP-1 (parallel-safe) + WP-2 (blocks WP-3/4)
                                       ├── WP-3 front door (chat A)
                                       ├── WP-4a..d workspace (chat B)
                                       └── WP-5 AI routes, needs key (chat C)
WP-6 seals gates last.
```

## Verification

1. **Gate chain:** `npx eslint --ignore-pattern 'Vognary-gate-trust/**'` then
   `npm run typecheck && npm run claims:check && npm run tokens:check && npm test
   && npm run build && npm run perf:budget`. Clear `DATABASE_URL` for local smoke;
   tests run via `tsx` under `--conditions=react-server`.
2. **Browser proof (WP-3/4):** Browser pane `preview_start` (never a raw
   dev-server shell), load `/` and `/app`, "Load sample", check console + network,
   capture desktop + mobile screenshots, verify a11y with `read_page`.
3. **AI (WP-5):** unit tests with a mock client (no live API in CI); confirm the
   degrade path with `ANTHROPIC_API_KEY` unset returns the deterministic result.
