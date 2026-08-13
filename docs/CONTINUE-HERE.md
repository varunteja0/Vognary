# CONTINUE HERE — live handoff (2026-08-12)

> **New chat — mandatory order:**
> 1. [`docs/THE-LAW.md`](THE-LAW.md) — **supreme company + agent directive** (read first)
> 2. **This file** — live branch/env/state only
> 3. [`docs/execution/phase-a-market-contact.md`](execution/phase-a-market-contact.md) — market proof kit
> 4. [`docs/execution/phase-b-loop-shipping.md`](execution/phase-b-loop-shipping.md) — loop product WPs
> 5. Then `docs/execution-plan-ui-ai-quality.md` / `docs/master-build-plan.md` as needed
>
> A founder assessment (2026-07-21) is codified as THE-LAW. This file is **live state**,
> not a competing strategy. Prior-generation plans live in `docs/archive/` — do not resurrect them.

---

## 0. Prime directive — INDIA-FIRST, world-second (both required)

The founder is in India. **Every surface must let an Indian track their recurring
money first-class before anything else, and the world must work too.**

- **India-first, concretely:** default currency **₹ (INR)**; Indian number
  formatting (`formatMoney` in `@/lib/format`); Indian recurring rails first-class —
  **UPI AutoPay mandates, card e-mandates, SIPs, EMIs, EPF, Play/App Store India
  receipts, Indian bank-statement formats**; copy that names Indian rails by name.
  The deterministic engines already understand these (`recurring-audit.ts`,
  `renewal-timeline.ts`); the UI must surface them prominently.
- **World-second:** multi-currency works, but as explicit opt-in; components
  default to India.
- Honesty invariant holds everywhere: name a rail only at its proven `*_STATUS`.

## 1. Where things stand (verified 2026-08-12)

- **Recovery v1 launch implementation is locally green (verified 2026-08-12):**
  branch `recovery/v1` has one canonical signed path under
  `src/app/workspace/recovery/**` + `src/lib/recovery/**` + Recovery APIs +
  migration `0023`. Guest evidence survives authentication; Changed provenance,
  repeatable-read version coherence, decimal-safe bigint money, exact evidence
  addressing, canonical export/delete, deterministic-only file provenance, PII
  redaction, resource ceilings, and hot-query indexes are enforced. Realistic
  merchant + amount + charge-date receipts now persist as observations; one
  receipt publishes its saved merchant, amount, date, exact evidence, and honest
  WhatsApp text without fabricating recurrence, while two matching charges infer
  cadence through the existing engine. Empty Home uses a three-step manual path
  unless the receipt inbox is publicly attested; Changed appears before attention;
  currencies remain separate; reminder eligibility never claims delivery.
  Evidence: **571/571 unit/source-contract tests**, **42/42 PostgreSQL tests**,
  and the applicable closeout browser matrix **46/46** across desktop/mobile
  (**44** landing/login/first-value/Home/state scenarios + **2** real-route/
  PostgreSQL Customer #0 scenarios), with no serious/critical axe violations.
  Lint has zero errors (8 pre-existing navigation warnings); typecheck, claims,
  tokens, build, and performance budgets pass. Production now has a clean Recovery cutover
  through `0026`, an exact-main-SHA deployment, Google identity configuration,
  daily reminder/retention cron routes, and a verified Resend sending + receiving
  domain with the canonical `email.received` webhook. The provider is configured,
  but receipt-inbox launch attestations remain deliberately blank until a real
  signed event proves processing, replay, and retention. Real Google/session,
  real receipt/PDF processing, delivered reminder, and a human-timed Customer #0
  remain to prove. Scoreboard human metric cells remain blank because no completed-
  audit, surprise, pay-intent, TTI, corpus, or return evidence was supplied in this run.
- **Local F1 was impossible until 2026-08-12 and is now unblocked.** The closeout
  work was 28 uncommitted files on one laptop; it is now committed and pushed as
  `9cbccf0` + `6531c0b` on `recovery/v1`. Separately, `.env.local` had no
  `ENABLE_DEVELOPMENT_LOGIN` / `DEVELOPMENT_LOGIN_EMAIL` /
  `DEVELOPMENT_LOGIN_ACCESS_CODE`, and no local Google client, so **no one could
  sign in locally at all** — which is why `recovery_submissions` was 0 and every
  signed-in browser journey silently skipped on this machine (CI always had the
  code, so CI counts were real). Development login is now configured locally
  (gitignored; hard-disabled when `NODE_ENV=production`). `.env.local` still
  points `DATABASE_URL` at `localhost:5432` for the `docker compose` path, so
  when using the standalone Postgres on `55432` start the server as:
  `DATABASE_URL='postgres://vognary@127.0.0.1:55432/vognary' POSTGRES_SSL=false npm run dev -- --hostname 127.0.0.1 --port 3101`.
  Customer #0 then passes live on that server: **desktop and mobile, 30 actions
  each, real routes and real PostgreSQL**. Human TTI is still unmeasured.
- **Production closeout candidate is live, but public growth remains blocked
  (verified 2026-08-12):** `www.vognary.com` now serves exact CI-green SHA
  `2eda24d5d88e4d3e0727d823905d9aba9fdcb0fd`; the closeout landing/login copy,
  `/api/health`, identity-only Google start contract, retired `410` routes,
  persistent backend, migrations through `0026`, and shared rate limiting pass.
  The invalid production `DATABASE_URL` placeholder was replaced by a verified
  Neon pooled URL. `INTERNAL_SYNC_SECRET` is synchronized across Vercel, GitHub
  Actions, and the gitignored local operator file; a protected Sentry test
  returned `status=delivered`, and a protected retention dry run selected all 4
  workspaces with zero failed executions. A read-only encrypted backup of the
  PostgreSQL 18.4 production database restored into disposable PostgreSQL 18.4
  with matching checksum, all 17 core tables, and exact Recovery row counts; all
  copied data and the temporary key were then destroyed. That rehearsal does
  **not** make backups READY because no persistent founder-held key or durable
  object-storage copy exists. Receipt inbox remains NOT CLAIMED: production has
  3 signed-event records, but 2 are terminal `PARSE_FAILED`, 1 remains
  `MATERIALIZATION_FAILED`, and zero evidence rows have `PROVIDER_RECEIVED`
  provenance. Delivered reminders/digests remain 0; Razorpay and legal proof are
  absent; human F1/TTI, completed audits, surprise, pay intent, consented corpus,
  and D30 return remain unmeasured. Non-strict production endpoint health passes;
  Phase 10 and strict public activation remain NO-GO.
- **Funnel measurement now exists (2026-08-13):** the Recovery loop previously
  emitted no telemetry at all, so signups, activation, and return visits could
  not be answered from data. `workspace.activated` (accepted evidence) and
  `ledger.viewed` (Home read) are now emitted server-side, and `npm run funnel`
  reports signups, daily active users, users active on 2+ days, and D7/D30
  cohort return from counts only. Both event names were already in the
  `product_events` CHECK constraint, so **no migration touches production**.
  Verified live: a Customer #0 browser run emitted 3 `ledger.viewed` and 2
  `workspace.activated` rows. There is still **no web analytics** on the
  marketing pages, so visitor counts remain UNKNOWN.
- **Recovery launch identity is Google OIDC only (2026-08-10):** the bearer
  magic-link UI is removed from the Recovery login path and server readiness is
  opt-in disabled unless `ENABLE_MAGIC_LINK_LOGIN=true`. Magic link is deferred
  until verification is bound to browser intent/challenge; it is not launch
  proof and production activation now requires `google-ready`.
- **Working directory:** `/Users/varunteja/Desktop/CVT Group/Vognary` — the space
  in "CVT Group" means paths must always be quoted. This is now the **only**
  worktree; the orphaned `Vognary-gate-trust/` + `Vognary-program/` dirs (dead
  worktrees of a deleted clone) were removed with founder approval.
- **Active branch:** `recovery/v1` in the original checkout under the
  founder-authorized same-checkout exception; it is the only worktree. No agent
  may create a branch, worktree, clone, stash, merge, or rebase until Recovery v1
  reaches `main`.
- **`main`/origin is fully landed through PR #9**: Twin engine (`src/lib/twin/*`),
  RunwayStrip, AI cite-or-shut-up spine + live layer (`src/lib/server/ai/*`).
- **AI models decision (live in code):** `AI_MODELS` in `src/lib/server/ai/models.ts`
  = `{ extraction: "claude-haiku-4-5", reasoning: "claude-sonnet-5" }`.
  Dependency-injected, **inert until `ANTHROPIC_API_KEY` is set** (founder has
  committed to providing it — see founder-ops).
- **Monolith decomposition (WP-B7) underway, measured:** `vognary-mvp-client.tsx`
  is **5305 lines** (was 5442). Shared foundation now lives under
  `src/app/workspace/*`: `format.ts` (`formatCurrency`/`formatMinorCurrency`,
  India-first, now unit-tested in `tests/workspace-format.test.ts`),
  `statusStyles` in `primitives.tsx`, and `ledger-panels.tsx`
  (`RecurringGraph` + `PriorityActionPanel`). Extraction was byte-identical JSX
  re-imported into the shell — zero visual change; all gates green. Next clean
  targets are token-clean pure panels (`ConfirmDialog`, `ProofDisclosure`,
  duplicate/review panels); the renewal panels need their inline `eyebrow`
  `fontSize` literals tokenised first (they trip the token gate once un-deferred).
- **Audit delivery path shipped (guest), measured:** new deterministic engine
  `src/lib/audit-report.ts` (`buildAuditReport` + `renderAuditReportText`) composes
  the existing brief + kill-list + summary engines into ONE copy-ready plain-text
  report — monthly burn (₹, foreign kept separate), next renewals, top actions,
  UPI/NACH mandates to stop at the source, and an honest "floor, not ceiling"
  coverage note. Wired into `guest-audit-client.tsx` as a **"Deliver this audit"**
  card (Copy report / Download .txt / Preview). This is the founder's Phase-A
  hand-off: paste a prospect's receipts → copy the report → send in WhatsApp/email.
  Cite-or-shut-up: every figure traces to the deterministic audit; no invented
  amounts. Tests: `tests/audit-report.test.ts` + extended
  `tests/e2e/loop-brief-killlist.spec.ts` (report region asserted, desktop+mobile).
- **Signed-in delivery + WhatsApp-short version shipped, measured:** the SAME
  engine now backs the signed-in workspace. `renderAuditReportShareText` adds a
  chat-length projection (burn + next debit + top move + mandate count + honest
  cite line) — pure projection, no new money math. Monolith
  `vognary-mvp-client.tsx` exposes `copyAuditReport` / `copyShareReport` /
  `downloadAuditReport` (built with the workspace's real `userActions`, so top
  moves reflect the user's keep/cancel decisions) via the command palette and the
  Home overview export row (**"Copy report"** / **"Copy for WhatsApp"**). Guest
  surface gained the matching "Copy for WhatsApp" button. Tests:
  `tests/audit-report.test.ts` (7, incl. share-text + honest-degrade); guest
  e2e asserts both buttons (desktop+mobile). **Signed-in UI is NOT
  browser-verifiable here** (needs Postgres; no Docker) — it is verified by
  typecheck + `next build` bundling the chunk + a `signed-in-first-value.spec.ts`
  assertion (`Copy report` / `Copy for WhatsApp` on Home) that **skips** without
  dev-login env. **Founder to confirm the signed-in path**, run:
  `ENABLE_DEVELOPMENT_LOGIN=1 DEVELOPMENT_LOGIN_EMAIL=founder@vognary.test`
  `DEVELOPMENT_LOGIN_ACCESS_CODE=local-dev-code-123 DATABASE_URL=<pg> npm run dev`
  then `PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000`
  `VOGNARY_E2E_DEV_LOGIN_EMAIL=founder@vognary.test`
  `VOGNARY_E2E_DEV_LOGIN_CODE=local-dev-code-123 npm run test:e2e -- signed-in-first-value`.
- **Never stack PRs**; branch every work item from fresh `main`, PR against `main`.

## 2. THE PLAN — company phases (THE-LAW) + product phases (engineering)

**Company sequence (THE-LAW):** Phase **A** market proof + Phase **B** loop shipping run **in parallel** now.
Live CRM: `docs/execution/private-audit-crm.csv` · Scoreboard: `docs/execution/scoreboard.md` · Field memory (people/threads/learnings): `docs/execution/people-conversation-learning.md`

**Pre-public retention execution (agents):** [`docs/execution/pre-public-retention-wp.md`](execution/pre-public-retention-wp.md) — WP-R0…R8 under Phase A/B. Not a new strategy. Code order: one product story → first-value &lt;3 min → beat spreadsheet (changed-since) → passive inbox honesty → Phase A instruments. Founder still owns Customer #0, pay, keys, go/no-go.

**Ultimate closeout run (craft 10/10 + founder gates):** [`docs/execution/ultimate-closeout-run.md`](execution/ultimate-closeout-run.md) — paste prompt for SOL; closes critic defects D1–D10; company metrics require founder F1–F5 (never invent).

The one product loop: **evidence in (paste/upload/Gmail) → audit finds every
recurring charge → assistant brief → user decides → decision + outcome logged with proof.**

### 2a. Company phases (from THE-LAW)

| Phase | What | Status |
|---|---|---|
| **0** | Repo hygiene | **DONE 2026-07-21** |
| **A** | Market contact: 10 audits, CRM, outreach, report template | **ACTIVE** — `docs/execution/phase-a-market-contact.md` |
| **B** | Loop shipping: WP-B0…B8 architecture for agents | **TECHNICAL GATE GREEN; PRODUCTION PROOF ACTIVE** — automated Customer #0 passes; real-human <3 min evidence still pending |
| **C–F** | Production min → moat → distribution → platform | PENDING / blocked until A–B signal |

### 2b. Product engineering phases (code loop)

| Phase | What | Status |
|---|---|---|
| **0** | Repo hygiene: worktree corpses deleted, junk cleared, 14 branches pruned, docs collapsed, eslint hardened | **DONE 2026-07-21** |
| **1** | Loop undeniable: Gmail → `/app?gmail=` + celebration; landing sample labelled; guest first-result first; token gate; honest Gmail card | **largely DONE 2026-07-21** · WP-B1…B3 |
| **2** | Wire the brain: AI key + budget env; ingest AI PDF assist (fail-closed); `/api/ai/status`; **assistant brief** default home; kill-list on home; monolith decomposition underway (5442→5305) | **code DONE; live AI blocked on founder key** · WP-B4,B6,B7 |
| **3** | India-first: UPI mandate kill-list from statements (panel + engine); corpus still founder-ops | **engine+UI DONE; corpus pending** · WP-B5 |
| **4** | Full-loop e2e (`loop-brief-killlist` + first-value) + no-demo release gate | **e2e added; release:gate still ops** · WP-B8 |

**What NOT to do:** no new plan documents (THE-LAW is the plan); no features outside the loop before B exit; no design-system rewrite; no uncited AI; no Setu/Razorpay code ahead of provisioning; no `/app` route restructure during decomposition; nothing outside this repo.

**Founder-ops (only Varun):** ①~~delete orphaned dirs~~ done ② `ANTHROPIC_API_KEY`
+ ₹ cap — committed this week ③ Google restricted-scope verification for
`gmail.readonly` — start now, weeks of lead time ④ 10–20 redacted real Indian
statements for `corpus/` ⑤ Setu AA onboarding — start now ⑥ Razorpay activation
per `docs/billing-activation-runbook.md` ⑦ Resend domain + key ⑧ review tag
`archive/mentor-scorecard`.

## 3. Token gate — ready to build (lands in Phase 1)

Create `scripts/check-design-tokens.mjs` with exactly the scanner below, add
`"tokens:check": "node scripts/check-design-tokens.mjs"` to `package.json`,
insert into `ci` after `brand:check`, add unit test
`tests/design-tokens-gate.test.ts` importing `scanContent`.

Design rationale (learned from the real code — do not lose):
- Match **complete** hex only with `(?![\w-])` boundary — else `href="#add-source"`
  false-positives as `#add` (`src/app/sources/source-health-client.tsx:136`).
- **Legit exceptions:** `global-error.tsx` renders when `globals.css` failed to
  load → literal hex unavoidable; `login-client.tsx` uses Google's mandated brand
  colors for the "G".
- **Quarantine, don't ignore:** `vognary-mvp-client.tsx` is `WP4_DEFERRED` (one
  explicit dated entry) so the gate is green today and blocks *new* fragility.

```js
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const SRC = "src";

// Files that legitimately carry literal colours/dimensions, exempt in full:
// image specs (the value IS the pixel), brand-mark geometry, and the error
// boundary that renders when globals.css itself failed to load.
export const ALLOWED_FILES = new Set([
  "src/app/apple-icon.tsx",
  "src/app/icon.tsx",
  "src/app/opengraph-image.tsx",
  "src/app/twitter-image.tsx",
  "src/app/brand.tsx",
  "src/app/brand/page.tsx",
  "src/app/character.tsx", // Nakul mongoose brand-mark geometry
  "src/app/global-error.tsx", // renders WITHOUT globals.css — cannot use var(--x)
  "src/app/pwa/startup/[size]/route.tsx", // PWA splash image spec
]);

// The 281 KB monolith is quarantined here until Phase-2 decomposition. NOT a
// blanket ignore — one explicit dated file; any *new* file is fully enforced.
// TODO(Phase-2): decompose vognary-mvp-client.tsx, tokenise, delete this.
export const WP4_DEFERRED = new Set(["src/app/vognary-mvp-client.tsx"]);

// Narrowly-scoped literal exceptions with a stated reason.
export const KNOWN_EXCEPTIONS = [
  {
    file: "src/app/login/login-client.tsx",
    pattern: /#4285F4|#34A853|#FBBC05|#EA4335/,
    reason: "Google brand 'G' logo — exact colours mandated by Google brand guidelines",
  },
];

// A COMPLETE css hex colour: #RGB, #RGBA, #RRGGBB, or #RRGGBBAA. The trailing
// (?![\w-]) boundary stops href="#add-source" matching as #add.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
// Raw colour functions. color-mix( is excluded — it composes tokens.
const COLOR_FN = /\b(?:rgba?|hsla?)\(/g;
// Inline style block + a dimension literal (quoted px/rem/em) inside it. var(--x),
// template strings, and unitless ratios (lineHeight: 1.2) are left alone.
const STYLE_BLOCK = /style=\{\{[^}]*\}\}/g;
const DIM_LITERAL = /([A-Za-z]+)\s*:\s*(['"])\s*-?\d*\.?\d+(?:px|rem|em)\s*\2/g;

const isExcepted = (relPath, text) =>
  KNOWN_EXCEPTIONS.some((ex) => ex.file === relPath && ex.pattern.test(text));
const lineOf = (content, index) => content.slice(0, index).split("\n").length;

// Pure scanner — exported so the unit test can assert against synthetic fixtures.
export function scanContent(relPath, content) {
  if (ALLOWED_FILES.has(relPath) || WP4_DEFERRED.has(relPath)) return [];
  const violations = [];
  content.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(HEX)) {
      if (isExcepted(relPath, m[0])) continue;
      violations.push({ file: relPath, line: i + 1, rule: "raw-hex-color", text: m[0] });
    }
    for (const m of line.matchAll(COLOR_FN)) {
      violations.push({ file: relPath, line: i + 1, rule: "raw-color-function", text: `${m[0]}…)` });
    }
  });
  for (const block of content.matchAll(STYLE_BLOCK)) {
    for (const dim of block[0].matchAll(DIM_LITERAL)) {
      violations.push({ file: relPath, line: lineOf(content, block.index), rule: "inline-dimension-literal", text: dim[0].trim() });
    }
  }
  return violations;
}

async function collectTsxFiles(dir) {
  const entries = await readdir(resolve(root, dir), { recursive: true });
  return entries.filter((n) => n.endsWith(".tsx")).map((n) => `${dir}/${n}`);
}

async function main() {
  const files = await collectTsxFiles(SRC);
  const violations = [];
  for (const file of files) violations.push(...scanContent(file, await readFile(resolve(root, file), "utf8")));
  if (violations.length) {
    console.error("Design-token check failed — replace literals with tokens from globals.css:\n" +
      violations.map((v) => `- ${v.file}:${v.line} [${v.rule}] ${v.text}`).join("\n"));
    process.exit(1);
  }
  console.log(`Design-token check passed for ${files.length} components (${WP4_DEFERRED.size} deferred, ${ALLOWED_FILES.size} image/brand exempt).`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
```

**Burn-down map** (promote to real tokens, don't relocate literals):

| Literal | Where | Fix |
|---|---|---|
| `#17130a` (ink on gold) | `globals.css:304,459` + `command-palette.tsx`, `workspace-shell.tsx` | Promote to **`--ink-on-gold: #17130a`** in `:root`; replace all usages incl. the two inside `globals.css` |
| `rgba(243,234,214,0.04)` ×4 | `private-audit-client.tsx` | New token **`--dossier-fill`** |
| `var(--green, #2e7d32)` | `billing-return-client.tsx:132` | `--green` is undefined → use the real **`--verdict`** token |
| `fontSize: "0.58rem"` inline | front-door (`page.tsx`) + others | Add **`.eyebrow-xs`** modifier in CSS (`.eyebrow` is `0.72rem`) |
| ~62 inline styles in monolith | `vognary-mvp-client.tsx` | Deferred via `WP4_DEFERRED` until Phase-2 decomposition |

## 4. Worktree rule

### Recovery v1 same-checkout exception — founder-authorized 2026-08-09

- `recovery/v1` uses the original repository only.
- Two sibling Copilot chats may edit the same checked-out branch concurrently.
- They obey the frozen SOL/OPUS ownership map.
- No child creates a clone, worktree, branch, stash, merge, rebase, checkout, or copied repository.
- No file has simultaneous writers.
- SOL is Git owner.
- OPUS performs no Git-state mutations.
- This exception ends when Recovery v1 reaches `main`.

For all other work, use **one isolated git worktree per work item**:

```sh
cd "/Users/varunteja/Desktop/CVT Group/Vognary"
git fetch origin
git worktree add "../vognary-p1" -b feat/phase-1-loop origin/main
# …build, verify, commit, push, PR against main…
git worktree remove "../vognary-p1"
```

Never run `git checkout` in a worktree another agent is using.

## 5. Environment & gotchas (verified)

- **Tests:** `node --conditions=react-server --import=tsx --test tests/*.test.ts`.
  **Clear `DATABASE_URL`** for local smoke (`unset DATABASE_URL`).
- **Gate chain before any merge:** `eslint → tsc --noEmit → claims:check →
  tokens:check → test → build → perf:budget`.
- **`AGENTS.md`: this is a *modified* Next.js** — read
  `node_modules/next/dist/docs/` before writing route/server-component code.
- **Honesty gate is real:** `scripts/check-public-claims.mjs` fails the build on
  over-claims; merchants are *watched*, sources *connected*.
- **AI is inert until keyed:** needs founder's `ANTHROPIC_API_KEY` + monthly ₹
  cap; degrades to deterministic-only without them.
- **CI-referenced docs (never archive):** `docs/platform-api.md`
  (`check-public-claims.mjs`), `docs/research-content-pack-2026-07-16.md`
  (`check-research-content-pack.mjs`).
