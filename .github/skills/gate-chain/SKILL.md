---
name: gate-chain
description: Run the CI gate chain in the correct order and interpret failures. Use before proposing any merge.
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Gate chain

Authoritative order is `.github/workflows/ci.yml`. Run it locally in the same order
so a local green means something.

## Runtime contract

CI asserts this exactly, and `.npmrc` sets `engine-strict=true`:

```bash
node --version   # v22.23.2
npm --version    # 10.9.8
```

## The chain

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run ci:database     # when migrations or stores are touched
npm run lint
npm run typecheck
npm run claims:check
npm run research:check
npm run brand:check
npm run tokens:check
npm test                # DATABASE_URL must be UNSET locally
npm run corpus
npm run build
npm run perf:budget
```

CI continues past this with `perf:lighthouse`, `test:e2e`, signed-in e2e journeys
under development login, and `npm run smoke`. Those need Chromium and a running
server. **If you have not run them, say so** — do not imply full coverage.

## `npm run ci` is not the whole chain

It **omits `ci:database` and `corpus`**, both of which CI runs. A green
`npm run ci` is not a green CI. Run the list above.

## Interpreting failures

| Symptom | Cause | Fix |
|---|---|---|
| `EBADENGINE` | wrong Node | `nvm use 22.23.2` |
| `claims:check` fails | uncited number or unproven claim reached a doc or UI string | cite it or delete it |
| `research:check` fails | a research claim lost its source | restore the citation |
| `brand:check` fails | off-brand or banned phrasing | use approved language |
| `tokens:check` fails | raw hex or ad-hoc spacing | use design tokens |
| `npm test` connection errors | `DATABASE_URL` is set | `env -u DATABASE_URL npm test` |
| `test:postgres` cannot create db | role lacks `CREATEDB` | grant it |
| `build` fails but `dev` works | Server/Client boundary, or a build-time env var | check `'use client'` placement |
| `perf:budget` fails | bundle grew past budget | find the import, do not raise the budget |

## Never weaken a gate

No `--force`, no `--no-verify`, no skipping, no editing thresholds to pass. Fix the
cause. If a gate is genuinely wrong, stop and escalate — that is a founder call.
