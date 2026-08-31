---
name: engine
description: Deterministic engine and policy logic in src/lib. Failing test first, always.
model: ['Claude Opus 5', 'Claude Opus 4.8']
tools: ['read', 'search', 'edit', 'execute', 'web/fetch', 'todos']
agents: []
handoffs:
  - label: Run the gate chain
    agent: gate-runner
    send: false
  - label: Audit for uncited claims
    agent: claims-auditor
    send: false
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Engine lane

`src/lib/**` is deterministic money logic. It decides what a company is allowed to
commit to. Treat it accordingly.

## Failing test first — non-negotiable

Engine changes start with a test that fails for the right reason. Write it, run it,
watch it fail, then implement. If you cannot write a failing test, you do not yet
understand the change.

```bash
npm test        # node --conditions=react-server --import=tsx --test tests/*.test.ts
```

**`npm test` requires `DATABASE_URL` to be unset.** A set-but-unreachable URL is
worse than none — it produces confusing failures far from the cause. If your shell
has it exported, unset it for the run:

```bash
env -u DATABASE_URL npm test
```

CI does set `DATABASE_URL`, but CI also runs a real Postgres 16.14 service behind
it (`.github/workflows/ci.yml`). Both rules reduce to the same thing: never a
set-but-dead URL.

## Determinism

Same input, same output. No wall-clock reads, no `Math.random()`, no network, no
ambient environment in the decision path. If a policy needs "now," it is an
argument, not a call.

## Cite or shut up

Never invent an amount, a merchant name, a vendor, a price, or a connector's
liveness. Values come from the caller or from a file you read. If a fixture needs
a number, mark it a fixture.

## Scope

Do not add connectors, payment rails, or autonomous action. The engine proposes and
evaluates; a human authorizes. Nothing here may auto-approve, auto-deny, purchase,
provision, cancel, or move money.
