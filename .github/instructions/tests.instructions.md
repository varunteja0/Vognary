---
applyTo: 'tests/**/*.ts'
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Test rules

Runner is Node's built-in `node:test` via `tsx`:

```bash
npm test   # node --conditions=react-server --import=tsx --test tests/*.test.ts
```

- **`DATABASE_URL` must be unset** for `npm test`. A set-but-unreachable URL
  produces failures far from their cause. Use `env -u DATABASE_URL npm test`.
- `--conditions=react-server` is load-bearing. Dropping it resolves the wrong
  export condition and imports fail in ways that look unrelated.
- Postgres-backed tests are separate: `npm run test:postgres` needs `DATABASE_URL`,
  the dev secrets, and a role with `CREATEDB` (it creates disposable databases).
- A test asserts **behaviour**, not implementation detail. If a refactor that
  preserves behaviour breaks the test, the test is wrong.
- Engine changes start here — the failing test comes before the implementation.
- Fixtures use obviously-fake values. Never a real customer name, email, phone,
  company, or amount. No PII in this repo, ever.
