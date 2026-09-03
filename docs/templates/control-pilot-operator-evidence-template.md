# First Commitment Control pilot: restricted operator evidence

> TEMPLATE ONLY. Do not complete this record in Git. Copy it to a restricted,
> access-controlled operator location. Never add names, phone numbers, workspace
> UUIDs, report files, legal advice, credentials, customer data, or provider
> evidence to the repository.

## Record identity

```text
Record identifier:
Created at UTC:
Last reviewed at UTC:
Candidate commit SHA:
Deployment identifier:
Production hostname:
Evidence custodian:
Access list reviewed: yes / no
```

## Incident staffing

```text
Incident commander:
Role accepted at UTC:
Private contact verified out of band: yes / no

Backup incident commander:
Role accepted at UTC:
Private contact verified out of band: yes / no
Independent from primary commander: yes / no

Decision: ASSIGNED / INCOMPLETE
```

Do not set either staffing status to `assigned` until both people have accepted
and their private escalation routes have been tested.

## Cross-tenant tabletop

Use the scenario and PASS criteria in
`docs/security/incident-response-runbook.md`.

```text
Tabletop date UTC:
Assessed commit SHA:
Synthetic workspaces used:
Time to declare:
Time to clear enrollment and verify unavailable:
Session revocation result:
Evidence preservation result:
Customer notification draft reviewed: yes / no
Restore source and manifest reference:
Measured restore time:
Gaps, owners, due dates:
Decision: PASS / REWORK
```

## Actual log sources and legal/security review

Inventory the actual deployed systems. Do not copy logs into this record. One
row per source is required, including an explicit `UNKNOWN` when evidence is
missing.

| System / log source | Data classes | Provider/account | Retention | Storage jurisdiction | Export/retrieval proof | Clock source | Owner | Evidence reference | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Application/runtime |  |  |  |  |  |  |  |  | UNKNOWN |
| Database/audit log |  |  |  |  |  |  |  |  | UNKNOWN |
| Monitoring/alerts |  |  |  |  |  |  |  |  | UNKNOWN |
| Inbound/outbound email |  |  |  |  |  |  |  |  | UNKNOWN |
| Backup object storage |  |  |  |  |  |  |  |  | UNKNOWN |
| Identity/DNS/deployment audit |  |  |  |  |  |  |  |  | UNKNOWN |

Counsel or the designated legal/security reviewer records a written conclusion;
this template does not determine legal scope.

```text
Reviewer and authority:
Review date UTC:
Deployment and entities in scope:
CERT-In applicability: APPLIES / DOES_NOT_APPLY / UNKNOWN
180-day log retention requirement addressed: yes / no / unknown
Indian-jurisdiction requirement addressed: yes / no / unknown
Six-hour incident reporting procedure addressed: yes / no / unknown
CERT-In Point of Contact filing addressed: yes / no / unknown
NIC/NPL-traceable clock synchronization addressed: yes / no / unknown
DPDP and contractual duties addressed: yes / no / unknown
Open conditions and expiry/review date:
Decision: CLEARED_FOR_PILOT / BLOCKED / UNKNOWN
Written determination reference:
```

Set `COMMITMENT_CONTROL_LEGAL_LOGGING_REVIEW_STATUS=cleared-for-pilot` only for
`CLEARED_FOR_PILOT`. A hash or environment value does not prove CERT-In
applicability or compliance.

## Proposal-review procedure

Proposal email is best-effort and is not a delivery guarantee. The first pilot
must have an approved manual dashboard-review procedure.

```text
Primary reviewer role:
Backup reviewer role:
Control desk review cadence:
Expected decision window (internal objective, not customer SLA):
Escalation after missed review:
Weekend/leave coverage:
Synthetic proposal observed in desk: yes / no
Synthetic email observed: yes / no / not relied upon
Procedure accepted by owner and backup: yes / no
Decision: APPROVED / REWORK
```

## Backup restore drill

```text
Drill date UTC:
Source backup identifier:
Manifest/checksum reference:
Disposable restore target:
Schema head after restore:
Control tables/triggers verified:
Workspace/tenant relationships verified:
Decision and cap integrity verified:
Evidence links verified:
Measured restore time:
Measured recovery point:
Restricted restore record SHA-256:
Decision: PASS / REWORK
```

## Monitoring delivery

```text
Test date UTC:
Candidate/deployed SHA:
Synthetic event reference:
Monitoring provider accepted at UTC:
Alert received at UTC:
Recipient acknowledged at UTC:
No customer content included: yes / no
Restricted monitoring record SHA-256:
Decision: PASS / REWORK
```

## Independent assessment and retest

```text
Assessor and statement-of-work reference:
Assessment report date:
Assessment report private reference:
Assessment report SHA-256:
Retest date:
Retest private reference:
Retest SHA-256:
Assessed commit SHA:
Deployed commit SHA:
Open Critical/High findings:
Open data-impacting Medium findings:
Other accepted findings and compensating controls:
Decision: CLEARED / BLOCKED
```

## Cleared payment and exact enrollment

```text
Offer accepted at UTC:
Invoice reference:
Cleared payment reference:
Settlement verified at UTC:
Exact workspace UUID:
Workspace UUID present in paid list: yes / no
Same workspace UUID present in pilot list: yes / no
Number of enrolled workspaces after change: 1 / other
Enrollment shutdown rehearsal passed: yes / no
Decision: READY_TO_ENROLL / BLOCKED
```

Payment reserves a pilot. It does not authorize customer-data access without
the assessment, legal/logging, staffing, tabletop, restore, monitoring, and
proposal-review gates above.

## Final sign-off

```text
Every section PASS/CLEARED/APPROVED: yes / no
control:preflight blocking result: READY / BLOCKED
Founder approval at UTC:
Incident commander approval at UTC:
Technical reviewer approval at UTC:
Decision: ENROLL_ONE_WORKSPACE / REMAIN_BLOCKED
```

## Hash and environment mapping

Hash the completed restricted record locally without printing it:

```bash
shasum -a 256 /restricted/path/control-pilot-operator-evidence.md
```

Set `COMMITMENT_CONTROL_OPERATIONS_EVIDENCE_COMMIT_SHA` to the exact
40-character Candidate commit SHA recorded above. `control:preflight` compares
it with the commit reported by the authenticated deployment and blocks missing,
malformed, stale-release, or mismatched evidence.

Copy only the resulting SHA-256 and non-secret status/date values into the
matching `.env.example` fields. Keep the completed record outside Git. Rerun:

```bash
npm run control:preflight -- https://www.vognary.com
```

The command returning `READY` is necessary but not sufficient for enrollment;
the founder still verifies the underlying restricted evidence and authorizes
the exact workspace change.