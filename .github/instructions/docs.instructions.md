---
applyTo: 'docs/**/*.md'
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Docs rules

- **Cite or shut up.** Every amount, percentage, count, date, and status traces to
  a file, a command output, or a named human decision. If you cannot trace it,
  write "not measured" — not a guess.
- **Do not create new master / leap / perfection plans.** Update
  `docs/CONTINUE-HERE.md` status or `docs/execution/scoreboard.md` evidence only.
- Precedence: `docs/THE-LAW.md` wins on strategy; `docs/CONTINUE-HERE.md` wins on
  live branch and environment state.
- In `CONTINUE-HERE.md`, exactly one block is live and it says so. Superseding a
  block means marking the old one SUPERSEDED with a date — never silently editing
  history.
- Scoreboard: the composite is the **minimum** row. Empty cells mean *not
  measured*, never *zero* and never *passing*.
- **No PII.** No prospect names, emails, phone numbers, or company contacts.
  Outreach CRM CSVs stay gitignored.
- Founder-only ops (API keys, Google verification, Razorpay, legal, Setu) are never
  marked READY by an agent. Prepare them; do not claim them.
- No paid-customer or revenue claims without evidence in this repo.
