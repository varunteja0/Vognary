# Independent security assessment brief

> **Operating motto: Take smart risks. Do not play safe.** Seek disconfirming
> evidence before customer data creates irreversible downside. Product law:
> [`../THE-LAW.md`](../THE-LAW.md). Threat model:
> [`commitment-control-threat-model.md`](commitment-control-threat-model.md).

**Status:** Ready for assessor proposals; assessment not yet commissioned
**Target:** Commitment Control private-pilot release
**Data rule:** Synthetic data only until the assessment and remediation retest exit

## Objective

Determine whether an external or authenticated attacker can cross a tenant or
role boundary, alter financial or evidence meaning, create duplicate or stale
authorization, expose confidential data, evade privacy controls, or prevent safe
recovery. The engagement is an assessment of a named release and scope, not a
certification or general claim that Vognary is secure.

## Entry package

The founder supplies through a restricted channel:

- assessed commit SHA and deployment identifier;
- production-like staging URL, isolated database identifier, and test window;
- synthetic accounts in two workspaces, with owner, admin, and member roles;
- one unauthenticated test context plus expired, revoked, and malformed session
  fixtures where safe;
- source access limited to the assessed application, migrations, tests, and
  approved operational scripts;
- this brief, the threat model, incident runbook, architecture boundary, privacy
  notice, terms, vulnerability policy, and latest green CI evidence;
- a technical contact and an incident contact in a private channel.

Do not supply production database credentials, signing/encryption keys, provider
secrets, customer identities, real financial data, or the private CRM.

## Environment acceptance

Before testing, both parties record:

```text
Assessor and company:
Statement of work identifier:
Assessed commit SHA:
Staging deployment identifier:
Test start / end in UTC:
Source-assisted access granted:
Workspace A roles issued:
Workspace B roles issued:
Production unauthenticated host permitted: yes / no
Emergency stop contacts verified out of band: yes / no
```

The staging target must run the assessed SHA and current schema with enrollment
limited to synthetic workspace UUIDs. It must not share a database, credentials,
storage bucket, webhook destination, payment account, or monitoring dataset with
production.

## Required coverage

### Identity and authorization

- session creation, signature, expiry, fixation, replay, logout, membership
  removal, account deletion, and workspace rebinding;
- invitation token entropy, expiry, replay, role constraints, acceptance, and
  revocation;
- RBAC and IDOR across every Commitment Control read and write route;
- tenant isolation by crafted proposal, evaluation, decision, evidence, and
  reconciliation identifiers;
- owner/admin/member concurrency and stale-role behavior.

### Request and application security

- CSRF and Fetch Metadata handling for every mutation;
- XSS and injection through merchant, purpose, reason, policy, filename, receipt,
  and error-display fields;
- request-size, content-type, parser, redirect, and URL-validation boundaries;
- CSP and security headers on public, authenticated, error, and retired routes;
- rate-limit isolation and fail-closed behavior without production load testing.

### Financial and evidence integrity

- exact minor-unit parsing, signed-64-bit bounds, currency validation and
  separation, recurrence/date boundaries, and projection overflow;
- deterministic policy versioning and attempts to bypass `OUTSIDE_POLICY` or
  stale policy context;
- authorization actor, action, override reason, expected amount, and frozen cap;
- idempotency, replay, concurrent decisions, stale ETags, and response loss;
- citation removal, substitution, cross-workspace linking, unsupported facts,
  and reconciliation against altered or wrong-currency evidence;
- direct database constraints and immutability triggers, using a disposable
  assessor database only.

### Data protection and operations

- privacy export and erasure completeness, cross-tenant export denial, and
  behavior while export or deletion races with writes;
- leakage of secrets, raw evidence, personal data, or private configuration in
  errors, logs, monitoring, build output, source maps, status pages, and headers;
- dependency and build-chain review against the lockfile, audit output, and
  release workflow;
- enrollment shutdown, monitoring delivery, encrypted backup integrity, object
  retrieval, disposable restore, and no-data-loss verification;
- operator and provider trust assumptions, including what cannot be proven by
  application testing.

## Allowed techniques

- manual and automated testing at bounded rates against staging;
- source review, dependency review, static analysis, and secret scanning;
- browser, API, and direct disposable-database testing using supplied synthetic
  identities and fixtures;
- replay, race, malformed-input, and authorization tests coordinated with the
  technical contact;
- a bounded unauthenticated review of production only when explicitly listed in
  the signed statement of work.

## Prohibited techniques

- No denial-of-service, load, stress, or resource-exhaustion test against
  production or a shared provider.
- No social engineering, phishing, credential stuffing, password spraying,
  physical testing, persistence, malware, or destructive action.
- No testing of another provider's infrastructure or account controls.
- No access to or use of real customer data, production secrets, or private CRM
  records.
- No deletion or mutation of production data and no production authenticated
  testing unless separately authorized in writing.
- Stop immediately after minimum proof of cross-tenant, secret, or real-data
  access and contact the incident channel out of band.

## Finding format

Each finding must include:

- identifier, severity, affected SHA/route/component, and CWE or equivalent;
- preconditions, role, workspace, reproducible steps, and minimum safe proof;
- observed result, customer impact, likelihood, and affected security objective;
- whether data access or mutation occurred, with synthetic identifiers only;
- remediation guidance, compensating control, and retest procedure;
- evidence attachments scrubbed of tokens, credentials, and personal data.

Severity uses impact and exploitability:

- **Critical:** practical cross-tenant disclosure at scale, unauthenticated
  authorization, secret compromise with production impact, or destructive loss
  without viable recovery.
- **High:** authenticated cross-tenant access, role bypass, financial/evidence
  integrity failure, significant privacy failure, or reliable duplicate decision.
- **Medium:** bounded security impact requiring meaningful prerequisites, or a
  control weakness that can combine with another issue.
- **Low/Informational:** defense-in-depth, hardening, or documentation gaps with
  no demonstrated material impact.

The founder may raise severity when financial authority or evidence integrity is
affected. Severity is never lowered merely to meet the release gate.

## Delivery and remediation

1. Report Critical/High findings immediately through the private incident
   channel; do not wait for the final report.
2. Deliver a dated report naming assessed SHA, target, scope, limitations,
   methodology, findings, and excluded surfaces.
3. Vognary records each finding with owner, due date, disposition, regression
   test, remediation SHA, deployment, and retest status.
4. Every executable defect starts with a failing test where feasible, then the
   focused validation and full exact-SHA release gate.
5. The assessor retests the deployed remediation candidate, not a local patch or
   different commit.

## Exit criteria

Customer-data access remains blocked until dated report and retest evidence show:

- zero unresolved Critical or High findings;
- zero unresolved Medium findings affecting authentication, authorization,
  tenant isolation, financial integrity, evidence integrity, privacy, backup, or
  data loss;
- any other Medium finding has an owner, due date, compensating control, and
  explicit written founder risk acceptance;
- all remediated findings have reproducible retest results against the final
  assessed commit SHA;
- exact-SHA CI, synthetic staging smoke, enrollment shutdown, monitoring test,
  privacy export/erasure, encrypted backup, and disposable restore are green.

Permitted public wording, only if the assessor contract allows it:

> Independently assessed on [date] for [named scope and commit]; no unresolved
> Critical or High findings remained after retest.

Do not publish a badge, report excerpt, customer name, “passed penetration test,”
certification, security superlative, or competitor comparison unless the dated
artifact and contract support that exact statement.