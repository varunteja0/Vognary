# Surface 10/10 Worklog

Append-only log per [surface-10-orchestration-plan.md](surface-10-orchestration-plan.md) Part VI. Newest first.

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
