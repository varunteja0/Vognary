---
name: next16-docs
description: Read the correct Next.js 16 docs before writing App Router code. Use before any src/app change.
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Next.js 16 local docs

This repo runs `next@16.3.0` with `react@19.2.4`. **This version has breaking
changes from what is in your training data** — APIs, conventions, and file
structure may all differ.

## Read the local docs first

```bash
ls node_modules/next/dist/docs/
```

Expected:

```
01-app  02-pages  03-architecture  04-community  index.md
```

`01-app` is the App Router — that is the one this repo uses.

## If that path is empty

You are in a fresh harness worktree. Worktrees start from committed state and have
no `node_modules`, so the rule resolves to nothing and you will confidently write
Next 15 idioms from memory. That is the exact failure this rule prevents.

```bash
nvm use 22.23.2 && npm ci
```

Then re-run the `ls`. Do not write App Router code until it lists those entries.

## Use them

- Find the guide for the API you are about to touch and read it before writing.
- **Heed deprecation notices.** They are the highest-value part of these docs.
- When your memory disagrees with the local docs, the local docs win — they are
  the version actually installed.
- Prefer the documented Next 16 form over the familiar older form, even when the
  older form still compiles. Compiling is not the bar.
