# Vognary Surface 10/10 — Orchestration Plan

Date: 2026-07-17 · Status: adopted execution layer.
This document is the **agent-facing execution plan** that raises every product surface to 10/10. It plugs into [path-to-10.md](path-to-10.md) (the company-level master plan; minimum-row scoring; the Five Leaps) — this plan raises the **Product UX** and **Live connector depth** rows. Any agent can open this file cold, pick an unclaimed work package (WP), and ship it.

---

## Part I — The soul of the product (read before any WP)

A technically-naive person opens Vognary and, within minutes, sees **every subscription and recurring payment they have, live** — what it costs monthly, what renews next, what exceeds their budget, and what to cut. They never see the words API, CSV, key, token, or redirect URI. They click, they approve on a provider's own page, data flows. Daily use is: glance at burn → check what renews → act on one suggestion.

Everything below serves that loop. Any feature that does not serve it is out of scope for this plan.

## Part II — Agent Operating Protocol (AOP)

Every agent working a WP follows these rules. They are enforced by CI where possible.

1. **Ground truth:** `unset DATABASE_URL; npm run ci` must be green before any commit (lint + claims + research + brand + 331+ tests + build). Node 20, tsx test runner.
2. **UI proof:** changes to anything a user sees require a real-browser check. Harness:
   - Local stack: Docker postgres on `55433` (`postgres`/`vognary_ci`, db `vognary_dev`, `npm run db:apply-schema`), dev server via `.claude/launch.json` (`vognary-dev`, port 3005, dev login `founder@vognary.test` / `local-dev-code-123`).
   - Signed-in end-to-end proof: `PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3005 VOGNARY_E2E_DEV_LOGIN_EMAIL=founder@vognary.test VOGNARY_E2E_DEV_LOGIN_CODE=local-dev-code-123 npm run test:e2e -- signed-in-first-value`
   - The embedded preview pane does not hydrate this app — always verify through Playwright or a real browser.
3. **Honesty is law:** never write UI copy that claims more than the proven connector state. `npm run claims:check` and `tests/connect-rails.test.ts` enforce the taxonomy. Merchant tiles are **watches**, never "links"; rails "can supply" evidence. Consumer surfaces never show env-var names, redirect URIs, or credential inputs (tests enforce).
4. **Brand is fixed:** Nakul the mongoose + Fraunces display + graphite/gold. Deepen it; never swap it. Consumer surfaces may soften the dossier prose, not the identity.
5. **Code idioms:** route handlers use `params: Promise<…>`, `readLimitedJson`, `rejectCrossSiteMutation` (+ register new mutation routes in `tests/request-security.test.ts`); effects use `queueMicrotask` for state resets; heavy libs (jspdf/xlsx) stay lazily imported.
6. **Scope discipline:** one WP per branch/commit series; commit message prefix `wp(<id>):`. If a WP reveals a bug outside its scope, file it in `docs/surface-10-worklog.md` (create on first use) instead of expanding scope.
7. **No AI in the core loop** (decision of record): deterministic parsing + structured rail data only. AI may appear later solely as a fallback receipt parser or query helper — never as the source of a financial number shown to a user.

## Part III — Scoreboard and exit criteria

Score = the **minimum** row, per path-to-10 discipline.

| Surface | Now | 10/10 exit criterion (measurable) |
| --- | ---: | --- |
| Landing | 7 | LCP < 2.0s mid-range mobile; one primary CTA above fold; interactive sample audit reachable in 1 click; Lighthouse ≥ 95 across categories. |
| First-run | 7 | Paste→result < 5s for ≥95% of a 200+ real-receipt corpus (precision gate in CI); "Try a sample audit" path < 10s to full ledger; time-to-first-insight < 60s. |
| Connect | 2 | Both rails `available` and completing a real first sync (needs founder gates G-A/G-B); first-sync moment implemented; every tile shows live matched evidence counts; reconnect health visible. |
| Workspace | 5 | Three-screen IA (Home / Subscriptions / Connect); every number click-traces to its proof; budgets + suggested cuts live; zero empty states without exactly one action; < 3 min landing→proven ledger. |
| Mobile | 6 | Full parity with desktop loop; PWA installable with prompt; touch targets ≥ 44px; axe clean on all five screens. |
| Backend feel | 7 | First sync < 30s post-consent; freshness surfaced everywhere; weekly digest + price-change alerts shipping. |

## Part IV — Phases and work packages

Effort: S (≤half day) · M (≤2 days) · L (≤1 week). Lanes may run in parallel; gates (G-*) are founder-only.

### Execution snapshot — 2026-07-17

The first implementation tranche is in the working tree and browser-proved. Completed packages are marked ✅ below. Partial packages stay unmarked even when a substantial slice has shipped; this prevents the plan from awarding itself a score it has not measured.

- **Proved now:** hydration-safe encrypted workspace restore; three-screen IA; subscription detail sheet (one-tap proof + decision + cancel-guide); budget persistence; deterministic suggested cuts; price-change/budget chips; advanced-import demotion; counted guest handoff; install prompt; AA return polling + first-sync reveal; serious/critical axe checks on Home, Subscriptions, Connect, Login, Landing, and the open detail sheet.
- **Harness proof (verified 2026-07-18):** full `npm run ci` green, exit 0 — lint, claims/research/brand checks, 337 unit tests, and a clean production `build` (type-checked); signed-in desktop + mobile core-loop spec; guest first-value/sample round-trip spec; tracked screenshots in `docs/evidence/surface-10/`. See the 2026-07-18 worklog entry for the build-gap fix.
- **Code-owned packages completed 2026-07-19:** progressive signed-in onboarding (WP-2.1), task empty states (WP-0.4), prose disclosures (WP-1.4), weekly digest (WP-3.3), generated iOS startup images (WP-5.5), and aggregate proof coverage across Subscriptions/Review/Data (WP-6.3). See the newest worklog entry and [public-launch-final-checklist.md](public-launch-final-checklist.md).
- **Still required before the scoreboard can read 10:** the private ≥100 real-statement and ≥200 real-receipt quality gates, production Gmail/Setu approval and canaries, production payment/email/cron/monitoring/backup attestations, and the release canary. These are evidence/external gates rather than unimplemented code.
- **External boundary:** G-A, G-B, and G-C require the founder/provider/legal actions described below. Code and mocked proof cannot honestly substitute for production approval or real financial data.

### Phase 0 — Core-loop integrity (Lane B) — *mostly done*

- **WP-0.1 ✅ Month-name date parsing** (`loose-date.ts`, `receipt-parser.ts` + tests). Shipped 2026-07-17; commit if still in working tree.
- **WP-0.2 (M, partial) Receipt corpus expansion.** Collect ≥50 real receipt/renewal formats (Netflix, Spotify, Apple, Google Play/One, Prime, Hotstar, ChatGPT, Claude, Jio, Airtel, LIC, EMI pre-debit SMS/email texts; EN-IN). Add to `tests/receipt-parser.test.ts` + statement corpus. DoD: every format parses or is a documented, justified rejection; `npm run corpus:strict` green.
  - **Receipt half advanced 2026-07-18:** real-format coverage across the merchant list plus an `inferCategory` bug fix (JioHotstar/Hotstar/Amazon Prime/Prime Video were miscategorized); documented justified rejections for bare telecom bills and loan EMIs. See worklog.
  - **Blocked (data gate, not code):** `corpus:strict` needs ≥100 `consented-redacted-real` statement fixtures with opaque consent references and clean redaction. This is real-data collection (same class as G-A/G-B) and cannot be honestly force-greened with synthetic fixtures. Package stays partial until that data exists.
- **WP-0.3 ✅ Signed-in e2e harness** (`tests/e2e/signed-in-first-value.spec.ts`, env-guarded).
- **WP-0.4 ✅ Empty-state audit.** Primary task panels use one sentence + exactly one action; non-task “nothing changed” evidence remains informational rather than pretending to need an action. Browser-proved in the onboarding/sample journey 2026-07-19.

### Phase 1 — The three-screen product (Lane A)

- **WP-1.1 ✅ IA restructure.** Sidebar/bottom-nav becomes **Home · Subscriptions · Connect** (+ "More" holding Review/Data, hidden until data exists). Sections keep their ids for deep links. DoD: signed-in walkthrough screenshots; a first-time user sees exactly three destinations.
- **WP-1.2 ✅ Home screen.** Cards: Monthly burn with a since-last-review delta, Renews next with countdown, budget status, one suggested action, and alerts for imminent renewal, price movement, and source health. Browser-proved on desktop + mobile; the last trend criterion shipped 2026-07-18.
- **WP-1.3 ✅ Subscriptions screen.** Card list (logo-letter, name, ₹/mo, cadence, next date, confidence chip) sortable by cost/next-renewal; tapping opens a detail sheet: proof evidence, history, actions (Keep / Watch / Cancel-guide with the existing cancel actions). Detail sheet reachable in one tap from Home or Subscriptions; proven on desktop + mobile with an axe check on the open sheet (2026-07-18 worklog).
- **WP-1.4 ✅ Prose cull.** Consumer panel explanations now sit behind compact “How this works” disclosures; the chosen Connect dashboard copy was reduced to consent/revocability essentials. Brand stays visible; essays no longer lead the task.

### Phase 2 — Onboarding that converts (Lane A, after WP-1.1)

- **WP-2.1 ✅ One-screen onboarding.** Signed-out /app and post-signup: three progressive buttons only — **Connect Gmail**, **Paste receipts**, **See a sample audit**. The rich connection/capture surfaces reveal only after a choice or real evidence. DoD browser-proved desktop+mobile 2026-07-19 with zero CSV/statement/API/key terms in the Connect onboarding.
- **WP-2.2 ✅ Sample audit mode.** One click seeds a clearly-labelled demo workspace (8–10 realistic INR subscriptions, banner "Sample data — clear anytime", one-click clear). Full product explorable without any input. DoD: sample→clear round-trip in harness; claims-safe labelling. Shipped 2026-07-19: signed-in "See a sample audit" seeds the shared eight-subscription dataset (`src/lib/sample-audit.ts`, identical to guest), content-derived sample banner, one-tap clear; isolated `sample-workspace.spec.ts` green desktop+mobile. See worklog.
- **WP-2.3 ✅ Demote file import.** Statement/CSV/PDF upload moves to Data → "Advanced import". First-run surfaces never show it.
- **WP-2.4 ✅ Guest→sign-in continuity hardening.** The existing transfer works; add explicit post-signin toast with counts ("3 commitments carried into your encrypted workspace") and harness assertion.

### Phase 3 — Daily-use engine (Lane B, parallel with Phase 1)

- **WP-3.1 ✅ Budgets.** Monthly total + per-category caps stored in workspace state (extend `WorkspaceBackup`, restore paths, and server snapshot exactly as `merchantLinks` was). Over-budget renders amber on Home and on offending subscription cards. No new tables.
- **WP-3.2 ✅ Suggested cuts.** Rank = monthly cost × weak-proof × watch/investigate status × price-rise flag. Top 3 as Home card with cancel-guide links. Pure client computation over existing audit data.
- **WP-3.3 ✅ Alerts in-app + weekly digest.** Separate explicit digest toggle, consent lifecycle, Monday/local-hour schedule, empty-ledger suppression, privacy-minimized delivery rows, INR/foreign-safe content, bounded retries, readiness/privacy export coverage, and PostgreSQL integration proof shipped 2026-07-19. Production sent-message evidence remains an operator gate.
- **WP-3.4 ✅ Price-change chips.** Evidence normalizer already retains amounts; when latest amount > previous for same identity, show "↑ was ₹499" chip on the subscription card + alert entry.

### Phase 4 — Rails go live (Lane C = founder gates + Lane B code)

- **G-A (founder, 1–2h + review time):** Submit Google restricted-scope verification for `gmail.readonly`; add up to 100 test users immediately. Unblocks real Gmail one-click for beta today.
- **G-B (founder, ~30 min):** Setu Bridge sandbox: product instance + `SETU_AA_CLIENT_ID/SECRET/PRODUCT_INSTANCE_ID` + `ACCOUNT_AGGREGATOR_PARTNER_STATUS=sandbox-approved`. Bank rail becomes demo-real same day.
- **G-C (founder, 4–10 weeks):** FIU/regulated-partner agreement per [one-click-connect-plan.md](one-click-connect-plan.md) and [direct-linking-activation-dossier.md](direct-linking-activation-dossier.md). Sets `production-live`.
- **WP-4.1 (M, code-complete; live proof waits on G-A/G-B) First-sync magic moment.** After OAuth/AA return, an import summary takes over: Nakul animation, "Found 14 recurring payments · ₹4,230/mo", top merchants reveal, then lands on Home. This is the single highest-emotion moment in the product — make it excellent.
- **WP-4.2 (S, code-complete; live proof waits on G-B) AA return flow.** Handle `/app?aa=returned`: poll connector status, show pending→active transition toast, trigger WP-4.1 on activation.
- **WP-4.3 ✅ Source health chips.** Freshness/reconnect states use one shared presentation across `/sources`, Connect, and named Home alerts with a direct Review sources action. Shipped and browser-proved on desktop + mobile 2026-07-18.

### Phase 5 — God-level polish (Lane D, after Phase 1 lands)

- **WP-5.1 (M, visible goal met) Alignment & spacing audit.** 8px grid; unify border radii/padding tokens across every card in `globals.css` + panels; fix every misaligned margin (the current #1 visual complaint). DoD: before/after full-page screenshots, desktop + mobile.
  - **Assessed 2026-07-18 against the live signed-in stack:** the three primary screens (Home, Subscriptions, Connect) render with consistent card padding, aligned grids, and coherent radii — the misalignment complaint predates the three-screen IA + polish already shipped (WP-1.1/1.2/1.3). Evidence: current `wp-1.2-home-*` and `wp-1.3-subscriptions-*` screenshots. Remaining token-level unification (collapsing `p-4`/`p-5`/`p-6` to one scale) is a subjective refactor deferred to avoid flattening intentional card/panel/modal density hierarchy; best done with design judgment, not an autonomous sweep.
- **WP-5.2 ✅ Motion.** Shared timing/easing tokens, fail-open reveals, and programmatic/CSS scrolling that becomes instant under `prefers-reduced-motion`. Browser-proved on desktop + mobile 2026-07-18.
- **WP-5.3 ✅ Accessibility.** `@axe-core/playwright` clean on Home/Subscriptions/Connect/Login/Landing; visible focus states; keyboard-complete flows.
- **WP-5.4 ✅ Performance.** Mobile LCP < 2s on landing/app/verify (881/767/735ms medians), Lighthouse ≥ 95 across every enforced category, `jspdf`/`xlsx` verified lazy and absent from initial route assets. Fonts moved to `display: optional` with preloads removed; `experimental.inlineCss` enabled; verify entrance animation dropped. Two CI budget scripts (`perf:budget`, `perf:lighthouse`, three-sample DevTools-throttled medians) gate `npm run ci` and GitHub CI. Shipped 2026-07-18; see worklog.
- **WP-5.5 (M, DoD met) Mobile + PWA.** Bottom-nav parity for new IA; install prompt after first proven ledger; icon/splash polish.
  - **Completed 2026-07-19:** `appleWebApp.startupImage` now maps representative iPhone/iPad media queries to five statically generated branded PNG routes; the production build prerenders every size.

### Phase 6 — The innovation layer (Lane A/B, staggered; maps to path-to-10 Leaps)

- **WP-6.1 ✅ Renewal Radar.** The 45-day projected-debit timeline is Home's hero visual: a horizontal radar of upcoming debits sized by amount with 44px touch targets and one-tap proof detail. Shipped and browser-proved on desktop + mobile 2026-07-18.
- **WP-6.2 ✅ Verified-savings growth loop.** Verified outcomes auto-prepare a receipt; one Share proof action sends the card and sealed JSON receipt through Web Share with download/copy fallbacks. Shipped and browser-proved on desktop + mobile 2026-07-18.
- **WP-6.3 ✅ Proof-chip everywhere.** Aggregate money figures disclose their exact composing commitments/events; per-item figures open the existing proof detail; header and Connect aggregates route directly to Subscriptions. Browser proof added to the desktop/mobile sample journey 2026-07-19.
- **WP-6.4 ✅ Nakul moments.** A prioritized first-sync/savings/budget/evidence state machine with persistent event suppression and one moment per session. Shipped and browser-proved on desktop + mobile 2026-07-18.

## Part V — Orchestration map

```
Lane A (product UI):    WP-1.1 → WP-1.2 → WP-1.3 → WP-1.4 → WP-2.1 → WP-2.2 → WP-2.3 → WP-2.4 → WP-6.1 → WP-6.4
Lane B (engine/data):   WP-0.2 → WP-0.4 → WP-3.1 → WP-3.2 → WP-3.4 → WP-3.3 → WP-4.1 → WP-4.2 → WP-4.3 → WP-6.2 → WP-6.3
Lane C (founder gates): G-A (today) · G-B (today) · G-C (start today, lands in weeks)
Lane D (polish):        after WP-1.x: WP-5.1 → WP-5.3 → WP-5.4 → WP-5.2 → WP-5.5
```

Rules: Lanes A and B run in parallel. Phase 5 starts only after WP-1.1 lands (no polishing a layout that is about to change). WP-4.1/4.2 are code-complete against sandbox (G-B) and simply light up when G-C lands. Nothing in any lane waits on G-C except production bank data itself.

## Part VI — Definition of Done (every WP)

1. `unset DATABASE_URL; npm run ci` green.
2. UI WPs: signed-in harness spec passes; screenshots (desktop + 390px mobile) attached to the worklog entry.
3. New mutation routes registered in the CSRF inventory; new consumer copy passes `claims:check`.
4. Worklog entry in `docs/surface-10-worklog.md`: WP id, what shipped, proof, follow-ups.
5. Commit(s) prefixed `wp(<id>):`.

---

**Sequence for the very first agent picking this up:** commit WP-0.1 if uncommitted → WP-0.4 (fast win) → start WP-1.1. Founder starts G-A and G-B the same day. That combination alone moves the minimum row from 2 to ~6; the rest of the plan takes it to 10.
