# CONTINUE HERE — session handoff (2026-07-21)

> **New chat: read this first, then `docs/execution-plan-ui-ai-quality.md`
> (the WP-0…WP-6 spec) and `docs/master-build-plan.md` (Parts 3 & 5, the law).**
> This file is the live state + the two things not yet in those docs: the
> **India-first priority** and the **ready-to-use WP-1 token gate** carried over
> from a parallel chat.

---

## 0. Prime directive added this session — INDIA-FIRST, world-second (both required)

The founder is in India. **Every surface must let an Indian track their recurring
money first-class before anything else, and the world must work too.** This is a
priority ordering, not an either/or.

- **India-first, concretely:** default currency **₹ (INR)**; Indian number
  formatting (lakh/crore where natural, `formatMoney` already lives in
  `@/lib/format`); Indian recurring rails as first-class citizens —
  **UPI AutoPay mandates, card e-mandates, SIPs, EMIs, EPF, app-store receipts
  (Play/App Store India), Indian bank-statement + receipt formats**; Indian date
  formatting; copy that names Indian rails by name. The deterministic engines
  already understand these (`recurring-audit.ts`, `renewal-timeline.ts`); the UI
  must **surface them prominently**, not bury them under US-centric framing.
- **World-second:** multi-currency + international rails work, but are the
  secondary path — never at the expense of the India experience. When a component
  takes a currency/locale, **default to India** and make world an explicit opt-in.
- **Apply this to every WP below:** WP-2 components (`LedgerRow`, `RunwayStrip`,
  `RenewalTimeline`) render ₹ + Indian cadences by default; WP-3 front-door copy
  leads with Indian rails; WP-5 AI narration speaks in ₹ and Indian rail terms.
- This deepens the master plan's existing identity ("built India-first") — it does
  not conflict with it. Honesty invariant still holds: name a rail only at its
  proven `*_STATUS`.

---

## 1. Where things actually stand (verified 2026-07-21)

- **Working directory:** `/Users/varunteja/Desktop/CVT Group/Vognary` — **note the
  space in "CVT Group"; always quote paths.** `Vognary-program/` is a *second git
  worktree* (branch `feat/mentor`) — do not touch. `Vognary-gate-trust/` is an
  untracked stray build-artifact dir (see gotchas).
- **`main` is in the correct full state.** PRs #1–#9 are all MERGED. On `main`:
  Twin engine (`src/lib/twin/*`), RunwayStrip (`src/app/runway-strip.tsx`), the AI
  "cite-or-shut-up" spine + **live layer** (`src/lib/server/ai/*`:
  `citations/reconcile/budget/client/models/pricing/extract/narrate`), the
  execution plan, and the master plan.
- **The cost decision is live on `main`:** `AI_MODELS` in
  `src/lib/server/ai/models.ts` = `{ extraction: "claude-haiku-4-5", reasoning:
  "claude-sonnet-5" }` (Sonnet 5 ≈ Opus quality at ~40% less; extraction on Haiku
  because `reconcile.ts` catches its arithmetic errors). Dependency-injected +
  **inert until `ANTHROPIC_API_KEY` is set**.
- **A stranding hazard already bit us once** and was fixed by PR #9 (cherry-pick):
  stacked PRs (#7/#8) were merged into bases that had *already* merged to `main`,
  so their content stranded off `main`. **Rule: branch every WP from fresh `main`
  and open PRs against `main` directly — never stack PRs on top of each other.**
- **A parallel chat collision already happened** (this is why isolated worktrees
  are invariant #1 — see §4). Two agents edited the same working tree; the token
  gate script was created then removed mid-flight. The second chat is now stopped;
  its best work is preserved in §3 below.
- **Loose end:** local branch `feat/ui-token-gate` @ `d6cc42b` adds a `--gold-ink`
  token + 3 hex burn-downs. It is **superseded** by the more thorough WP-1 in §3
  (which promotes the same color to `--ink-on-gold` *and* fixes the two hardcoded
  copies inside `globals.css` itself). Prefer §3; discard/rename `d6cc42b`.

## 2. The plan (already on `main` as `docs/execution-plan-ui-ai-quality.md`)

WP-0 (land intended state) **DONE** via PR #9. Remaining, in order:

| WP | What | Depends on | Notes |
|---|---|---|---|
| **WP-1** | Design-token enforcement gate | — (parallel-safe) | Ready to drop in — see §3 |
| **WP-2** | Shared component inventory `src/app/components/*` | WP-1 | **Blocks WP-3/WP-4.** India-first defaults. Highest-leverage next build. |
| **WP-3** | Front-door refactor + visual polish (`page.tsx`, `guest-audit-client.tsx`, `instant-audit.tsx`) | WP-2 | India-first copy; axe 0; perf budget; screenshots |
| **WP-4** | Decompose the 281 KB monolith `vognary-mvp-client.tsx` → `src/app/workspace/*` | WP-2 | Sub-PRs 4a–4d; kills 62 inline `style={{}}` |
| **WP-5** | AI live routes (`compile.ts` + `/api/…/ask`, `/api/ingest`; live budget via `src/lib/rate-limit.ts`) | WP-2 | **Needs `ANTHROPIC_API_KEY` + monthly ₹ cap.** Read `node_modules/next/dist/docs/` first. |
| **WP-6** | Seal gates as the merge wall | WP-1 + first UI PRs | Add `tokens:check` to `release:gate` |

**Recommended next action for the new chat:** in a **fresh isolated worktree off
`main`**, land **WP-1** (drop in §3), then **WP-2** (the visible-quality
foundation everything composes from). WP-5 waits on the founder's key.

## 3. WP-1 — the token gate, ready to build (carried from the stopped chat)

The parallel chat designed a scanner better than the plan's naive regex. **Create
`scripts/check-design-tokens.mjs` with exactly this, add `"tokens:check": "node
scripts/check-design-tokens.mjs"` to `package.json`, insert it into the `ci`
script after `brand:check`, and add a failing-first unit test
`tests/design-tokens-gate.test.ts` importing `scanContent`.**

Design rationale (do not lose these — they were learned from the real code):
- Match **complete** hex only, with a `(?![\w-])` boundary — otherwise
  `href="#add-source"` false-positives as color `#add`
  (`src/app/sources/source-health-client.tsx:136`).
- **Legit exceptions:** `src/app/global-error.tsx` renders when `globals.css`
  itself failed to load → literal hex is unavoidable; `login-client.tsx` uses
  Google's mandated brand colors (`#4285F4 #34A853 #FBBC05 #EA4335`) for the "G".
- **Quarantine, don't ignore:** the 281 KB `vognary-mvp-client.tsx` is
  `WP4_DEFERRED` (one explicit dated entry) so the gate is green today and blocks
  *new* fragility everywhere else.

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

// The 281 KB monolith is quarantined here until WP-4 decomposes it. NOT a blanket
// ignore — one explicit dated file; any *new* file is fully enforced.
// TODO(WP-4): decompose vognary-mvp-client.tsx, tokenise its literals, delete this.
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
  console.log(`Design-token check passed for ${files.length} components (${WP4_DEFERRED.size} deferred to WP-4, ${ALLOWED_FILES.size} image/brand exempt).`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
```

**WP-1 burn-down map** (run the gate; make each remaining violation green by
promoting to a real token, not by relocating the literal):

| Literal | Where | Fix |
|---|---|---|
| `#17130a` (ink on gold) | `globals.css:304,459` + `command-palette.tsx`, `workspace-shell.tsx` | Promote to a token **`--ink-on-gold: #17130a`** in `:root`; replace all usages incl. the two inside `globals.css`. (Supersedes the `--gold-ink` name on branch `feat/ui-token-gate`.) |
| `rgba(243,234,214,0.04)` ×4 | `private-audit-client.tsx` | New token **`--dossier-fill`**; replace the 4 warm-parchment fills |
| `var(--green, #2e7d32)` | `billing-return-client.tsx:132` | `--green` is undefined (only the hex fallback renders) → use the real **`--verdict`** token |
| `fontSize: "0.58rem"` inline | front-door (`page.tsx`) + others | Add a **`.eyebrow-xs`** modifier in the CSS layer (`.eyebrow` is `0.72rem`); use the class, drop the inline literal |
| `rgba(...)` / `fontSize` in monolith (~62 inline styles, ~30 micro-type) | `vognary-mvp-client.tsx` | **Deferred to WP-4** via `WP4_DEFERRED` — do not tokenise here |

## 4. The one rule that prevents the mess we just hit

**One isolated git worktree per WP (invariant #1).** Two chats sharing the main
working tree clobber each other's uncommitted files and commit onto whatever
branch HEAD happens to point at. For each WP:

```sh
cd "/Users/varunteja/Desktop/CVT Group/Vognary"
git fetch origin
git worktree add "../vognary-wp1" -b feat/wp1-token-gate origin/main   # work in ../vognary-wp1
# …build, verify, commit, push, open PR against main…
git worktree remove "../vognary-wp1"
```

Never run `git checkout` in a worktree another agent is using.

## 5. Environment & gotchas (all verified this session)

- **Local `npm run ci` fails on a clean branch** because bare `eslint` crawls the
  untracked `Vognary-gate-trust/.next/` build artifacts (~2,135 false errors).
  Validate with `npx eslint --ignore-pattern 'Vognary-gate-trust/**'`. Real CI
  (fresh checkout) is unaffected. Removing the dir is destructive → ask founder.
- **Tests:** `node --conditions=react-server --import=tsx --test tests/*.test.ts`.
  **Clear `DATABASE_URL`** for local smoke (`unset DATABASE_URL`).
- **Gate chain before any merge:** `eslint (ignore stray dir) → tsc --noEmit →
  claims:check → tokens:check → test → build → perf:budget`. (389 tests green on
  `main` right now.)
- **`AGENTS.md`: this is a *modified* Next.js** — read the guide in
  `node_modules/next/dist/docs/` before writing any route/server-component code
  (matters for WP-5).
- **Honesty gate is real:** `scripts/check-public-claims.mjs` fails the build on
  over-claims; merchants are *watched*, sources *connected*; name a rail only at
  its proven `*_STATUS`.
- **AI is inert until keyed:** WP-5 needs the founder's `ANTHROPIC_API_KEY` + a
  monthly ₹ spend cap; it degrades to deterministic-only without them.

## 6. First message to paste into the new chat

> Continue the Vognary UI/UX + AI leap. Read `docs/CONTINUE-HERE.md` then
> `docs/execution-plan-ui-ai-quality.md`. Priority is **India-first, world-second**
> (§0). `main` is fully landed through PR #9. Work in an **isolated worktree off
> `main`** (§4). Build **WP-1** (the ready scanner in §3) then **WP-2** (India-first
> shared components). Don't stack PRs; verify with the gate chain (§5). WP-5 waits
> on my `ANTHROPIC_API_KEY` + monthly ₹ cap.
