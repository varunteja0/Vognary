---
name: worktree-session
description: Bootstrap a fresh VS Code harness worktree so gates and Next 16 docs actually work. Use at the start of any worktree session.
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Worktree session bootstrap

A harness worktree starts from **committed** Git state. It therefore has **no
`node_modules`**, and — because `.gitignore` line 49 matches `.env*` — **no
`.env.local`**. Two rules in this repo silently resolve to nothing until you fix
that:

- AGENTS.md §4 says read `node_modules/next/dist/docs/` — an empty path in a fresh
  worktree, so the agent writes Next.js from stale memory.
- Signed-in, DB-backed, and `test:postgres` work needs the dev secrets.

## Bootstrap

```bash
nvm use 22.23.2        # engine-strict=true rejects any other Node
node --version         # must print v22.23.2
npm --version          # must print 10.9.8
npm ci
ls node_modules/next/dist/docs/    # must list 01-app 02-pages 03-architecture 04-community index.md
```

If `ls` is empty, stop. Nothing downstream is trustworthy.

## Dev secrets

`.env.local` is gitignored and does not travel into a worktree. Either set
`git.worktreeIncludeFiles` to `[".env.local"]` in workspace settings, or copy it
once:

```bash
cp "/Users/varunteja/Desktop/CVT Group/Vognary/.env.local" .
```

**Copy `.env.local` only. Never `.env.production.local`.** Worktree sessions run at
Bypass Approvals — an agent with no confirmation prompts must not hold production
credentials. `.env.local` points at `localhost:5432`, which is why it is safe.

## Branch and merge

- Branch name: `agents/<slug>`, matching the worktree folder under
  `Vognary.worktrees/<slug>`.
- Hand-rolled `../vognary-*` siblings and clones remain **banned**.
- **One Git owner merges to `main`.** Agents do not merge.
- Run the full gate chain before proposing a merge.

## Cleanup

From the **main checkout**, never from inside the worktree:

```bash
git worktree remove "Vognary.worktrees/<slug>"
```

Never `--force`. If it refuses, there is uncommitted work — go look at it.
