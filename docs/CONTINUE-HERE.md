# CONTINUE HERE — live handoff (2026-07-21, post-THE-LAW)

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

## 1. Where things stand (verified 2026-07-21, after Phase 0 cleanup)

- **Working directory:** `/Users/varunteja/Desktop/CVT Group/Vognary` — the space
  in "CVT Group" means paths must always be quoted. This is now the **only**
  worktree; the orphaned `Vognary-gate-trust/` + `Vognary-program/` dirs (dead
  worktrees of a deleted clone) were removed with founder approval.
- **Branches:** only `docs/continue-here` (superset, live) and `main` (synced to
  origin) remain locally. All 14 stale branches deleted; the one arguably-unique
  commit is preserved as tag `archive/mentor-scorecard` (7f1d25e).
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
  amounts. Tests: `tests/audit-report.test.ts` (5) + extended
  `tests/e2e/loop-brief-killlist.spec.ts` (report region asserted, desktop+mobile,
  4/4 green). Not yet wired into the signed-in monolith surface (needs DB to
  verify; the pure engine is ready to adopt there).
- **Never stack PRs**; branch every work item from fresh `main`, PR against `main`.

## 2. THE PLAN — company phases (THE-LAW) + product phases (engineering)

**Company sequence (THE-LAW):** Phase **A** market proof + Phase **B** loop shipping run **in parallel** now.
Live CRM: `docs/execution/private-audit-crm.csv` · Scoreboard: `docs/execution/scoreboard.md`

The one product loop: **evidence in (paste/upload/Gmail) → audit finds every
recurring charge → assistant brief → user decides → decision + outcome logged with proof.**

### 2a. Company phases (from THE-LAW)

| Phase | What | Status |
|---|---|---|
| **0** | Repo hygiene | **DONE 2026-07-21** |
| **A** | Market contact: 10 audits, CRM, outreach, report template | **ACTIVE** — `docs/execution/phase-a-market-contact.md` |
| **B** | Loop shipping: WP-B0…B8 architecture for agents | **ACTIVE** — `docs/execution/phase-b-loop-shipping.md` |
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

**One isolated git worktree per work item.** For each:

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
