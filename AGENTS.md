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
