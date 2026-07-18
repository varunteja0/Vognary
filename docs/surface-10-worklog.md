# Surface 10/10 Worklog

Append-only log per [surface-10-orchestration-plan.md](surface-10-orchestration-plan.md) Part VI. Newest first.

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
