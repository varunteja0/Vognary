# Surface 10/10 Worklog

Append-only log per [surface-10-orchestration-plan.md](surface-10-orchestration-plan.md) Part VI. Newest first.

## 2026-07-19 — Launch-plan implementation tranche

**Product:** empty signed-in workspaces now route to a strict progressive three-choice onboarding (Connect Gmail, Paste receipts, See a sample audit). The source dashboard and guided capture render only after the matching choice or real evidence exists. Consumer-panel explanations moved behind compact “How this works” disclosures; primary task empty states now use one sentence and one action.

**Proof visibility:** aggregate proof disclosures now cover subscription monthly/yearly/review totals, 10-day counts, radar/timeline windows, verified savings, review deltas, and proof-graph totals. Header/Connect aggregates route directly to Subscriptions, and Review per-item money opens the existing proof detail sheet.

**Weekly digest:** migration `0022_weekly_digest` adds a separate default-off toggle and privacy-minimized one-row-per-week delivery state. The existing worker now schedules local-Monday digests, skips empty ledgers, resolves financial content only after claim, applies bounded retries/idempotency, and sends INR burn + separated foreign totals + next-seven-day exposure + one deterministic INR suggestion. Preferences, consent lifecycle, Profile UI, privacy export, readiness, unit tests, and PostgreSQL integration coverage are in lockstep.

**Quality/launch gates:** added an ignored private 200-real-receipt corpus evaluator (97% precision, 92% recall, p95 <5s) alongside the existing 100-statement gate. Production readiness now has a public core-connector boundary (verified Gmail + production AA), while the AA/UPI/card full-moat check remains separate. PWA metadata now serves five generated iOS startup images.

**Proof:** full `npm run ci` green: lint, typecheck, claims/research/brand checks, 347/347 unit tests, Next 16.2.10 production build, bundle budgets, and Lighthouse medians (landing 1029ms/97 performance/96 accessibility; app 803ms/100/100; verify 752ms/100/100). A fresh PostgreSQL schema applied through 0022 and the complete integration suite passed 26/26, including the weekly digest; the runner now force-exits cleanly and billing provider IDs are unique so the gate also passes on a reused database. `sample-workspace` is green desktop+mobile with onboarding/proof/axe assertions; `signed-in-first-value` is green desktop+mobile. The strict launch boundary currently reports the expected missing production Gmail/Setu approval and credentials, while both private corpora report `collection-required` at 0 real fixtures; those evidence/provider gates remain intentionally red until real evidence exists.

## 2026-07-19 — WP-2.2 shipped: signed-in sample workspace

**Shipped:** a signed-in user with an empty workspace can now explore the whole product without typing anything. The empty-workspace onboarding (Connect) offers **"See a sample audit"**, which seeds eight realistic INR subscriptions (ChatGPT, Notion, Netflix, Spotify, Google One, Canva, Amazon Prime, Adobe). A persistent **"Sample data — these eight subscriptions are a demo, not your evidence… clear anytime"** banner shows while the sample is loaded, with a one-tap **Clear sample**. Home, the Renewal Radar, Subscriptions, proof chips, budgets, and suggested cuts all populate from the demo exactly as they would from real evidence.

**Design — zero new persistence surface:** the eight-subscription dataset moved to a shared `src/lib/sample-audit.ts` so the signed-out guest and the signed-in seed use the *identical* data (guest `guest-audit-client.tsx` now imports it). "Sample mode" is **content-derived** — `sampleWorkspace = no real statements/manual items && receiptText === the shared sample` — so the banner survives reload and clears cleanly through the existing `receiptText` sync path. No change to the encrypted `WorkspaceBackup` schema, its restore path, or the server snapshot; the sample rides machinery that is already tested.

**Proof:** new isolated `tests/e2e/sample-workspace.spec.ts` green on desktop Chromium (7.4s) and mobile Chromium (8.7s) against the live Docker/Postgres stack — signs in to an empty workspace, seeds the sample (asserts the banner + a populated Home + Netflix/Spotify in the ledger, serious/critical axe empty), then clears (asserts Home returns to its empty state and the seed remains reachable from Connect). The self-heal step keeps the two serialized projects isolated on the shared founder workspace. Guest `first-value-path` still 5/5 (including the existing sample-audit labelling test), proving the shared-const refactor is safe. Full `unset DATABASE_URL; npm run ci` green (346 unit tests, typecheck, claims/research/brand, build, perf). Evidence: [sample desktop](evidence/surface-10/wp-2.2-sample-desktop-chromium.png), [sample mobile](evidence/surface-10/wp-2.2-sample-mobile-chromium.png).

**Claims-safe:** the banner and seed copy state plainly that the data is a demo, not the user's evidence, satisfying the honesty taxonomy; nothing in sample mode claims a connected source or proven live data.

## 2026-07-18 — WP-6.3 (Home slice): proof chips on aggregate ₹ figures

**Shipped:** the Home aggregate figures that previously had **no proof trace** now carry a tappable proof chip. "Due in 30 days" and "Verified savings" are sums with no single detail sheet to open, so a new `ProofDisclosure` chip reveals the exact evidence rows composing each number — projected debits (merchant · amount · date) for the renewal total, and tracked decisions (merchant · status · ₹/yr) for verified savings. This closes the Workspace exit-criterion gap ("every number click-traces to its proof") for Home's aggregates; per-item figures already trace through the WP-1.3 detail sheet, and "Monthly burn" taps through to the full Subscriptions ledger.

**Accessibility:** the chip is a proper disclosure — `aria-expanded` conveys state, `aria-controls` points at the evidence list, and the visible label ("Proof" ↔ "Hide proof") is the accessible name, satisfying WCAG Label-in-Name. The Home axe scan (serious/critical) stays empty with the chip present.

**Proof:** signed-in harness green on desktop Chromium (20.1s) and mobile Chromium (19.3s) against the live Docker/Postgres stack — taps the "Due in 30 days" proof chip, asserts `aria-expanded` false→true, and confirms the revealed list shows the exact debits (Spotify ₹119 · 2026-08-05, Netflix ₹649 · 2026-08-16) composing ₹768. Full `unset DATABASE_URL; npm run ci` green (346 unit tests, typecheck, claims/research/brand, build, perf budgets + Lighthouse medians unchanged — the change is behind auth and not on a perf route). Evidence: [proof chip desktop](evidence/surface-10/wp-6.3-proof-chip-desktop-chromium.png), [proof chip mobile](evidence/surface-10/wp-6.3-proof-chip-mobile-chromium.png).

**Scope honesty:** this is the Home slice of WP-6.3. Home aggregates now trace; the broader "every ₹ figure across Subscriptions/Review" sweep (where per-item figures already open detail sheets) is a follow-up before the package is marked ✅.

## 2026-07-18 — WP-0.2 (partial): receipt-parser category fix + real-format coverage

**Shipped (receipt half):** the pasted-receipt parser now categorizes India's streaming services correctly and carries locked-in coverage across the WP-0.2 merchant list. Three focused tests assert exact merchant/currency/amount/frequency/category/next-date for JioHotstar, Hotstar, Amazon Prime, Prime Video, Jio telecom, LIC, Apple iCloud+, Anthropic/Claude, GitHub, Adobe, and Airtel postpaid, plus two documented justified rejections (a bare telecom bill with no cadence; a loan EMI pre-debit).

**Bug fixed:** `inferCategory` (`src/lib/receipt-parser.ts`) matched merchants by naive substring, so "JioHotstar" hit the "Jio" telecom branch and was filed under **Utilities** instead of Streaming — miscategorizing a streaming service into the wrong budget bucket and skewing suggested-cut ranking. Hotstar, Amazon Prime, and Prime Video fell through to "Other" for the same reason. The Streaming branch now lists these services and is ordered before Utilities, so "JioHotstar" matches Streaming via the "Hotstar" substring while bare "Jio" telecom still resolves to Utilities. Verified empirically before and after the change. The rest of the app already resolved JioHotstar→Hotstar correctly (`merchant-normalize`), so this closes a parser-only inconsistency.

**Honesty boundary — why this is partial, not ✅:** WP-0.2's DoD includes `npm run corpus:strict green`. That gate (`scripts/check-statement-corpus.ts`) only activates at **≥100 `consented-redacted-real` statement fixtures**, each requiring an opaque `consent-…` reference and passing a redaction check that throws on any surviving identifier. It cannot be made green with synthetic data, and fabricating "consented-real" fixtures with forged consent references would forge the exact provenance chain the product's trust rests on. Real consented-redacted statement collection is a data gate (same class as G-A/G-B), not a coding task. This slice advances the receipt-format half honestly; the statement-corpus quality gate remains open pending real consented data.

**Proof:** `unset DATABASE_URL; npm run ci` green, exit 0 — lint, typecheck, claims/research/brand, 346/346 unit tests (was 343; +3), production build, perf budgets, and Lighthouse medians (/ 878ms 99/96/100/100, /app 760ms 100/100/100, /verify 749ms 100/100/100/100 — no regression from the parser change). Logic-only change; no browser surface to verify.

## 2026-07-18 — WP-5.4 shipped: performance budget + Lighthouse gate

**Shipped:** mobile LCP is now under 2s on every user-facing route, Lighthouse scores clear 95 across every enforced category, and CI owns both as blocking gates. Two new scripts back it: `perf:budget` (`scripts/check-performance-budget.mjs`) caps per-route initial JS/CSS from the build manifest, and `perf:lighthouse` (`scripts/check-lighthouse.mjs`) runs a three-sample median audit per route under direct DevTools mobile throttling. Both are wired into `npm run ci` after `build`, and into `.github/workflows/ci.yml` after the production build + browser install.

**Measured medians (this run):** landing LCP 881ms — performance 99 / accessibility 96 / best-practices 100 / SEO 100; `/app` LCP 767ms — 100 / 100 / 100 (SEO excluded by design; see boundary); `/verify` LCP 735ms — 100 / 100 / 100 / 100. Initial JS 190.4/191.9/193.7 KB against a 214.8 KB ceiling; inlined CSS keeps the render path zero-round-trip.

**The three fixes that moved LCP, each isolated and re-measured:**
- **Fonts (`src/app/layout.tsx`).** All three self-hosted faces switched to `display: "optional"` and the mono/display preloads removed. Under mobile throttling a slow webfont was repainting the text LCP after arrival; optional display lets the metric-adjusted fallback paint once and never be redefined. Fast connections still get the brand faces. This alone took landing from 62→~89.
- **Render-blocking CSS (`next.config.ts`).** Enabled `experimental.inlineCss`. The stylesheet was costing ~728ms of render-blocking time on the first visit; inlining removed the round-trip entirely and eliminated the last unstable sample (a 2013–2027ms boundary flake became a stable ~986ms median). Per this Next 16 version's own guidance, `inlineCss` targets exactly this Tailwind/first-visit/LCP case; CSS is only ~12.7 KB gzip.
- **Verify entrance animation (`src/app/verify/page.tsx`).** Removed the whole-panel `.rise` opacity/translate entrance. Its LCP element was the first paragraph inside the animated article, delaying paint to ~2.5s; the content now paints immediately. Interaction and reduced-motion behavior are unchanged.

**Lazy-export verification (acceptance clause):** confirmed `jspdf` and `xlsx` are `await import(...)` only and live in three separate build chunks (133.7 / 9.6 / 60.4 KB gzip), none present in the initial asset set for `/`, `/app`, or `/verify`. The 80 KB single-chunk budget ceiling fails CI if a heavy export bundle ever becomes initial.

**Why DevTools throttling + medians, not the default:** Lighthouse's simulated-throttling model post-hoc predicted a 3.6s LCP from a trace whose page actually painted at ~0.2s and did not honor the optional-font paint behavior — an unfaithful contract. Direct DevTools throttling measures the throttled browser itself; three samples with the median absorb normal scheduling noise so one 13ms fluctuation cannot decide CI.

**Honesty boundary:** the gate scores SEO on `/` and `/verify` but not `/app`. `/app` is deliberately `noindex` (private workspace), so an indexability score there would be a false signal, not a defect to "fix" by exposing product UI to crawlers. Accessibility/best-practices/performance are enforced on all three.

**Proof:** `unset DATABASE_URL; npm run ci` green end-to-end, exit 0 — lint, typecheck (`tsc --noEmit`), claims/research/brand, 343/343 unit tests, clean production build (`inlineCss` confirmed), `perf:budget` pass, and the `perf:lighthouse` medians above. Evidence is the measured numbers, not screenshots (a rendering-timing package); the tracked screenshots for other WPs are unchanged.

## 2026-07-18 — WP-6.4 shipped: restrained Nakul moments

**Shipped:** Nakul now has a pure priority state machine for first sync, verified savings, budget breach, and first evidence. Priority is first sync → savings → budget → evidence. Event-specific local keys prevent “first” moments from replaying on later sessions, and one session lock allows at most one moment per tab session. First sync keeps the existing full reveal; the other events use a compact inline panel with the matching found, celebrate, or guide pose and an explicit dismiss action.

**Timing integrity:** signed-in moment selection waits until connector status/coverage has loaded, so a transient first-evidence state cannot steal priority from a verified saving or completed first sync. Guest/local evidence still appears immediately. The budget moment only explains and routes attention; it never claims or performs an automatic cancellation.

**Proof:** focused selector tests green (2/2), including full priority and all-seen suppression; engine-backed verified-savings Playwright spec green on desktop Chromium and mobile Chromium, proving savings wins over first evidence, the panel dismisses, reload in the same session does not show a second moment, and the share loop still completes. `unset DATABASE_URL; npm run ci` green (343/343 tests, typecheck, claims/research/brand checks, production build). Evidence: [Nakul desktop](evidence/surface-10/wp-6.4-nakul-moment-desktop-chromium.png), [Nakul mobile](evidence/surface-10/wp-6.4-nakul-moment-mobile-chromium.png).

## 2026-07-18 — WP-5.2 shipped: consistent, reduced-motion-safe movement

**Shipped:** workspace entry motion now uses shared duration/easing tokens instead of local timings. All three programmatic result/navigation scrolls route through one client helper: normal motion stays smooth; `prefers-reduced-motion: reduce` switches to instant scrolling. The root CSS scroll behavior also becomes `auto` under reduced motion, while chapter and Nakul animations remain disabled and reveal content still fails open.

**Proof:** focused motion/reveal tests green (3/3); unauthenticated sample-audit Playwright spec green on desktop Chromium and mobile Chromium, asserting the actual `scrollIntoView` call uses `behavior: "auto"`, computed root scroll behavior is `auto`, and serious/critical axe results are empty. `unset DATABASE_URL; npm run ci` green (341/341 tests, typecheck, claims/research/brand checks, production build). Evidence: [reduced motion desktop](evidence/surface-10/wp-5.2-reduced-motion-desktop-chromium.png), [reduced motion mobile](evidence/surface-10/wp-5.2-reduced-motion-mobile-chromium.png).

## 2026-07-18 — WP-6.2 shipped: verified-savings share loop

**Shipped:** a savings receipt is now prepared automatically whenever the verification engine produces a verified saving. Review promotes one Share proof action that sends the generated card and sealed JSON receipt together through the browser Web Share API. Browsers without file sharing keep the existing honest fallbacks: card and receipt downloads plus copied share text when clipboard access exists. The separate Mint sealed receipt, Download share card, and Copy share text controls remain available.

**Integrity:** the shared artifact still comes exclusively from `buildSavingsReceipt`, which filters to verified outcomes and keeps currencies separate. The receipt is self-checksummed offline and receives an issuer signature only when authenticated signing is configured. Cancels that are merely watching, verifying, or still charging never unlock sharing.

**Proof:** 15/15 focused verified-savings/receipt/card tests green; isolated authenticated Playwright spec green on desktop Chromium and mobile Chromium, seeding a real three-charge Netflix history, a cancel decision, and matching continuous Account Aggregator coverage. The engine verifies ₹7,788/year, Share proof sends two non-empty files (`vognary-savings-card.(png|svg)` + sealed receipt JSON), and serious/critical axe results are empty. `unset DATABASE_URL; npm run ci` green (339/339 tests, typecheck, claims/research/brand checks, production build). Evidence: [share desktop](evidence/surface-10/wp-6.2-savings-share-desktop-chromium.png), [share mobile](evidence/surface-10/wp-6.2-savings-share-mobile-chromium.png).

## 2026-07-18 — WP-4.3 shipped: source-health chips

**Shipped:** source freshness now has one shared presentation contract across `/sources`, Connect, and Home: Fresh, Needs refresh, Reconnect, Sync issue, or Awaiting sync. Connect shows that chip on each active rail and retains Retry sync for stale/failed/blocked runs. Home names the affected provider instead of saying “one or more sources” and adds a one-tap Review sources command that opens Connect. The connector status API now includes the provider display name in its health summary so consumer copy stays specific.

**Proof:** focused source-health unit tests green (2/2); isolated authenticated Playwright spec green on desktop Chromium and mobile Chromium, proving Fresh → stale reload → named Home alert → Review sources → Needs refresh, with serious/critical axe results empty; `unset DATABASE_URL; npm run ci` green (339/339 tests, typecheck, claims/research/brand checks, production build). Evidence: [health desktop](evidence/surface-10/wp-4.3-source-health-desktop-chromium.png), [health mobile](evidence/surface-10/wp-4.3-source-health-mobile-chromium.png).

**Honesty boundary:** chips render the latest server-recorded sync state. They do not claim fresh evidence before a provider run succeeds; live values still depend on G-A/G-B/G-C and real connected-account activity.

## 2026-07-18 — WP-1.2 complete: Home burn trend

**Shipped:** the Monthly burn card now shows its signed change since the last completed review using the existing `ReviewDiff.monthlyDelta`. Increases use the attention tone, decreases use the verified tone, and an unchanged value stays muted. Before a baseline exists, Home states “No comparison yet” and tells the user that completing a review creates one. This completes the last missing Home acceptance criterion without pretending the single stored review is a multi-month chart.

**Proof:** focused `review-diff.test.ts` green (3/3); signed-in Playwright journey green on desktop Chromium and mobile Chromium with a required comparison-state assertion and the existing Home axe scan; `unset DATABASE_URL; npm run ci` green (337/337 tests, typecheck, claims/research/brand checks, production build). Evidence: [trend desktop](evidence/surface-10/wp-1.2-home-trend-desktop-chromium.png), [trend mobile](evidence/surface-10/wp-1.2-home-trend-mobile-chromium.png).

## 2026-07-18 — WP-6.1 shipped: Renewal Radar

**Shipped:** Home now opens with a 45-day spatial Renewal Radar built from the existing proven-cadence timeline. Each upcoming debit is positioned by days away, sized by amount, and highlighted gold when due within seven days. The hero includes the next merchant/debit, 7-day and 30-day exposure, and the full 45-day total. Every marker has a 44px touch target and opens the existing subscription detail sheet in one tap, preserving the proof, decision, and cancel-guide path.

**Accessibility and harness hardening:** the mobile workspace navigation's inactive labels now use the stronger ink token after axe measured the previous Subscriptions label at 4.48:1. The signed-in harness also tolerates the one-time guest-transfer notice being absent on repeat runs; durable Home totals, subscriptions, watched merchants, delayed-hydration merge, reload persistence, and connector-return assertions remain mandatory.

**Proof:** `unset DATABASE_URL; npm run ci` green, exit 0 — lint, typecheck, claims/research/brand checks, 337/337 unit tests, and a clean Next.js production build. The signed-in Playwright journey passes independently on desktop Chromium and mobile Chromium, including axe checks on Home, the open detail sheet, Subscriptions, and Connect. The test taps a radar marker, asserts the proof dialog, records Monitor, closes with Escape, and continues through persisted merchant watches and provider-return reveal. Evidence: [radar desktop](evidence/surface-10/wp-6.1-radar-desktop-chromium.png), [radar mobile](evidence/surface-10/wp-6.1-radar-mobile-chromium.png).

**Honesty boundary:** the radar projects debits only from detected recurring evidence and proven cadence. It does not claim bank forecasting or live provider coverage; those remain subject to G-A/G-B/G-C.

## 2026-07-18 — Gate hardening: `npm run ci` now type-checks test files

**Closes the WP-1.3 follow-up.** `npm run ci` previously type-checked only the app (via `next build`) and *ran* tests via `tsx` (which strips types without checking), so type errors in test files never failed the gate. Added a `typecheck` script (`tsc --noEmit`) and inserted it into `ci` right after `lint`, so the whole project — app and tests — is now type-checked on every gate run.

Fixed the two latent errors this surfaced:
- `tests/suggested-cuts.test.ts` — the `RecurringItem` factory set a non-existent `occurrenceCount`/`recommendation`, omitted required `id`/`averageGapDays`/`missedCycles`/`priceChange`, duplicated `identityKey`/`monthlyCost` via a trailing spread, and used `percentChange` instead of `changePercent`. Rewrote it to destructure the required keys out of the spread and match the real type; runtime behavior (ranking) is unchanged.
- `tests/setu-aa-adapter.test.ts` — `let body: … | null = null` is assigned only inside the fetch-mock closure, so TS kept `body` narrowed to `null` at the assertions and typed the property access as `never`. Declared it `Record<string, unknown> = {}` (no null in the type) so the capture reads cleanly; a missing capture still fails the assertions loudly.

**Proof:** `unset DATABASE_URL; npm run typecheck` exit 0; full `npm run ci` green (lint, **typecheck**, claims/research/brand, 337 tests, build).

## 2026-07-18 — WP-1.3 shipped: subscription detail sheet

**Shipped:** tapping any subscription — from a Home card ("Renews next", "Do this first", a suggested cut) or a Subscriptions card — now opens a focused modal **detail sheet in place** instead of navigating to another screen and scrolling. The sheet shows the header (merchant, category · cadence, confidence + status + price-change chips), a stats grid (monthly, annual, a live "renews in Nd" countdown, amount range, proof rows, price move / evidence gap), a **decision control** (Keep / Monitor / Downgrade / Cancel / Review, filtered by the commitment policy) wired to `recordAction`, the class-safe consequence warning, the merchant's **cancel-guide** steps + official-account link (the existing `cancel-actions` registry), and the **proof evidence table** (date / amount / statement text). "Open full review →" hands off to the inline deep-dive + assisted-cancel (concierge) flow; Escape, backdrop click, and Done all dismiss.

**Design:** driven by new `detailItemId` state + `openDetail(key)` (sets `detailItemId` and `selectedItemId` together, so closing the sheet leaves the same item selected underneath and the concierge path is never lost). `SubscriptionDetailSheet` reuses `recordAction`, `getCommitmentPolicy`, `isReviewActionAllowed`, `recommendationActions`, `findCancelAction`, `statusStyles`, and `formatCurrency`; no new data, no new routes.

**Proof:** `unset DATABASE_URL; npm run ci` green, exit 0 (lint, claims/research/brand, 337 unit tests, production build). Signed-in harness extended (`signed-in-first-value.spec.ts`) and green on desktop + mobile: opens the sheet from Home in one tap, asserts the proof section + decision group, records "Monitor" (aria-pressed), and closes on Escape — with a **serious/critical axe check on the open sheet**. Guest `first-value-path` 10/10 (no regression). Evidence: [detail desktop](evidence/surface-10/wp-1.3-detail-desktop-chromium.png), [detail mobile](evidence/surface-10/wp-1.3-detail-mobile-chromium.png).

**Two axe bugs found and fixed while proving it:** (1) `aria-dialog-name` — the dialog id/`aria-labelledby` embedded the raw `identityKey` (`"google one::INR::…"`, spaces + colons), which `aria-labelledby` reads as several missing id references; slugified the id. (2) `color-contrast` — the reused `pill`/`stamp` chips and the active-action button inherited light text on gold inside a dark `dossier` header; switched the sheet header and active-button treatment to the proven-clean light card + `bg-(--gold-tint)`/`text-(--ink)` pattern used by the Subscriptions cards.

**Follow-ups (filed, not in scope here):**
- **CI does not type-check test files.** `npm run ci` type-checks the app via `next build` and *runs* tests via `tsx` (which strips types without checking). `npx tsc --noEmit` surfaces pre-existing/tranche test-type errors that never fail CI — e.g. `tests/suggested-cuts.test.ts` uses `percentChange` (should be `changePercent`) and a non-existent `occurrenceCount`; `tests/setu-aa-adapter.test.ts` has a `never`-typed access. Consider adding a `typecheck` script (`tsc --noEmit`) to the gate and fixing these. Same class of gap as the 2026-07-18 build gap, one layer down.
- **Minor:** a fixed page-level brand avatar ("N", bottom-left) paints over the sheet footer's "Open full review" label; it sits above the modal's `z-70`. Raise the modal stacking or suppress that element while a modal is open.

## 2026-07-18 — Production build gap closed; full `npm run ci` is now the verified gate

**What was wrong:** the 2026-07-17 checkpoint below reported `lint`, unit tests, e2e, and axe as green but never ran `npm run build`. It also undercounted the suite (`336`; the actual figure was `337` after the suggested-cuts tests landed). Because the dev-server e2e transpiles without type-checking, a real type error shipped uncaught.

**The defect:** `next build` failed TypeScript at `src/app/vognary-mvp-client.tsx:835`. The guest-transfer no-op path called `buildWorkspaceBackup({ ...currentWorkspace, … })`, but `currentWorkspace` is a `HydrationWorkspaceState` whose `receiptText` is `string | undefined`, while `buildWorkspaceBackup` requires `receiptText: string`. TypeScript suppresses excess-property checks on spread properties, so the extra `selectedItemId` passed silently while the `receiptText` narrowing mismatch did not.

**The fix:** add `receiptText: currentWorkspace.receiptText ?? ""` to that call — the same `?? ""` idiom used at the other `receiptText` sites in this file. One line; no behavior change (the guest snapshot already treats an absent paste as empty).

**Proof at this checkpoint:** `npm run ci` green end-to-end, exit 0 — `lint`, `claims:check`, `research:check`, `brand:check`, `337/337` unit tests, and a clean production `build` (compiled + type-checked). The `ci` script (`package.json`) is now the honored ground-truth gate; no surface claim rests on the dev server alone.

## 2026-07-17 — First executable tranche browser-proved (WP-1.1, 2.3, 2.4, 3.1, 3.2, 3.4, 5.3)

**Shipped:** the signed-in workspace now has three primary destinations — Home, Subscriptions, Connect — with Review/Data behind More after data exists. Home has proof-linked burn/renewal cards, persisted monthly and category budgets, over-budget/renewal/price/freshness alerts, and three deterministic suggested cuts. Subscriptions is a responsive sortable card list with proof, action, price-change, and category-budget states. Advanced file import moved to Data and no longer appears in guest or Connect first-run.

**Continuity and integrity:** `WorkspaceBackup`, local save, encrypted server snapshots, manual restore, undo, and clear all include budget state. Guest handoff reports the exact commitment count and clears the same-tab transfer even when the data already existed server-side. The pre-hydration race is closed by merging only edits made after the hydration baseline; the harness deliberately delays the snapshot GET, clicks a merchant watch, and proves the edit survives save + reload.

**First-run:** signed-out `/app` now presents Connect Gmail, Paste receipts, and See a sample audit. The eight-subscription INR sample is explicitly labelled non-user data, is never staged for sign-in, and clears in one click. The original real-receipt paste path remains under one second in the browser harness.

**Daily use and platform:** deterministic suggested-cut ranking is unit-tested; the PWA install prompt appears only after a proven ledger; financial navigation remains network-only in the service worker. `/app?aa=returned` now polls boundedly and shows a currency-safe Nakul first-sync reveal only after real recurring items arrive. This path is browser-proved with a realistic mocked connector response; real provider proof still requires G-B.

**Browser evidence:** [Home desktop](evidence/surface-10/wp-1.2-home-desktop-chromium.png), [Home mobile](evidence/surface-10/wp-1.2-home-mobile-chromium.png), [Subscriptions desktop](evidence/surface-10/wp-1.3-subscriptions-desktop-chromium.png), [Subscriptions mobile](evidence/surface-10/wp-1.3-subscriptions-mobile-chromium.png), [Connect desktop](evidence/surface-10/wp-1.1-connect-desktop-chromium.png), [Connect mobile](evidence/surface-10/wp-1.1-connect-mobile-chromium.png).

**Proof at this checkpoint:** `npm run lint` green; 336/336 unit tests green; guest first-value suite 10/10 browser tests green; signed-in harness 2/2 (desktop + mobile, serialized against one workspace) green; serious/critical axe results empty on Home, Subscriptions, Connect and the existing Landing/Login checks.

**Harness corrections:** broad Playwright route interception now falls through correctly for exact checkout mocks, expected Strict Mode GET aborts are ignored without hiding real runtime failures, signed-in projects serialize their shared workspace, and development-login requests use isolated test identities so repeated live harness runs do not consume one rate-limit bucket.

**Honest remaining work:** WP-0.2 corpus scale; WP-0.4 full-panel empty-state audit; WP-1.2 spend trend; WP-1.3 true detail sheet; WP-1.4 prose cull; WP-2.1 post-signup three-choice state; WP-2.2 full-workspace sample mode; WP-3.3 consented weekly digest; live G-A/G-B/G-C; WP-5.1/5.2/5.4 and remaining WP-5.5 QA; Phase 6. The scoreboard stays minimum-row and is not promoted to 10 without those proofs.

## 2026-07-17 — Pre-hydration input race closed

The open bug below is fixed. `src/lib/workspace-hydration.ts` applies record, array, and text deltas from a captured baseline to the fetched server snapshot. `vognary-mvp-client.tsx` restores that merged state and keeps the fetched revision as the synchronization base, so early edits are uploaded rather than discarded. Three unit tests cover untouched server fields, early array additions/removals, and an early pasted receipt; the signed-in browser harness covers the original merchant-watch reproduction with a 1.5-second delayed hydration response.

## 2026-07-17 — WP-0.1 shipped + pre-hydration input race found

**Shipped (WP-0.1):** month-name date parsing (`src/lib/loose-date.ts` `parseMonthNameDate`, widened date/keyword gates in `src/lib/receipt-parser.ts`) with regression tests. Real-format Netflix/Spotify/Google receipts now produce ledger rows instantly; previously they produced nothing. Proof: `tests/receipt-parser.test.ts` "parses real-world receipts…", guest walkthrough screenshots (burn ₹898 / next renewal 17 Jul from a 3-receipt paste).

**Shipped (WP-0.3):** signed-in e2e harness `tests/e2e/signed-in-first-value.spec.ts` (env-guarded; skips without dev-login env; command in plan Part II.2).

**Bug found (open, assign under Phase 0): pre-hydration input race.** On signed-in `/app` load, user state (merchant watches, and by the same pattern likely decisions/notes) edited *before* the encrypted workspace snapshot GET completes is silently reverted when hydration applies the fetched snapshot (`vognary-mvp-client.tsx` ~line 598–640 hydration path overwrites live state wholesale). Repro: load `/app` with a non-empty stored snapshot, click "Watch" on a tile within ~1s, watch it flip back. Suggested fix: track a `dirtySinceMountRef` per state slice (or buffer pre-hydration edits and re-apply after hydration); do not blanket-disable the UI. The harness works around it by awaiting the snapshot GET before interacting — the workaround marks the spot.
