# AGENTS — mandatory instructions for every model and coding agent

## 0. Read order (do this before writing code or plans)

1. **[`docs/THE-LAW.md`](docs/THE-LAW.md)** — company + product + agent supreme directive  
2. **[`docs/CONTINUE-HERE.md`](docs/CONTINUE-HERE.md)** — live handoff (what is true *this week*)  
3. **[`docs/execution/phase-a-market-contact.md`](docs/execution/phase-a-market-contact.md)** — if work touches audits, GTM, CRM, outreach  
4. **[`docs/execution/phase-b-loop-shipping.md`](docs/execution/phase-b-loop-shipping.md)** — if work touches the product loop  
5. Then only as needed: `docs/execution-plan-ui-ai-quality.md`, `docs/master-build-plan.md`, production runbooks  

**If THE-LAW conflicts with older docs:** THE-LAW wins on strategy. CONTINUE-HERE wins on live branch/env state.  
**Do not** create new master/leap/perfection plans. Update scoreboard evidence or CONTINUE-HERE status only.

## 1. What we are building

Evidence-first **recurring-money audit**, India-first, honesty-enforced.  
Loop: evidence in → find recurring → assistant brief → user decides → outcome with proof.  
AI must **cite or shut up**. Never invent amounts, merchants, or connector liveness.

## 2. Working rules

- Isolated **git worktree** per work package from fresh `main`; PR against `main`; no stacked PRs, except for the founder-authorized Recovery v1 exception below
- Path with spaces: quote `"/Users/varunteja/Desktop/CVT Group/Vognary"`  
- Before merge: `lint` · `typecheck` · `claims:check` · `tokens:check` · `test` · then `build` · `perf:budget`  
- Engine changes: **failing test first**  
- Prefer `src/app/workspace/*` over growing `vognary-mvp-client.tsx`  
- Founder-only ops: API keys, Google verification, Razorpay, legal, Setu — agents prepare, never fake READY  

### Recovery v1 same-checkout exception — founder-authorized 2026-08-09

- `recovery/v1` uses the original repository only.
- Two sibling Copilot chats may edit the same checked-out branch concurrently.
- They obey the frozen SOL/OPUS ownership map.
- No child creates a clone, worktree, branch, stash, merge, rebase, checkout, or copied repository.
- No file has simultaneous writers.
- SOL is Git owner.
- OPUS performs no Git-state mutations.
- This exception ends when Recovery v1 reaches `main`.

## 3. Hard stops

No new connectors (except Gmail/statement India path), no design-system rewrite, no uncited AI, no platform sales theater, no PII in git, no work outside this repo, no $100B-feature justifications that skip Stage 0 metrics.

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
[ ] List files; open worktree from main unless the Recovery v1 same-checkout exception applies
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
