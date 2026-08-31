---
name: scoreboard-evidence
description: Rules for editing docs/execution/scoreboard.md. Use before claiming any metric moved.
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Scoreboard evidence

`docs/execution/scoreboard.md` is the honest record. It is worth exactly as much as
its weakest claim.

## The two rules that get broken most

**1. The composite is the MINIMUM row.**

Raising a row that is not currently the minimum does **not** raise the composite.
Before claiming progress, check which row is the minimum. If you raised a different
row, the honest statement is "row X rose from A to B; the composite is unchanged
because row Y is still the minimum at Z."

**2. An empty cell means NOT MEASURED.**

It does not mean zero. It does not mean passing. It does not mean failing. If you
did not measure it, leave it empty and say it is unmeasured. Filling an empty cell
with a guess is the single most damaging edit possible here.

## Evidence standard

Every number carries a source: a command that produced it, a file that contains
it, or a named human decision with a date. Write the source next to the number.

If you cannot produce the source, you cannot write the number.

## Forbidden

- Inventing or estimating a metric
- Rounding in the flattering direction
- Claiming paying customers, pilots, revenue, or signed agreements without
  evidence in this repo
- Marking founder-only ops (API keys, Google verification, Razorpay, legal, Setu)
  as READY — agents prepare these, never claim them
- Recording a metric from a run you did not actually complete
- Changing a target to match a result

## When a metric got worse

Record it. A scoreboard that only moves up is not a scoreboard. A regression
recorded honestly is more valuable than a gain you cannot defend.
