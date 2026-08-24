# Vognary Production Activation

This runbook activates the Recovery receipt-forwarding product. Direct Gmail reading, Account Aggregator, API-key connectors, environment sync previews, and generic connector webhooks are retired for this launch and must return `410 Gone`.

Times in this runbook use IST.

## Completed bounded schema-only apply: `0055` → `0056`

Production completed the one-time Recovery cutover and the incremental `0056`
apply. Production was independently verified 2026-08-24 at
`0056_decision_cycle_expected_amount` with checksum
`7b0f25a129e7692968d5e30846035480a6a60c179ac526a84ecba4e56e038ef5`.
The nullable `bigint` column has no default, all four verdict values are in the
CHECK, and both legacy cycle rows remain null. **Do not run the bounded command
again; it correctly refuses any starting head other than `0055`.**

The `apply-latest` operation in
`.github/workflows/production-database-activation.yml` is the historical
bootstrap from exact head `0026_recovery_inbound_retention`; its pre-`0053`
backup and zero-legacy-work guards must not be weakened or reused for an
already-activated database.

The exact command used for the completed P0 migration is retained below for
audit history only:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true \
  npm run db:apply-production-0056 -- --confirm-0055-to-0056-production
```

The command acquires the canonical migration advisory lock and refuses unless:

- the local migration head is exactly `0056`, immediately after `0055`;
- production ledger head is exactly `0055_recovery_decision_cycles`;
- the recorded `0055` checksum matches this repository;
- migration `0056` has checksum
  `7b0f25a129e7692968d5e30846035480a6a60c179ac526a84ecba4e56e038ef5`;
- `expected_amount_minor` does not already exist;
- the pre-migration verdict CHECK is exactly the `0055` vocabulary.

Within one transaction it applies only `0056`, records that exact checksum,
and verifies nullable `bigint` with no default, the four-value verdict CHECK,
an unchanged cycle-row count, zero non-null expected amounts on legacy rows,
and exact resulting head/checksum. It verifies again after commit. Any drift,
lock timeout, statement timeout, or failed assertion exits nonzero. It performs
no backfill and no application deployment. A second invocation refuses because
the starting head is no longer `0055`.

Rehearse this exact path first through the disposable PostgreSQL suite. This
script is a bounded one-off for `0055` → `0056`, not the long-term generic
migration runner and not a replacement for the historical bootstrap workflow.

## Phase 0: Stop Conditions

Do not show the forwarding-first landing or set any receipt-inbox operator flag unless all earlier phases pass.

Stop immediately when any of these is true:

- PostgreSQL migrations through `0056_decision_cycle_expected_amount` are not applied.
- A signed Resend event cannot produce one canonical Recovery submission.
- Replaying that event creates another submission, source, evidence row, or commitment.
- A raw provider address, alias token, message subject, body, or attachment appears in logs or privacy export.
- Terminal inbound metadata cannot be deleted while its canonical Recovery submission remains.
- Account deletion cannot revoke the receipt address and remove Vognary-held workspace rows.
- Any legacy connector setup, sync, or webhook route returns something other than `410`.

Rollback means setting `ENABLE_RECEIPT_INBOX=false`, clearing the four operator evidence flags, redeploying, and confirming the landing says receipt forwarding is unavailable. Do not delete provider or database state during rollback.

## Phase 1: Historical Recovery bootstrap runtime and database

This phase documents the original exact-head `0026` Recovery cutover. Do not
run it for the current incremental `0055` → `0056` apply above.

1. Select Node `22.22.2` or a later `22.x` version allowed by `package.json`.
2. Keep `ENABLE_RECEIPT_INBOX=false` and all four receipt-inbox operator evidence flags blank.
3. Configure `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, `INTERNAL_SYNC_SECRET`, and `CRON_SECRET` in the production deployment. `INTERNAL_SYNC_SECRET` and `CRON_SECRET` must be distinct values containing at least 32 UTF-8 bytes; shorter values fail closed as not configured. Generate each independently with `openssl rand -base64 32`. Never reuse either value as `SESSION_SECRET` or `TOKEN_ENCRYPTION_KEY`.
4. Verify the live `schema_migrations` ledger ends exactly at `0026_recovery_inbound_retention`. Production reached this cutover before this runbook revision; an earlier or later head is drift and must be explained before continuing.
5. Verify the Recovery cutover guards exist and require zero connector jobs in `queued`, `running`, `failed`, or `paused`, zero connector runs in `running`, and zero legacy renewal deliveries in `scheduled`, `sending`, or `failed`.
6. Dispatch **Encrypted Backup Drill** with profile `pre-0053`. Require a successful run from `main`, an unexpired `encrypted-postgres-backup-pre-0053` artifact, and a restore of that encrypted dump into disposable PostgreSQL 18. Record the Actions run ID in the restricted operator record; `apply-latest` refuses any run older than 24 hours. A Neon branch may be kept as an additional restore point, but it is not required and does not replace the encrypted drill.
7. Deploy the exact candidate SHA, which must be `0053`-capable, while `ENABLE_RECEIPT_INBOX=false` and all four receipt-inbox operator evidence flags remain blank. `vercel-build` intentionally compiles without mutating production schema.
8. Verify the deployed SHA returns `410` for connector setup/sync/webhook routes, action-case routes, the legacy sync worker, and the legacy savings-verification worker. Verify the deployed cron configuration contains neither retired worker path.
9. Record the deployment time in IST. Wait at least five minutes after the last old sync, reminder, or savings-verification invocation finishes. Stop if an old invocation is still running or a new legacy invocation starts.
10. From a trusted operator terminal, apply the additive chain from `0027` through the canonical head:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run db:apply-schema
```

11. Query `schema_migrations` and verify the last row is `0056_decision_cycle_expected_amount`.
12. Verify PostgreSQL still contains the three cutover guards plus `recovery_inbound_alias_milestones_immutable`. Re-run the zero-nonterminal legacy queries from step 5.
13. Run the fresh and staged upgrade migration tests against disposable PostgreSQL 16. The staged rehearsal must begin at the production resume point and end at `0053` without losing aliases, inbound events, Recovery evidence, commitments, corrections, or provenance.

Expected success:

- `/api/readiness` reports `capabilities.schema.status = ready`.
- `capabilities.schema.status` is `ready`, and `capabilities.schema.applied` ends at `0056_decision_cycle_expected_amount`.
- `capabilities.recoveryV1.status = schema-ready-clean-cutover`.

Keep forwarding disabled and stop activation if the starting head is not exactly `0026`, the successful pre-`0053` backup/restore run is absent or stale, checksums differ, any cutover or milestone trigger is absent, a nonterminal legacy row remains, a fresh database fails, or an upgrade loses rows.

## Phase 2: Google Identity Only

Configure the dedicated Google OIDC identity path with `GOOGLE_AUTH_CLIENT_ID` and `GOOGLE_AUTH_CLIENT_SECRET`.

Expected success:

- `/api/auth/google/start?mode=json` returns the identity authorization contract.
- Login says Google is used only for sign-in and Vognary does not access Gmail.
- `/api/integrations/gmail/start`, its callback, Account Aggregator, and generic connector routes return `410`.

Do not request the Gmail read-only scope. Google identity is not mailbox consent.

## Phase 3: Resend Receiving Configuration

Use a dedicated receiving subdomain and a dedicated Resend `full_access` key for inbound retrieval. Resend currently exposes only `full_access` and `sending_access`; `sending_access` cannot call the Received Emails API. Isolate and monitor this key as `RESEND_RECEIVING_API_KEY`. Configure:

```text
ENABLE_RECEIPT_INBOX=true
RESEND_RECEIVING_API_KEY=<dedicated full-access key used for receiving>
RESEND_INBOUND_WEBHOOK_SECRET=<Svix signing secret>
RESEND_RECEIVING_DOMAIN=<dedicated receiving subdomain>
RECEIPT_INBOX_ALIAS_HMAC_SECRET=<32-byte secret encoded as hex or base64url>
RECEIPT_INBOX_ALIAS_HMAC_KEY_ID=receipt-alias-v1
RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES=amazonses.com
```

`RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES` must name the authority the receiving provider itself writes, read from a real delivered message rather than assumed. Resend inbound is served by Amazon SES ingress and stamps `Authentication-Results: amazonses.com; spf=... dkim=... dmarc=...`, so `amazonses.com` is the only hop this deployment may quote. Do not add an authority such as `mx.google.com`: it appears only inside forwarded message content, which the forwarding party controls. Leaving the variable blank keeps `VERIFIED_SENDER` unreachable.

Rotating `RECEIPT_INBOX_ALIAS_HMAC_SECRET` invalidates every existing alias lookup. Check `recovery_inbound_aliases` for `ACTIVE` rows before changing it, and rotate those aliases through the product if the secret must change.

Before continuing, verify in the provider dashboard and DNS that the receiving domain is active. Do not infer this from environment variables.

Provision one disposable Vognary account and verify:

- The address matches `rcpt_<40 lowercase hex characters>@<receiving domain>`.
- The database stores only the HMAC lookup plus encrypted display value.
- Rotation invalidates the previous address.
- Revocation removes encrypted display material, withdraws consent, and stops future routing.

## Phase 4: Real Inbound Proof

1. Send one real plain-text software receipt to the disposable address.
2. Capture the provider event ID and Vognary request ID in the restricted operator record. Do not copy message content into the record.
3. Confirm the raw-body Svix verification succeeds before provider retrieval.
4. Confirm exactly one row reaches `PROCESSED`, exactly one Recovery submission is linked, and provenance is `PROVIDER_RECEIVED`.
5. Replay the exact signed event.
6. Confirm the replay is acknowledged without another provider retrieval or canonical write.
7. Force one retrieval failure and confirm the provider receives a retryable response.
8. Force one stale `PROCESSING` lease and confirm it is reclaimed after five minutes, while a fresh lease remains retryable.

Only after this evidence exists set:

```text
RECEIPT_INBOX_PROVIDER_STATUS=production-live
RECEIPT_INBOX_WEBHOOK_PROOF_STATUS=passed
RECEIPT_INBOX_REPLAY_PROOF_STATUS=passed
```

These are operator attestations backed by retained evidence references. Setting secrets alone does not prove the provider, webhook, or replay path works.

## Phase 5: Retention And Deletion

1. Insert or receive one terminal inbound event linked to a canonical Recovery submission.
2. Age the event beyond the workspace operational retention window in disposable PostgreSQL.
3. Run retention in dry-run mode and verify `recoveryInboundEventsDeleted = 1`.
4. Run execution mode.
5. Confirm the transport event is gone, `recovery_submissions.workspace_id` is unchanged, `inbound_event_id` is null, and canonical evidence/commitments remain.
6. Confirm a `RECEIVED` or fresh `PROCESSING` event is not deleted.
7. Complete an account deletion rehearsal and verify the active alias, events, submissions, evidence, commitments, and workspace state are removed from Vognary.
8. Record the separate provider retention boundary; Vognary does not claim immediate deletion of provider-held raw mail.

Only after privacy review approves this evidence set:

```text
RECEIPT_INBOX_RETENTION_REVIEW_STATUS=approved
```

## Phase 6: Renewal Return Loop

Configure outbound Resend separately with `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `NEXT_PUBLIC_APP_URL`.

1. Opt in with a disposable account.
2. Confirm a high-confidence Recovery subscription schedules the selected reminder window.
3. Confirm `KEEP` cancels or suppresses an individual reminder.
4. Confirm a corrected renewal date replaces the old scheduled target.
5. Confirm the weekly digest uses Recovery commitments, keeps currencies separate, and excludes `KEEP` only from the suggested action, not honest spend totals.
6. Observe one real delivered reminder and one digest.
7. Disable consent and confirm unsent deliveries are cancelled.

Only after deployed delivery and cron logs are reviewed set `RENEWAL_ALERT_DELIVERY_STATUS=production-live`.

`CRON_SECRET` proves only that the endpoint can authenticate. It does not prove the schedule is deployed or firing. The current readiness value is an operator attestation rather than independent scheduler telemetry.

The renewal worker runs daily at 9:00 AM IST. The retention worker runs daily at 3:00 AM IST.

## Phase 7: Privacy Lifecycle

Run at least one audited non-dry retention execution and verify raw Recovery source minimization, terminal inbound deletion, webhook minimization, and bounded error cleanup.

Only then set `RETENTION_SCHEDULER_STATUS=production-live`.

The read-only platform API remains separately authenticated and does not label the API as adopted by a partner.

## Phase 8: Monitoring, Backups, And Billing

Before public activation:

- Prove monitoring delivery with the protected monitoring test route.
- Complete and record an encrypted backup restore drill.
- Run `pg_dump`/`pg_restore` with a client at least as new as the production
	server. The repository Docker fallback is pinned to PostgreSQL 18.4 because
	production currently reports PostgreSQL 18.4; PostgreSQL 16 correctly refuses
	that dump. A restore rehearsal proves recoverability only when the decrypted
	checksum, all required core tables, and every Recovery row count match.
- A successful local/disposable restore does **not** make backups READY by
	itself. Keep `BACKUP_RESTORE_DRILL_STATUS` blank until the encrypted dump and
	manifest use a persistent founder-held key, are uploaded to configured durable
	object storage, and that stored object is the artifact restored in the drill.
- Keep assisted-audit checkout hidden unless Razorpay KYC, signed webhook, replay, refund, reconciliation, and legal terms gates all pass.
- Verify deletion follow-up for provider credentials created before connector retirement.

## Phase 9: Strict Activation

Set `PRODUCTION_INTERNAL_SYNC_SECRET` to the deployed `INTERNAL_SYNC_SECRET` only in the operator environment. A `401` from `/api/readiness` indicates configuration drift between the operator copy and the deployed secret; never weaken the readiness guard.

Run:

```bash
npm run production:check -- --strict https://www.vognary.com
```

Expected success:

- Every endpoint probe passes.
- `Recovery receipt inbox` is `READY`.
- Feature migrations are `READY` through `0056_decision_cycle_expected_amount`.
- Identity provider, persistent backend, shared rate limiting, privacy lifecycle, monitoring, backups, and any enabled billing/notification group are `READY`.
- All retired connector endpoints return `410`.

If strict activation fails, leave the forwarding operator flags blank or clear them, redeploy the honest unavailable landing, and repair the failed phase before retrying.

## Phase 10: Pre-Public Growth Go/No-Go

Strict production activation is necessary but does not prove that users value the audit. Public launch, ads, and growth claims remain blocked until the founder reviews retained evidence for every row below.

| Gate | Required evidence | Current default when absent |
| --- | --- | --- |
| Code integrity | `lint`, `typecheck`, `claims:check`, `tokens:check`, unit tests, build, performance budget, and applicable Recovery browser scenarios pass on the candidate | **BLOCKED** |
| Customer #0 | One real human completes sign-in → evidence → insight → decision → proof; the canonical CRM row links the measured session | **BLOCKED** |
| Time to insight | Stopwatch durations from at least three real humans; median is under three minutes | **UNMEASURED / BLOCKED** |
| Passive evidence | One retained signed-event record proves processing, replay, and retention, or every public and signed-in surface remains manual-only | **NOT CLAIMED** |
| Reminder return loop | One real reminder and weekly digest are delivered, then disabling consent cancels unsent deliveries, or reminders remain unclaimed | **NOT CLAIMED** |
| Payment | Razorpay passes KYC, webhook, replay, refund, reconciliation, and legal gates, or the founder separately verifies a lawful manual collection and invoice path before offering it | **NOT AVAILABLE / NOT CLAIMED** |
| Market proof | At least 5 connected accounts with active standing mandates for a private batch; public growth still requires the Phase A stop/go threshold of 10 connected+mandate, ≥3 zero-chore supported actions, ≥2 covered windows, and **5 actual payments of 20 real offers**. Written pay intent is tracked separately and does not satisfy the paid gate | **BLOCKED** |
| Corpus | Consented fixtures are redacted and stored under the corpus policy; no PII enters Git | **COLLECTION REQUIRED** |
| Claims | Public copy describes only currently proven sources, outcomes, and delivery paths | **FAIL CLOSED** |

The founder alone records GO or NO-GO after reviewing CRM rows and operator evidence. Green automated tests never substitute for Customer #0, payment, surprise, or return behavior.

Rollback / stop conditions:

- If any code or strict activation gate is red, do not deploy the candidate.
- If receipt-inbox attestations are missing or revoked, keep Recovery manual-only and clear forwarding claims.
- If reminders are not delivered, keep notification delivery unclaimed.
- If payment is not verified, do not show checkout as available or record a prospect as paid.
- If any protected-class or unauthorized execution occurs, stop the wedge immediately.
- If 20 real autopilot offers produce **zero actual payments**, stop scaling the current wedge. Written pay intent is not a substitute.
