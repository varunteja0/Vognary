# Commitment Control incident response

> **Operating motto: Take smart risks. Do not play safe.** Contain irreversible
> customer harm first, preserve evidence, communicate truthfully, and restore
> only from verified state. Product law: [`../THE-LAW.md`](../THE-LAW.md).

**Version:** 1.0, 2026-09-01
**Scope:** Commitment Control, Recovery evidence used by Control, and supporting production systems

## Staffing gate

- Incident commander: **UNASSIGNED; this blocks customer data until a named person accepts the role in the restricted operator record.**
- Backup incident commander: **UNASSIGNED; this blocks customer data until an independent second person accepts the role.**
- Technical lead: founder/operator until delegated.
- Communications and legal lead: founder, with counsel required for statutory or contractual notices.

Names, personal phone numbers, credentials, and private escalation channels stay
in a restricted operator record, not Git. No pilot enrollment is allowed while
either incident-command role is unassigned.

## Severity

| Level | Examples | Immediate objective |
| --- | --- | --- |
| **SEV-0** | Cross-tenant access; unauthorized decision; wrong amount/currency; cap mutation; invented evidence; secret exposure; confirmed destructive data loss | Disable affected capability immediately, preserve evidence, begin legal/notification assessment |
| **SEV-1** | Auth or invitation bypass without observed data access; repeated duplicate writes; failed restore; sustained Control outage; privacy erasure failure | Contain within 30 minutes as an internal objective; decide whether to unenroll all pilots |
| **SEV-2** | Isolated 5xx, degraded latency, monitoring gap, recoverable workflow failure | Stabilize, communicate if customer work is affected, remediate in the next release |
| **SEV-3** | Low-risk defect or hardening observation with no customer impact | Track with owner and due date |

These are internal operating objectives, not published response-time promises.

## Declare and record

1. Open an incident record with UTC start time, reporter, affected release SHA,
   environment, suspected workspaces, first observed symptom, and severity.
2. Record facts and hypotheses separately. Do not paste proposal text, receipts,
   access tokens, personal data, or secrets into tickets or chat.
3. Assign the incident commander and technical lead. One person coordinates;
   another executes or reviews production changes.
4. Preserve privacy-safe request ids, audit/event ids, deployment logs, database
   timestamps, provider event ids, and hashes. Preserve evidence before cleanup.
5. Start an action log. Every production mutation records actor, time, reason,
   expected effect, observed effect, and rollback.

## Universal containment

For suspected tenant, authorization, money, evidence, privacy, or durability
impact:

1. Clear `COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS` in production and redeploy.
   Verify enrolled Control routes return the honest unavailable state. Do not
   drop tables or delete immutable decisions.
2. Revoke affected sessions. The user-facing current-session path is
   `POST /api/auth/logout`; an incident requiring broader revocation must use a
   reviewed server-side `auth_sessions` procedure. If scoped revocation cannot
   be proved, invalidate all sessions through the approved secret-rotation path.
3. Disable the affected ingress or provider credential when compromise is
   plausible. Do not rotate a key until evidence needed to understand the event
   is preserved.
4. Block deployments except containment and recovery changes. Freeze the exact
   affected and last-known-good SHAs.
5. Confirm whether any cross-workspace read, unauthorized write, wrong financial
   output, export, deletion, or provider delivery occurred. Unknown is not no.

## Investigation

- Build a UTC timeline from immutable Control rows, workspace versions,
  privacy-safe audit/product events, deployment records, monitoring, and provider
  event ids.
- Compare the request, actor, role, workspace, ETag/version, idempotency key,
  request hash, decision, cap, citations, and reconciliation involved.
- Query only the minimum affected rows from a trusted operator environment.
  Never copy production data into local fixtures or the repository.
- Test the suspected path with synthetic data in an isolated environment.
- Classify scope as confirmed, potential, or excluded with supporting evidence.
- Preserve contradictory evidence; do not force an early root-cause narrative.

## Recovery and restore

1. Repair the root cause with a failing regression test when executable.
2. Run the focused test, full release gate, and independent retest when the issue
   affects the assessment scope.
3. For corruption or loss, select a stored encrypted backup by manifest and
   checksum. Restore into a disposable database first and verify schema, row
   counts, tenant relationships, decisions, caps, evidence links, and audit data.
4. Record measured recovery point and restore time. A successful command without
   data verification is not a restore proof.
5. Redeploy unenrolled. Run health, readiness, synthetic Control smoke, tenant
   isolation, owner/member authority, idempotency, privacy export/erasure, and
   monitoring delivery checks.
6. Re-enroll an exact workspace only after the incident commander, technical
   lead, and affected customer approve the recovery state. Re-enroll one at a
   time.

## Customer notification and legal assessment

- Tell affected customers what is confirmed, what remains unknown, what Vognary
  disabled, what they should do, and when the next update will arrive.
- Never minimize an incident because logs are incomplete. Never claim no access
  when the result is unknown.
- The legal lead determines contractual, privacy, CERT-In, DPDP, provider, and
  law-enforcement duties from current primary sources and counsel. This runbook
  does not declare applicability or replace legal advice.
- Coordinate public statements through the incident commander. Do not disclose
  exploit details that create additional customer risk before remediation.

## Closure

An incident closes only when:

- containment and customer notification decisions are recorded;
- affected data and workspaces are scoped or explicitly remain unknown;
- the fix and regression test pass on the deployed SHA;
- monitoring detects recurrence where feasible;
- restore and enrollment decisions are documented;
- every follow-up has an owner and due date;
- a blameless postmortem records root cause, control failure, detection gap,
  response timeline, customer impact, and prevention.

An incident can close while follow-ups remain open; their risk acceptance must be
explicit. A SEV-0 or SEV-1 affecting assessment scope reopens the independent
security review before any customer-data enrollment resumes.

## Tabletop: suspected cross-tenant read

Run this before first customer data and quarterly after enrollment.

1. The facilitator provides a synthetic alert showing workspace A requested an
   object belonging to workspace B.
2. The incident commander declares SEV-0 and starts the action log.
3. The operator clears enrollment, redeploys, and proves Control is unavailable.
4. The technical lead revokes synthetic sessions, preserves privacy-safe evidence,
   and determines whether the response was denied before data access.
5. The team drafts a customer notification for both workspaces, including what
   is known and unknown.
6. The operator restores the latest encrypted backup to a disposable database
   and verifies tenant relationships without exposing customer content.
7. The team records time to declare, time to containment, restore duration,
   missing permissions/tools, and every founder rescue.

```text
Tabletop date:
Assessed SHA:
Incident commander:
Backup incident commander:
Time to declare:
Time to clear enrollment and verify unavailable:
Session revocation result:
Evidence preservation result:
Customer notification draft reviewed:
Restore source and manifest:
Measured restore time:
Gaps, owners, due dates:
Decision: PASS / REWORK
```

`PASS` requires both named roles, successful enrollment shutdown, reviewed
session revocation, preserved evidence, a truthful customer notification draft,
and a verified disposable restore. Anything else keeps customer data blocked.