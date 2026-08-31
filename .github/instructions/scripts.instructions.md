---
applyTo: 'scripts/**/*.mjs,scripts/**/*.ts'
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Gate script rules

These scripts are gates. CI trusts their exit codes, so the exit code is the
contract.

- **Exit `0` only on genuine pass.** Exit non-zero on failure. Never swallow an
  error, never `|| true`, never exit `0` in a `catch` to keep CI green.
- A gate that cannot run is a **failure**, not a pass. Missing input, missing
  dependency, or unreadable file must exit non-zero with a message saying which.
- Output names the offending file and line, states what is wrong, and states what
  would fix it. A gate a human cannot act on is a broken gate.
- Deterministic: same repo state, same result. No network, no clock-dependent
  thresholds.
- Never weaken a threshold to make a gate pass. Raising or lowering a gate bar is a
  founder decision.
- Node `22.23.2` with `engine-strict=true`. Use built-in modules where practical;
  a new dependency in a gate needs a real justification.
- Scripts read the repo. They do not mutate source to satisfy themselves.
