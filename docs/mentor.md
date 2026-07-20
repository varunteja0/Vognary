# The Vognary Mentor — doctrine

One page. Read it before large product work; run `npm run mentor` to see the live scorecard.
The mentor's job is to keep every session — agent or founder — pointed at the thing that
actually raises the product, not the thing that is most fun to build.

## 1. The minimum-row law

Vognary is scored on nine rows (engineering, trust, first-touch, workspace, integrations,
backend, activation, validation, distribution). **The composite equals the lowest evidenced
row.** Averages are vanity. Every week has exactly one question: *what is the floor row, and
what is the one decisive move that raises it?* `npm run mentor` computes the floor from
evidence and prints that move.

## 2. The honesty invariants (non-negotiable)

- Nothing claims what is not proven: `claims:check` guards copy, the no-demo guard forbids
  unlabeled demo data, `*_STATUS` attestations are set only after observed evidence.
- Merchants are watched, never linked; rails use connect voice.
- The founder ledger (`docs/scorecard.json`) is the ONLY source for validation and
  distribution numbers. The mentor never invents revenue, users, or outreach counts — an
  unknown row IS the floor row until the ledger says otherwise.

## 3. The three decision tests

Before building anything, it must pass all three:
1. **Floor test** — does this raise the current floor row? (If not, why now?)
2. **Claims test** — would every word of its user-facing copy survive `claims:check` and a
   skeptical reader?
3. **Dead-end test** — after this ships, does any user state end without exactly one obvious
   next action?

## 4. The weekly ritual (founder + agent, ~30 minutes)

1. Run `npm run mentor`. Update anything stale in `docs/scorecard.json` — real numbers only.
2. Read the floor row and its next action. Pick ONE decisive move for the week; at most one
   supporting move per other row.
3. Append a dated entry to `docs/mentor-log.md`: floor row, the move, why, and last week's
   result (kept or missed — say which, plainly).
4. Two standing nags until done: Google restricted-scope verification submitted (weeks of
   external clock), and founder activation Block A complete (`docs/founder-activation-checklist.md`).

## 5. What 9.9 means (per row, condensed)

- **Engineering**: gates catch everything a reviewer would; coverage ratchets; audits clean.
- **Trust**: every promise on /security is a measured state a visitor can verify.
- **First-touch**: a cold visitor reaches a real result in under 60 seconds and always knows
  the one next step.
- **Workspace**: no dead ends, visible freshness, instant-feeling actions.
- **Integrations**: paste a token, see your own spend in 30 seconds, freshness visible.
- **Backend**: failure drills pass; the funnel is measured; nothing degrades silently.
- **Activation**: every proof command is green against production.
- **Validation**: repeatable paid demand with proof artifacts (founder reps × product machine).
- **Distribution**: every satisfied user has a zero-effort way to bring the next one.

## 6. Execution discipline

One repo (Vognary). Short-lived branches off `main`, PR'd back gate-green. Check
`git status` in the main checkout before branching — parallel agents work here; never touch
their dirty files. Full gate chain before every PR (see AGENTS.md and `.github/workflows/ci.yml`).
