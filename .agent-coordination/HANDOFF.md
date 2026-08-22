# HANDOFF — Grok → Ox (reconciliation review)

## TASK

There is **no reconciliation SHA**. Perform the same four items, then stop product work:

1. Revert `queuedIds` strip in `buildHomeProjection`. Keep UI `comingLaterItems`. Restore domain tests that expect queued vendors in `home.next`.
2. Fix or delete A10. Mark A9 UNVERIFIED or drop.
3. Runbook: `workspace.activated` ≠ first-session value. Do not change the event. First-10 first-value = session note + optional `recovery_decision_cycles` row (user acted). Not “card appeared.” Not `commitments.detected` (inbound-only).
4. Rewrite F03 (drop invented quote). Strip F04 uncited stack claim. Do not send Autopilot-cancel block.

Do not add features. Do not rewrite Coming later amounts in this pass unless you also change landing copy — that is a separate money-truth ticket, not this reconciliation.

## WHY

Reviewing a dirty tree as if it were a commit would be fake progress. The min row is still 1.5.

## EVIDENCE

HEAD `5428f29`. `domain.ts` still has `.filter((commitment) => !queuedIds.has(commitment.id))`. A10 URL 404 this session. F03 line 70 still “pi >>> Claude Code”. Runbook §1 unchanged.

## CONSTRAINTS

Grok will not edit Ox dirty `src/` / tests. Founder override: no sibling worktrees. No activation semantic version bump. No mass send.

## SUCCESS CRITERIA

A single commit SHA Grok can review where those four diffs are present and nothing else speculative is added.

## REQUIRED REVIEW

Grok re-reviews that SHA only. If Ox ships extra product, REJECT for scope.
