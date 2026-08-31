# AGENTS — mandatory instructions for every model and coding agent

> **Operating motto: Take smart risks. Do not play safe.** Pursue asymmetric,
> falsifiable upside and bound irreversible downside. The full doctrine in
> [`docs/THE-LAW.md`](docs/THE-LAW.md) outranks incremental scope convenience.

## 0. Read order (do this before writing code or plans)

1. **[`docs/THE-LAW.md`](docs/THE-LAW.md)** — company + product + agent supreme directive
2. **[`docs/CONTINUE-HERE.md`](docs/CONTINUE-HERE.md)** — live handoff (what is true *this week*)
3. **[`docs/execution/phase-a-market-contact.md`](docs/execution/phase-a-market-contact.md)** — if work touches audits, GTM, CRM, outreach
4. **[`docs/execution/phase-b-loop-shipping.md`](docs/execution/phase-b-loop-shipping.md)** — if work touches the product loop
5. Then only as needed: `docs/execution-plan-ui-ai-quality.md`, `docs/master-build-plan.md`, production runbooks

**If THE-LAW conflicts with older docs:** THE-LAW wins on strategy. CONTINUE-HERE wins on live branch/env state.
**Do not** create new master/leap/perfection plans. Update scoreboard evidence or CONTINUE-HERE status only.

## 1. What we are building

**Founder scope freeze (2026-08-25): Commitment Control replaces Commitment Intelligence.** Vognary is the human-authorized commitment firewall for India-first, 5–100-person AI-native companies: proposed obligation → policy context → human authorization → approved cap → observed outcome. Recovery remains the evidence and reconciliation foundation.

Current loop: user-entered proposal → cited existing exposure → deterministic policy → owner/admin decision → frozen cap → later Recovery evidence → reconciliation.

Build only the thin ten-day V0 needed for paid pilots at ₹14,999/month. V0 never auto-approves, auto-denies, purchases, provisions, cancels, or moves money. Do **not** build cards, wallets, payments, autonomous agents, Slack, Gmail OAuth, bank connectors, automatic merchant matching, procurement suites, contract negotiation, or a public redesign. Existing billing evidence may reconcile an approved proposal.

AI must **cite or shut up**. Never invent amounts, merchants, or connector liveness.

## 2. Working rules

- **Live checkout (founder override, 2026-08-18):** stay in `"/Users/varunteja/Desktop/CVT Group/Vognary"` on `main`. Do **not** `git worktree add ../vognary-*`, do not clone a sibling folder, and do not redo merged WP-A / PR #34. Parked copies belong in `.fallow/` (gitignored). Isolated-worktree-per-WP resumes only after CONTINUE-HERE names it again.
- **Harness worktrees (founder authorization, 2026-08-31):** worktrees created by the VS Code agent harness under `Vognary.worktrees/<slug>` on `agents/<slug>` branches **are** authorized. Hand-rolled `../vognary-*` siblings and clones remain banned. One Git owner merges to `main`. A fresh worktree has **no `node_modules`** and **no `.env.local`** (`.gitignore` line 49 matches `.env*`) — run `nvm use 22.23.2 && npm ci` and supply `.env.local` before any gate, or §4's Next.js docs rule silently resolves to an empty path. Copy `.env.local` only, never `.env.production.local`: worktree sessions run at Bypass Approvals.
- Path with spaces: quote `"/Users/varunteja/Desktop/CVT Group/Vognary"`
- Before merge: `lint` · `typecheck` · `claims:check` · `tokens:check` · `test` · disposable `test:postgres` when the WP touches migrations/stores · then `build` · `perf:budget`
- Engine changes: **failing test first**
- Use the canonical `src/app/workspace/*` implementation; do not recreate the retired monolith.
- Founder-only ops: API keys, Google verification, Razorpay, legal, Setu — agents prepare, never fake READY

### Commitment Control loop — same-repo sequential branch

Commitment Control V0 continues on `main` in this folder. One Git owner. No hand-rolled sibling folders; harness worktrees under `Vognary.worktrees/` on `agents/*` branches are authorized and merge back to `main`. Do not invent payments, usage, readiness, or reviewer approvals.

## 3. Hard stops

No new connectors, payment rails, autonomous action, design-system rewrite, uncited AI, platform sales theater, PII in git, work outside this repo, or $100B-feature justifications that skip the paid-pilot gates.

## 4. Next.js note

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 5. Session start checklist

```text
[ ] Read docs/THE-LAW.md
[ ] Read docs/CONTINUE-HERE.md
[ ] State scoreboard row + loop step this task raises
[ ] List files; work in the main checkout on the CONTINUE-HERE branch, or in a harness worktree on an `agents/*` branch. Never a hand-made sibling folder.
[ ] Implement; tests; gate chain
[ ] Update CONTINUE-HERE / docs/execution/scoreboard.md if phase evidence changed
```

## Cursor Cloud specific instructions

Single Next.js 16 app (`vognary-web`). Standard commands live in `README.md` and
`package.json` `scripts`; only the non-obvious cloud gotchas are below.

- **Node version is enforced.** `.npmrc` sets `engine-strict=true` and `engines`
  requires Node `>=22.22.2 <23` (`.nvmrc` pins `22.23.2`). The VM ships a system
  `/exec-daemon/node` (22.14.0) that fails engine-strict, so `~/.bashrc` has been
  set up to prepend the nvm-managed `v22.23.2` bin to `PATH`. Any new shell already
  resolves the correct `node`/`npm`; if you ever see `EBADENGINE`, run
  `nvm use 22.23.2` (or `nvm install 22.23.2`) before npm commands.
- **Run the app:** `npm run dev` (Turbopack, http://localhost:3000). Liveness:
  `curl http://localhost:3000/api/health`. The guest audit loop needs **no**
  external services — `POST /api/audit` and the deterministic engine work with zero
  env. `npm run build` also succeeds with no env.
- **PostgreSQL** is installed natively (not Docker — Docker is absent). Start it with
  `sudo pg_ctlcluster 16 main start`. Role/DB `vognary`/`vognary`/`vognary` on
  `127.0.0.1:5432`; the role has `CREATEDB` (required — the `test:postgres`
  migration tests spin up disposable databases). Connection string:
  `postgres://vognary:vognary@127.0.0.1:5432/vognary` with `POSTGRES_SSL=false`.
  `docker compose up` is an equivalent alternative but not needed here.
- **Signed-in / DB-backed features need dev secrets** (same values as
  `docker-compose.yml`): `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` (64 hex chars),
  `INTERNAL_SYNC_SECRET`, `CRON_SECRET`, `ALLOW_IN_MEMORY_RATE_LIMITS=true`, plus
  `DATABASE_URL`/`POSTGRES_SSL`. Apply schema/migrations before use:
  `DATABASE_URL=... POSTGRES_SSL=false npm run db:apply-schema`.
- **Development (code) login** for browsing `/app` without Google: set
  `ENABLE_DEVELOPMENT_LOGIN=true` (must be the literal string `true`, not `1`) with
  `DEVELOPMENT_LOGIN_EMAIL` + `DEVELOPMENT_LOGIN_ACCESS_CODE`. `/app` redirects to
  `/login` when unauthenticated; the code-login form is hidden under the
  **"Other ways to sign in"** disclosure on `/login`. Google OAuth is the only other
  identity and requires founder-provisioned credentials.
- **Tests:** `npm test` (unit) must run with `DATABASE_URL` **unset**.
  `npm run test:postgres` needs `DATABASE_URL` + the dev secrets above and a running
  Postgres with a `CREATEDB` role.
