---
name: continue-here-update
description: Update docs/CONTINUE-HERE.md in the required block format. Use whenever live branch or phase state changes.
---

> **Operating motto: Take smart risks. Do not play safe.** Bound the downside.

# Updating CONTINUE-HERE

`docs/CONTINUE-HERE.md` wins on live branch and environment state. Exactly **one**
block is live, and it declares itself.

## Block format

```markdown
## <YYYY-MM-DD> — <short title>

**THIS BLOCK IS THE ONLY LIVE INSTRUCTION.**

**Scoreboard row:** <row this raises>
**Loop step:** <proposal | policy context | human authorization | approved cap | observed outcome | reconciliation>

**WHAT IS TRUE**
- <verified statement, each traceable to a file, command output, or named decision>

**WHAT IS NOT TRUE**
- <the specific misreadings this block kills>

**NEXT HUMAN ACTIONS:**
1. <action only the founder can take>

**HARD STOP:** <what must not happen>
```

## Superseding

Never silently edit history. Mark the previous block:

```markdown
> **SUPERSEDED <YYYY-MM-DD>** — see the block above.
```

Then leave its content intact below the marker.

## Rules

- **WHAT IS TRUE** carries only verified facts. If you did not read it or run it,
  it does not go here.
- **WHAT IS NOT TRUE** is not optional. It is what stops the next session from
  re-deriving a dead assumption.
- **NEXT HUMAN ACTIONS** lists only things an agent genuinely cannot do — API keys,
  Google verification, Razorpay, legal, Setu. Never mark those READY yourself.
- Convert relative dates to absolute. "Last week" is meaningless to the next reader.
- No PII. No paid-customer claims without evidence in this repo.
- Do not create a new plan document. Update this file's status instead.
