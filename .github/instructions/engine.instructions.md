---
applyTo: 'src/lib/**/*.ts'
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Engine rules

This is deterministic logic that decides what a company may commit to.

- **Failing test first.** Write the test, watch it fail for the right reason, then
  implement. No exceptions for "small" changes.
- **Deterministic.** Same input, same output. No wall-clock reads, no
  `Math.random()`, no network, no ambient env in the decision path. If a policy
  needs "now", pass it as an argument.
- **Never invent** an amount, merchant, vendor, price, or connector liveness.
  Values come from the caller or a file you read. Label fixtures as fixtures.
- **No autonomous action.** Nothing here may auto-approve, auto-deny, purchase,
  provision, cancel, or move money. The engine proposes and evaluates; a human
  authorizes.
- `npm test` runs with `DATABASE_URL` **unset**. Use `env -u DATABASE_URL npm test`
  if your shell exports it.
- Errors carry enough context to act on. An error a human cannot act on is a bug.
