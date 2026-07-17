# Vognary Product Perfection Plan

Date: 2026-07-10
Scope: the product itself — engine, frontend, backend, UX, every state, every device. Business/GTM lives in `docs/path-to-10.md`; this plan makes the thing being sold flawless.

## The honest premise

"No chance for improvement" is not a state a product reaches — it is a **machine** a product runs: every journey specified, every state designed, every defect class caught by an automated gate before users see it. Trillion-dollar products are not gapless; they find gaps faster than users do. This plan therefore has two halves: **(A) close every known gap** (a real, verified inventory — nothing namesake), and **(B) build the gap-finding machine** so unknown gaps die in CI, not in production.

Perfection bar — a journey or surface is DONE only when all seven hold:

1. **Correct**: property-tested engine behavior; no silent data loss or double counting.
2. **Complete states**: designed empty, loading, error, offline, slow, huge-data, and first-run states.
3. **Fast**: p75 LCP < 1.8s, INP < 200ms, engine recompute < 50ms at 5k transactions (worker beyond).
4. **Accessible**: WCAG 2.2 AA — keyboard-complete, screen-reader labeled, contrast-verified, reduced-motion respected.
5. **Every device**: 320px → 4K, touch and pointer, iOS Safari + Android Chrome + desktop trio.
6. **Recoverable**: destructive actions confirmed or undoable; nothing lost without an explicit user choice.
7. **Proven**: an E2E test walks the journey; a visual snapshot guards the layout; the claim appears in docs only after the test exists.

---

# Part A — The Verified Gap Inventory (nothing here is hypothetical)

## A1. Correctness defects (P0 — fix before anything else)

| # | Defect (verified in code) | Why it matters | Fix |
| --- | --- | --- | --- |
| 1 | **Volatile item identity.** `RecurringItem.id = slugify(merchant + lastChargeDate)` — importing next month's statement changes `lastChargeDate`, so the id changes and every `userAction`, `actionsMeta`, `itemOwner`, `reviewNote`, and `mergeDecision` keyed on it silently orphans. | The user's review work evaporates on the very action we ask them to repeat monthly. Worst-in-class data-loss bug. | Introduce **stable commitment identity**: `identityKey = normalizedMerchant::frequency` (plus amount-band suffix only when the same merchant intentionally splits). Keep display id, key ALL user state by identityKey, write a localStorage migration that re-keys existing state, and regression-test "add newer statement → notes survive". |
| 2 | **Duplicate import double-counting.** Importing the same CSV twice creates two sources with identical rows; every amount doubles. No content-hash dedupe exists. | First-session trust killer; a confused user's burn doubles. | SHA-256 content hash per source at ingest and in the client; identical hash → "already imported" notice, skip. Near-duplicate (overlapping date ranges, same detected format) → row-level dedupe by (date, amount, normalized description) with a merge report. |
| 3 | **Unguarded persistence.** Both `localStorage.setItem` sites (autosave effect, `enableLocalSave`) plus lastReview/packChain writes have no quota/error handling; a 5MB statement set throws `QuotaExceededError` and autosave dies silently. | "Saved on this device" becomes a lie exactly for the power users with the most data. | Wrap a `safePersist` adapter: try/catch, size accounting, oldest-source eviction proposal, and a visible "save failed — export now" banner. Move statement text to IndexedDB (structured, ~unbounded) with localStorage kept for small state. |
| 4 | **No cross-tab safety.** Two open tabs both autosave; last write clobbers the other's actions/notes. | Real multi-tab users lose work invisibly. | `storage`-event listener + monotonic `revision` counter; on external change, merge non-conflicting keys, prompt on conflict. |
| 5 | **Single-currency assumption.** `formatCurrency` hardcodes INR; `ManualRecurringInput` has no currency; connector evidence *has* currency but the ledger drops it. A USD SaaS receipt silently sums into INR totals. | Wrong totals for exactly the founder audience with USD tools; disqualifying for global users. | Add `currency` to transactions, manual items, and items; per-currency subtotals; workspace display currency with explicit, user-visible static conversion rates ("converted at your rate ₹83.2/$") — never pretend live FX. |
| 6 | **Timezone/date drift.** All date math uses local `Date`; `decidedAt` stores ISO instant but compares against date-only strings. A user in UTC−7 can see next-debit dates a day off, and Verified Savings windows can shift. | Off-by-one dates in a product whose whole promise is "what renews when". | Normalize the engine to date-only civil dates (YYYY-MM-DD strings end-to-end, no `Date` timezone exposure); one audited `civil-date.ts` module; property tests across TZ offsets. |
| 7 | **Ambiguous dd/mm vs mm/dd.** `parseDate` guesses day-first only when a component >12; "03/04/2026" is silently dd/mm. | Wrong cadence for non-Indian exports; wrong dates ≤12th of month. | Per-source date-format resolution: format registry hint → column consistency scan (if any row >12 disambiguates, lock the whole source) → explicit user toggle per source when still ambiguous, surfaced in the source chip. |
| 8 | **Cadence blind spots.** No model for twice-monthly (1st + 15th), 4-weekly vs monthly separation is tolerance-based, ₹0 trial rows are dropped by the amount filter so trial→paid transitions surface late, refund pairs (debit+credit same merchant) aren't netted. | These are the exact patterns of Indian salaries/SIPs and SaaS trials. | Add `semimonthly` frequency; day-of-month bimodality detection; keep ₹0/trial rows as `trial` evidence with "converts ~date" prediction; refund netting with `refunded` tag. |
| 9 | **Verified-savings cadence unfairness.** `requiredCleanCycles = 2` for all cadences → a yearly cancel takes two *years* to verify. | Makes the flagship feature look broken for annual items. | Cycles required by cadence: weekly/monthly 2, quarterly 2, yearly 1 (+90-day post-window). Grace days scale with cadence. |
| 10 | **Dead/false claims.** `jspdf` is a dependency but unused — README's "PDF report export, CSV export" is currently false (export is sealed JSON only). | The honesty product must not overclaim its own features. | Either ship real PDF + CSV export of the audit pack (lazy-loaded, sealed hash printed on the PDF) or delete the dependency and the claim. Decision: ship it — reviewers/CAs need PDF. |
| 11 | **ID collision risk.** Two merchants normalizing to the same name with the same lastChargeDate collide into one id. | Rare but corrupting. | IdentityKey fix (#1) plus collision suffix from source hash. |

## A2. Experience gaps (the product is now dense — clarity is the feature)

| # | Gap | Fix |
| --- | --- | --- |
| 12 | **No overview.** `/app` opens into 10+ panels across 4 chapters; the "5-second answer" (monthly burn, next renewal, one action) requires scrolling. | New **Overview** chapter 00: one screen — burn, next 3 renewals, top action, proof strength, savings counter — each tile deep-linking into its chapter. Everything below becomes drill-down. |
| 13 | **No progressive disclosure.** Proof graph, duplicates, guided capture, savings all render expanded for a first-time user with 3 items. | Panel shell with collapsed/summary mode + "expand"; default collapsed until the panel has signal (candidates>0, savings>0); remembered per workspace. |
| 14 | **Destructive actions unconfirmed.** `Clear` wipes the workspace in one click; "Delete browser save" likewise; no undo anywhere. | Confirm dialogs with typed-out consequence + 15-second undo snackbar (workspace snapshot kept in memory); export-first shortcut in the dialog. |
| 15 | **No URL state.** Selected item and active chapter aren't in the URL; refresh loses position; nothing is shareable/bookmarkable. | Router-synced state: `/app?item=<identityKey>&chapter=ledger`; back/forward works. Legacy `demo` and `guest` parameters permanently canonicalize to `/app` and are never product states. |
| 16 | **No search/filter/sort.** The ledger table is fixed-order; 50+ items become unusable. | Sticky toolbar: text search, category and action filters, sort by cost/date/confidence; counts update; empty-filter state designed. |
| 17 | **Transient-only feedback.** One toast, then history is gone; imports/syncs/errors leave no trail. | Activity log drawer (session-scoped, exportable) — every import, merge, action, sync, and error with timestamps. |
| 18 | **Mobile top-stack too tall.** Money tape + section nav + chapter header consume ~40% of a 667px viewport. | Mobile: tape collapses to a single-line burn+next-renewal ticker; section nav becomes a bottom tab bar; test at 320/375/412 widths. |
| 19 | **A11y unaudited.** Focus order untested, spectrum segments are unlabeled color buttons for SR users beyond aria-label, reveal animations ignore `prefers-reduced-motion`, contrast of muted-on-dark unverified. | Full axe + manual SR pass (VoiceOver/NVDA); reduced-motion kills reveal/spotlight; contrast tokens fixed at the CSS variable level; skip-links; visible focus rings everywhere. |
| 20 | **First-run needs a path for the fearful.** A user with no export and understandable concern about linking a source still needs a 60-second win. | First-run interview (3 taps: "founder/personal/team" → "which apps do you pay for?" chip-picker seeding manual items from a known-merchant price book) → instant ledger with `unverified` tags → then asks for proof. Price book = static, honest defaults ("typical ₹1,999 — confirm yours"). |
| 21 | **Copy inconsistencies.** INR vs ₹ mixed; "folio" jargon; notices vary in voice. | Copy system doc: one glossary (commitment, proof, source, mandate), one currency renderer, sentence-case buttons, every notice states *what happened + what changed + next step*. |
| 22 | **No theme/appearance settings.** Single dark theme; bright-environment readability suffers. | Light theme via existing CSS variables; system-follow default; toggle in profile. |
| 23 | **No print/PDF-friendly review.** The monthly review can't be handed to a CA/co-founder except as JSON. | Print stylesheet + "Review PDF" (same renderer as #10) with sealed-hash footer. |

## A3. Frontend engineering gaps

| # | Gap | Fix |
| --- | --- | --- |
| 24 | **2,450-line client monolith.** All panels, state, and helpers in one file; unreviewable, untestable at component level. | Decompose into `src/app/app/(workspace)/` feature modules: `overview/`, `connect/`, `ledger/`, `review/`, `data/` + `src/components/ui/` kit (Panel, SectionHead, Stat, Pill, Stamp, Table, Dialog, Toast). No component >250 lines. Zero behavior change — verified by the E2E suite added first. |
| 25 | **State is 15 useStates.** Interdependent updates scattered; migration-unsafe persistence. | One `workspaceStore` (useReducer + context): typed actions, versioned persisted schema with migrations (v1→v2 identityKey re-key), persistence adapter (IndexedDB+localStorage), cross-tab channel. Engine calls stay pure. |
| 26 | **Main-thread engine.** `analyzeStatements` runs synchronously per keystroke of receipt textarea; 5k+ rows will jank. | Debounce inputs (250ms); above 2k transactions move engine calls to a Web Worker (engines are already pure/dependency-free — worker-ready by design); loading shimmer during recompute. |
| 27 | **No client error telemetry.** Browser exceptions vanish. | Error boundary per chapter with friendly recovery + "copy diagnostics"; optional Sentry browser SDK env-gated; Web Vitals reported to the monitoring hook. |
| 28 | **No bundle discipline.** No budgets; heavy libs (jspdf when added) must not hit first paint. | Budget: ≤180KB gz first-load JS for `/app`; `next/dynamic` for PDF export, verify page, guided capture; CI fails on budget regression (size-limit). |

## A4. Backend gaps

| # | Gap | Fix |
| --- | --- | --- |
| 29 | **No durable normalized history.** Snapshots are encrypted JSON blobs; diffs/history live in one browser. The schema for real rows exists, unwired. | Repository layer over existing tables (`transactions`, `recurring_items`, `evidence_links`, `audit_reports`); dual-write behind flag for signed-in users; month-over-month server diffs; device-independent review history. This is the single biggest backend lift and unlocks multi-device + team truth. |
| 30 | **Ingestion coverage.** No XLS/XLSX (most Indian banks export .xls); scanned/image PDFs yield nothing (pdf-parse is text-only). | Add SheetJS-community or exceljs XLSX parsing server-side; detect scanned PDFs (no text layer) and say so honestly with a guided fallback ("export CSV from netbanking — here's how for your bank," linked from the format registry) — OCR only later, clearly staged. |
| 31 | **API contract informality.** No OpenAPI spec, no error taxonomy, no request ids, no idempotency on POSTs. | `docs/api/openapi.yaml` for public endpoints; error envelope `{code, message, hint, requestId}`; `X-Request-Id` through logs; idempotency keys on audit-intake/checkout. |
| 32 | **Rate-limit identity.** Per-IP only — a college NAT exhausts everyone; authenticated users should have their own buckets. | Key = session user id when present, else IP; separate authed/anon budgets. |
| 33 | **Session lifecycle.** No sliding expiry UX, no "sign out other devices", no session list. | Session table with device labels; profile "Active sessions" + revoke; sliding renewal with absolute cap. |
| 34 | **Erasure completeness.** Snapshot delete exists; full account erasure (user row, workspaces, tokens, leads by email, audit-log anonymization) is not one action. | `DELETE /api/account` with staged confirmation, 7-day grace undo via email link, erasure receipt (sealed, of course). |
| 35 | **Client of record for time.** Server responses don't echo server time; client clock skew can distort "renews in Nd". | Echo `serverTime` in `/api/health` consumed by client for skew correction beyond ±2min. |

## A5. The gap-finding machine (Part B — what makes "no gaps" durable)

| # | Machine piece | Gate |
| --- | --- | --- |
| 36 | **Playwright E2E suite** covering the 12 canonical journeys (below) on desktop Chrome + mobile WebKit viewport. | CI-blocking. |
| 37 | **Visual regression** (Playwright snapshots) for every panel in empty/typical/dense states, light+dark. | CI-blocking on diff. |
| 38 | **axe-core a11y scan** on every route + keyboard-walk script. | CI-blocking on serious/critical. |
| 39 | **Engine property tests** (fast-check): date roll-forward never past, totals never double under merge permutations, parse(format(x))=x for money/dates. | CI-blocking. |
| 40 | **Statement corpus harness** `npm run corpus`: drop real redacted files + expectation YAML; precision/recall report; release gate ≥97/92 once ≥100 real files exist (collection is a Phase-0 GTM task). | CI-reporting now, blocking at n≥100. |
| 41 | **Perf budgets in CI**: size-limit + Lighthouse-CI on `/`, `/app`, `/verify`. | CI-blocking. |
| 42 | **Load test** (k6): /api/audit at 200 rps sustained, p95 <300ms; ingest 20 concurrent 8MB PDFs. | Release gate. |
| 43 | **Release checklist automation**: `npm run release:gate` = lint+test+build+e2e+axe+budgets+smoke+production:check. One command answers "may we ship?". | Manual ships forbidden. |

## The 12 canonical journeys (each gets spec → states → E2E → visual → a11y)

1. First visit → paste two receipts → understand burn in 60s.
2. First visit → fearful path (interview seed) → first unverified ledger → first proof added.
3. Import CSV (each supported bank format) → correct ledger → notes survive next month's import (#1 regression).
4. Import duplicate/overlapping file → deduped with report (#2).
5. Paste receipts / Gmail import → merge with statement → multi-source verified.
6. Guided capture (each of 6 apps) → mandate inventory → calendar updated.
7. Decide cancel → later import → Verified Saving minted (or not-eliminated) honestly.
8. Duplicate candidate → merge/keep → totals correct, decision survives re-import.
9. Monthly review complete → next month diff correct across device (post-#29: server-backed).
10. Export sealed pack → verify at `/verify` (+ tamper case) → PDF variant.
11. Sign in (magic link) → encrypted snapshot save/load/delete → account erasure.
12. Connector connect→sync→evidence import→disconnect (OpenAI key path) with every failure state rendered.

---

# Part C — Execution waves (dependency-ordered; each wave ships green)

**Wave P0 — Data integrity (nothing else matters if user work evaporates):** items #1–#11. Exit: journeys 3, 4, 7, 8 pass as new E2E tests; migration tested against seeded v1 storage.

**Wave P1 — Experience architecture:** #12–#23. Exit: overview screen live; mobile tab bar; confirms+undo; URL state; search/filter; a11y scan clean; copy pass merged.

**Wave P2 — Frontend engineering:** #24–#28 (E2E suite #36 lands FIRST as the safety net, then decomposition). Exit: no file >400 lines in the workspace feature; budgets enforced; worker path proven at 10k rows.

**Wave P3 — Backend completeness:** #29–#35 (+#30 XLSX early — it's user-facing coverage). Exit: journeys 9 & 11 pass against a real Postgres; OpenAPI published; erasure receipt verified.

**Wave P4 — The machine:** #37–#43 fully lit; corpus collection running via Phase-0 audits. Exit: `release:gate` is the only ship path; two consecutive releases with zero manual QA findings.

**Definition of PERFECT (the standing bar, forever):** every journey green on the full matrix; zero known P0/P1 defects; every claim in README/docs backed by a test; every new panel ships with all seven bars met or it doesn't ship.

---

## What this plan refuses to do (so "perfect" stays honest)

- No fake connectors, no fabricated bank sync, no "AI insights" without citations — density of *proof*, not features, is the product.
- No claim of OCR/universal-bank support before the corpus proves it per format.
- No silent schema changes: every persisted-state change ships with a migration + rollback note.
- No perfection theater: if a bar can't be measured in CI, it isn't in the definition.
