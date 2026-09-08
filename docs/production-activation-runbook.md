# Vognary Production Activation

> **Operating sequence: Make it work. Make it perfect. Make it fast. Make it cheap.**
> **Strategy rule: Take smart risks. Do not play safe.** Move quickly on
> bounded experiments, never by weakening migration integrity, rollback,
> authentication, or readiness proof. Full doctrine: [`THE-LAW.md`](THE-LAW.md).

This runbook activates the Recovery receipt-forwarding product. Direct Gmail reading, Account Aggregator, API-key connectors, environment sync previews, and generic connector webhooks are retired for this launch and must return `410 Gone`.

Times in this runbook use IST.

## Zoho Books A2 Local Preparation - 2026-09-08

**Status:** locally approved implementation under
[THE-LAW section 0.1.3](THE-LAW.md#013-founder-a2-billed-comparison-authorization---2026-09-07),
not provider consent, an assessed release or launch. Main owns code/test repair,
full verification, the live handoff and action crosswalk. Provider operation,
human service acceptance, buyer value and customer-data activation remain
BLOCKED. Preserve [vercel.json](../vercel.json) automatic `main` deployment;
do not push as a substitute for release approval. Legacy sections below remain
historical procedures, not the current A2 migration or activation checklist.

Record what spending is agreed. Compare the later bill. Keep the answer.

Books is optional for firms already using it. No Books purchase or learning is
required for the Control demonstration or legacy receipt path. Stage remains
**Make it work**, loop step **reconciliation**: one finance owner selects a later
bill for one compatible human authorization and returns to the saved comparison.
That observable task is the Product UX/Backend Readiness evidence gate; local
implementation does not establish customer acceptance or move a scoreboard row.

After source migrations `0070` through `0075_zoho_books_dispositions`, A2 adds
[0076_control_provider_bills](../infra/postgres/migrations/0076_control_provider_bills.sql)
and [0077_control_provider_bill_admission_guards](../infra/postgres/migrations/0077_control_provider_bill_admission_guards.sql).
Current backup verification requires exact head
`0077_control_provider_bill_admission_guards`, not `0075` or intermediate `0076`.
This is the candidate requirement, not a claim about the production ledger.
Include the existing six source connection/snapshot/record/review/incident/
disposition tables, new grants and admitted-bill lineage, changed financial
fields, row counts, immutable triggers and admission guards described below.
Historical `pre-0053` and `pre-0057` profiles remain unchanged. Use the canonical
migration runner only against a separately authorized target after an encrypted
backup and demonstrated restore; this documentation update executes neither.

### Configuration and Consent

- Real external inputs are unavailable: Zoho client ID/secret, authorized
  synthetic organization, account tier/read authority and provider operator;
  Google identity client; and backup encryption key. Do not infer them from
  synthetic fixtures or request secret values in chat.
- Use an existing, permitted synthetic India organization only. Its authorized
  owner registers a Zoho **Server-based Application**. No purchase, upgrade,
  new organization or contract acceptance is authorized. A2's app origin is
  `http://127.0.0.1:57610`; the exact registered callback must be
  `http://127.0.0.1:57610/api/workspaces/current/sources/zoho-books/callback`.
  [Configuration](../src/lib/server/zoho-books-configuration.ts) derives that
  callback from `NEXT_PUBLIC_APP_URL`. Production separately requires HTTPS.
  India uses `www.zohoapis.in/books/v3`; arbitrary hosts or other data centers
  are not permitted.
- Local secret template path: `.fallow/a2/provider.env.example`. The authorized
  custodian supplies values only into `.fallow/a2/provider.env`, never chat or
  Git. The [runtime whitelist](../.fallow/a2/runtime.mjs) accepts only
  `ZOHO_BOOKS_CLIENT_ID`, `ZOHO_BOOKS_CLIENT_SECRET`,
  `ZOHO_BOOKS_PILOT_WORKSPACE_IDS`, `ZOHO_BOOKS_OPERATOR_USER_ID`, `SENTRY_DSN`
  and `BETTER_STACK_SOURCE_TOKEN`. No secret file or value is needed to read
  this runbook. Main alone may restart A2 after scoped authority is supplied.
- Production requires the same explicit workspace UUID in both
  `COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS` and
  `COMMITMENT_CONTROL_PAID_WORKSPACE_IDS`, cleared payment and passed
  release-bound independent assessment/retest. Books additionally requires
  `ZOHO_BOOKS_PILOT_WORKSPACE_IDS`; A2 comparison additionally requires
  `CONTROL_PROVIDER_BILL_WORKSPACE_IDS`. Neither source nor comparison opt-in
  bypasses canonical Control enrollment. Keep real-data enrollment disabled
  until these gates clear. Production ignores `*`; only explicit
  development/test environments may use local wildcard access. The worker
  excludes blocked workspaces before claiming jobs. Login grants identity only.
- The workspace owner/admin must authorize notice `zoho-books-read-v1`, with
  only `ZohoBooks.settings.READ` and `ZohoBooks.bills.READ`, offline access,
  then select the actual authorized organization. The callback state is
  one-use, expires after ten minutes, and
  is bound to the workspace and original actor. A new authorization requires
  its own refresh token and immutable grant; it cannot inherit an older
  account's token. Pre-`0076` grantless snapshots remain inspection-only, not
  eligible A2 evidence; do not backfill grants or legacy amount bases.
- Initial history is bills dated within the preceding 90 days. All later
  queries preserve that lower bound. Older or unentered bills, other entities,
  email, banking, provider usage and unrecorded obligations are excluded.

The [OAuth](https://www.zoho.com/books/api/v3/oauth/),
[organization/API](https://www.zoho.com/books/api/v3/introduction/) and
[bills](https://www.zoho.com/books/api/v3/bills/) documentation was already checked
for this setup. Documented capabilities are not actual consent, account-tier
access or lifecycle evidence. No new provider research round is the unblocker.

### Synchronization and Operations

- The source action performs one initial page after organization selection.
  Durable continuation is handled by the authenticated worker. Vercel is
  configured to invoke it hourly at minute 15. A completed source next becomes
  eligible after 24 hours; this is not real-time monitoring. Hosting-plan cron
  availability and actual scheduler delivery require production verification.
- A worker claims at most three connections, performs at most two bounded
  steps per connection, reads at most 100 bills per page, and uses expiring
  row-backed leases. Each network request is limited to eight seconds and a
  one-MiB JSON response. Partial pages remain explicitly incomplete.
- Incremental reads overlap the previous scan-start watermark by one day,
  including when the original import took several days. A full rescan is due
  after seven days. Missing known bills are checked individually. A JSON 404 is
  not removal proof: Zoho's published 1002 example is invoice-specific, not a
  verified bill-deletion contract. Unknown absence stops as `ABSENCE_UNCONFIRMED`
  and retains the previous bill. Provider-confirmed removal remains blocked until
  an authorized synthetic organization establishes the exact bill response.
- Freshness advances only after the complete scan and verification checks succeed.
  Source revisions are immutable, retain exact decimal values and transformation
  version, and use stable organization/vendor/bill IDs. Duplicates and repeated
  pages do not duplicate facts. A corrected or restored bill appends history,
  including A-to-B-to-A corrections; it never points back to an older revision
  just because the values recur.
- Throttling and temporary failures use bounded backoff; five failures or an
  unsupported schema leave a terminal `FAILED` item and durable incident. The
  worker reports opaque IDs and sanitized reason through existing monitoring,
  with bounded delivery attempts and a retained receipt or explicit failure.
  Raw provider
  bodies, bill text, OAuth tokens and callback codes must never be logged.
- Operations owners: founder must name a primary operator and independent backup,
  with accepted response, acknowledgement and escalation duties before
  activation. Neither actual owner nor accepted obligation is supplied. Alert
  on worker non-delivery, overdue queued work, repeated
  `RETRY_WAIT`, `FAILED`, and freshness beyond the agreed coverage SLO. A worker
  HTTP success with no eligible jobs is not proof that every source is current.
- Correction from the A2 owner's 2026-09-08 handoff: an exact presence-only local
  lookup reported `SENTRY_DSN=true`, meaning present, not a disclosed DSN value
  or proof of delivery. The earlier absent-monitoring statement is not current.
  A2's whitelisted runtime does **not** inherit this destination. Obtain
  permission to supply the existing destination locally and send one bounded,
  non-sensitive incident; do not use a secret merely because it exists.
  The [monitoring interface](../src/lib/server/monitoring.ts) supports Sentry
  or Better Stack. No new monitoring subscription is needed unless the existing
  destination is unusable; any purchase still requires separate authority.
- Recovery authority: configure `ZOHO_BOOKS_OPERATOR_USER_ID` to a specifically
  authorized workspace owner/admin. An unassigned or failed notification can be
  claimed/redelivered only by that configured operator using the audited
  `ESCALATE` action. After actual monitoring delivery is recorded, `RESUME`
  permits that assigned operator to restart only `PROVIDER_UNAVAILABLE` or
  `THROTTLED` incidents with still-valid consent and workspace authority. History
  and scan checkpoints are preserved; last-success time advances only after a
  successful import. A new consent generation cannot reuse an older incident.
- Schema, unknown absence, revoked consent and changed permissions are separate
  stop states, not transient recovery. Investigate the specific cause and obtain
  reconsent when required. No SQL reset, broad operator impersonation or automatic
  terminal replay is part of the procedure. A monitoring HTTP receipt is not
  proof of human alert receipt or response; those remain required external drills.

The permitted provider owner must supply actual consent, initial import,
unattended change, token refresh/expiry, paging, throttling, changed permission,
revocation and reconnect evidence from that synthetic organization. An unknown
404 and the invoice-specific 1002 example are insufficient deletion proof;
obtain bill-specific absence evidence before claiming removal. Agents make no
provider writes. The incident drill separately requires a stopped source,
preserved checkpoint/history, actual external alert receipt, human
acknowledgement, authorized resume and a fresh completed import. A local
synthetic mock or HTTP 2xx is neither real provider nor person proof.

### Human Review and Intake

The Bill review desk records `FOLLOW_UP` or `RESOLVED` dispositions bound to an
immutable source sequence, actor and time. Follow-ups have a responsible actor
and due date; a later source amendment has no inherited disposition, and an older
open follow-up remains visible. `RESOLVED` means the human closed that review,
not that a payment, saving or supplier action occurred. Acknowledgement is a
separate exact-observation workspace-wide reading record. Legacy global review
watermarks are not used to infer which revisions were actually seen.

Guest intake accepts only the fixed server-owned demonstration or an empty
request; arbitrary financial input requires an eligible authenticated workspace.
Uploads/OCR, Recovery/Control financial writes, questions and inbox ingestion
enforce clearance before parsing or provider retrieval. Local synthetic test
allowances do not grant production or customer-data access. No provider approval
process is assumed without checking the provider's actual terms.

### A2 Admission and Data Inventory

The [typed provider-bill contract](../src/lib/commitment-control/provider-bill-contracts.ts)
and additive migrations above define this evidence-only Recovery path. It does
not alter A1's policy-free bill inspection or authorize automatic matching.

| Stored area | A2 meaning and inventory |
| --- | --- |
| Control proposals, evaluations and decisions | New explicit opt-in freezes `amount_basis=GROSS_BILLED_TOTAL_PER_CHARGE` throughout the chain, with exact money, currency, cap and expiry. It is a whole-charge gross billed limit, not a cumulative budget or spend enforcement. Legacy null/unspecified bases and the receipt path retain their meaning without backfill. |
| Books source and original consent | Existing source records plus immutable `zoho_books_grants`; connections gain `active_grant_id`, snapshots gain `grant_id` and `organization_id`. Retain original authorizer/time, generation, authorized organizations, India region, exact read scopes and notice. The exact selected sequence/schema version/fingerprint and organization must bind to that original grant. |
| Recovery evidence and detached lineage | Source `ZOHO_BOOKS`, kind `PROVIDER_BILL`, basis `PROVIDER_BILL_TOTAL`; exact positive total and currency, bill date and minimized identifying fields. Legacy `recovery_evidence.observed_at` remains `NULL`, and provider-bill excerpt is null. New immutable `recovery_provider_bill_links` retains connection/organization/bill IDs, sequence/version/fingerprint, original grant/consent, source revision, completed-sync time, human selector/time, whole-charge relationship and retention notice. |
| Separate times | `sourceObservedAt` is source capture, not a charge or payment; `providerModifiedAt`, `billDate`, `selectedAt` and the frozen decision time remain distinct. Do not copy source capture into legacy charge `observed_at`. |
| Saved comparison | `commitment_control_reconciliations` gains `comparison_kind=BILLED_AMOUNT_COMPARISON`, `decision_amount_basis`, `observed_evidence_basis`, `relation_basis` and `retention_notice`. Freeze both bases, exact selected amount/currency/date, original expected amount/cap/expiry and actor/time; do not rewrite earlier decisions or comparisons. No provider-derived usage/outcome observation is created. |

- Admission requires an eligible owner/admin to select one exact server-reloaded
  snapshot and explicitly acknowledge both
  `wholeCharge=USER_CONFIRMED_SAME_CHARGE` and
  `retentionNotice=control-provider-bill-retention-v1`. A review closure is not
  that confirmation. Client-edited money, another tenant/organization/revision,
  multi-obligation bills and missing grant/basis cannot be substituted.
- Require a completed successful sync no more than 24 hours old and an error-free
  `READY` source with valid consent and schedule: `next_run_at` is not before
  admission and not beyond `last_success_at + 24 hours`. Partial, stale,
  unavailable or ambiguously absent sources cannot admit a new comparison.
- `0077` requires exact chronology `sourceObservedAt >= decidedAt`, including
  within the same calendar day. Bill-date and India-calendar authorization
  expiry checks still apply; future/pre-authorization evidence is refused and
  evidence beyond expiry is labelled `AUTHORIZATION_EXPIRED`. New gross
  approvals and billed comparisons require non-null positive frozen caps.
  Admission locks the live original grant authorizer and selecting/reconciling
  owner/admin user and membership rows, rejecting deleted or demoted authority.
- Admission and comparison are atomic under source/Control version, tenant and
  role checks. Workspace/actor/original-request identity and payload hash bind
  retries: replay returns the originally committed result, never a newer bill;
  a changed payload conflicts. Duplicate requests cannot partly admit evidence
  or append another comparison for the same decision/snapshot. A permitted
  historical read-back is not permission for a new admission after withdrawal.
- Provider bills remain excluded from legacy Autopilot, recurring commitment
  materialization, exposure, charge/payment and savings paths, including later
  ordinary receipt/CSV ingestion. No bill allocation, revision summing, credit
  netting, FX, usage inference or autonomous financial action is authorized.

### Revocation and Data Handling

Disconnect acquires the source lock, invalidates leases/generation, clears
local credentials and stops future reads before requesting provider token
revocation. HTTP 200 alone is not confirmation: the provider response must
explicitly report success. A provider revocation failure is `UNCONFIRMED` and the owner must
remove Vognary in Zoho Connected Apps. Revocation cannot recall an already
in-flight authorized response, but no later scheduled read may start after
the local disconnect completes. Removing the author's owner/admin role also
stops unattended access.

Source snapshots remain until explicit source deletion or workspace erasure;
they are separate from Recovery's receipt retention setting. This retention
must be accepted in the source notice and reviewed legally before customer data.
Deleting the Books source erases its imports, grants, reviews and source history,
but retains the minimized explicitly admitted Recovery financial record,
detached original lineage and immutable comparison. Retained results must show
the erased/withdrawn source condition, not current coverage. No live source
foreign-key cascade may silently erase or rewrite that admitted chain.

Before source deletion with admitted records, require notice
`control-provider-bill-retention-v1`, `retainAdmitted=true` and the exact current
`retainedAdmissionCount`; a stale count is not consent. Admission already
requires acknowledgement of the same retention notice. Whole-workspace erasure
removes the entire source, grant, admission, lineage and comparison chain.
Neither operation deletes anything in Zoho. These implemented semantics do not
clear a legal retention policy or authorize real-data erasure.

Privacy export includes retained source revisions, acknowledgements, incidents,
dispositions and grants, plus new amount bases, admitted evidence/lineage and
comparison fields even after Books source deletion. OAuth state, encrypted
credential payloads and tokens remain excluded from privacy export. Encrypted
database backup must cover the new tables/fields and integrity guards too;
privacy-export exclusions are not database-backup omissions. Backups follow a
separately approved retention/deletion policy; instant removal from previously
created backups is not promised.

### Metric and Release Contract

Bill total is the provider's gross bill total, including its taxes, discounts and
adjustments; balance is its recorded outstanding amount. Neither proves cash
paid, company-wide burn, runway, revenue, recurring revenue or savings. Removed
records show retained historical amounts. No FX conversion, cross-source sum,
automatic merchant matching, automatic approval or financial execution exists.
Recovery remains the sole financial reconciliation authority. A2 permits only
the explicitly selected compatible billed comparison above, not automatic
bill-to-Control reconciliation. A provider `paid` status is not observed payment;
a saved comparison is not savings, actual usage or a verified business outcome.

The unchanged offer is a one-time **INR 14,999 for one pilot month**: one policy
setup, up to ten proposals, up to four weekly 30-minute reconciliation reviews
and up to two additional founder-support hours. Existing activation/refund terms
remain unchanged; another month requires a separate purchase. Synthetic
evaluation is not purchase, activation or a new bill-review service offer.

### Baseline-First Evaluation and Unsent Recruitment

1. Obtain a named, permitted finance owner and session/channel authority; keep
  identities and notes private, outside Git. First observe or reconstruct the
  owner's existing approval/accountant/native-Books task and how they retrieve
  its answer. Do not import real financial records into the uncleared app.
2. Use the equivalent synthetic task: record the human authorization, select
  its later whole bill, compare and return to the saved answer without coaching.
  Bill-only inspection remains available without Control policy setup; owners
  not using Books can evaluate Control with the existing demo/receipt path.
3. Capture complete customer, colleague and operator effort, setup/consent work,
  refusals, errors, rescues and an uncoached return. Keep failed attempts and
  help time in the result. No improvement over the existing task, or a refusal
  to use it, is evidence to rework the job, not grounds to discard the attempt.
4. Keep evaluation participation, price-specific response, explicit offer,
  invoice, cleared payment, actual usage and separately purchased renewal as
  distinct evidence. Willingness to pay, retention and scores remain unmeasured
  by this preparation.

Unsent low-cost recruitment options are permission-based community posts,
CA/fractional-finance introductions and eligible opt-in invitations. Before
any contact, the founder names the channel/recipient owner, grants permission
and bounds time, participant count and cash spend for one narrow evaluation.
No scraped mass DMs, purchases or outreach are authorized here. Traffic and
replies are not task success, demand or retention proof. The USD 1 billion
annual-revenue ambition is not a valuation claim or forecast. The next unblocker
is a permitted task, not another strategy or research round.

### Exact A2 Release and Recovery Gates

All actual owners below remain unnamed and externally accepted obligations
remain absent. Role labels are assignments to obtain, not staffing or clearance.
Evidence must identify the exact candidate release, schema checksums and tested
configuration; historical A1/local mocks and configured flags cannot replace it.

| Gate | Required A2 scope and proof | Owner to appoint |
| --- | --- | --- |
| Independent assessment and retest | Exact-release OAuth/scopes/organization and tenant isolation; dual enrollment and comparison opt-in; grant-bound exact snapshots; live original authorizer/selector locks; gross money, positive caps, chronology/expiry; atomic admission, replay/duplicate/stale races; revocation/reconnect; legacy Autopilot exclusion; minimized retention/export/erasure; migrations `0076`/`0077` and recovery. Independent retest closes every Critical/High and data-impacting Medium finding. | Founder, independent assessor and retest owner |
| Privacy and lawful basis | Written review of actual data inventory, purpose/lawful basis, provider terms/read consent, processors/residency, source-versus-workspace deletion, admitted-history retention period and exact-count acknowledgement, export, logging, encrypted-backup retention and deletion handling. An implemented notice or flag is not legal clearance. | Accountable privacy/legal owner |
| Identity and customer eligibility | Actual Google identity client and verified sign-in/session/role lifecycle; cleared payment, release-bound passed Control assessment/retest, both exact Control enrollment lists, Books source list and `CONTROL_PROVIDER_BILL_WORKSPACE_IDS`. Synthetic login, payment or local wildcard access is insufficient. | Identity/enrollment and release owners |
| Scheduler and incident response | Hosting-tier scheduler delivery and fresh complete imports; actual provider lifecycle/absence proof above; existing monitored destination authorized for bounded non-sensitive incident delivery; external alert receipt and human acknowledgement/resume. Named primary/backup accept coverage, response/acknowledgement deadlines, escalation and manual review duties. A successful HTTP receipt does not accept those duties. | Provider owner, primary operator and independent backup |
| Migration and encrypted recovery | Canonical ordered/checksummed apply through exact head `0077`, populated retained/erased chain verification, tested fail-closed rollback/forward recovery and retrieval/decryption/restore of the actual encrypted stored object from the intended backup destination. Local restores are not production stored-object recovery. | Database/backup custodian and release owner |

The [local populated-restore checks](../.fallow/a2/gates/2026-09-07T18-40-32.234Z-database/fresh-artifact-directory.log)
restore admitted chains with the Books source both retained and erased, then
verify whole-workspace erasure on each restored copy. They do not prove that
an older stored backup cannot restore subsequently erased data; production
erasure replay and retention procedures must address that separately. The
current backup profile head is `0077_control_provider_bill_admission_guards`.
A production encryption
key and successful restore of the actual encrypted stored object are still
required, with restricted evidence of head/checksums, row counts, grant/lineage,
comparison/amount-basis fields and immutable/admission guards.

For a separately authorized apply, verify the starting ledger and encrypted
restore point, then apply pending migrations with the canonical runner. A
partial apply stopping at `0076` does not clear A2 admission: keep the comparison
and source enrollment disabled, resolve the failure and forward-apply `0077`,
then verify the exact head and guards. Rollback means stop new reads/admissions
with the affected allowlists and a known-compatible application release; retain
frozen records. Do not drop A2 tables, rewrite caps/bases, remove immutable
guards or use old code that could reinterpret provider bills as charges. Test
forward recovery and any authorized full restore in isolation before touching
production, including retained comparisons and erased-workspace state; an older
backup must not silently reactivate erased data or withdrawn consent.

Cleared payment plus exact-release independent assurance establish eligibility
for a **restricted assessed pilot**, with the privacy, identity/enrollment,
operations and recovery gates above and explicit release authority also required.
That evaluated pilot is where actual value and return use can be observed; do
not require retention before the first evaluated pilot. Broad launch additionally
requires observed customer value, return use and supportable operations/economics.
Neither pilot nor broad launch is authorized now: no publication, deployment or
real-financial-data activation follows from this local preparation.

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

- migration `0056` is immediately after `0055` in the local ordered migration set;
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

## Pending additive apply: `0056` → `0057`

Commitment Control tables begin at `0057_commitment_control_v0`. Production remains at
the independently verified `0056` head until the founder runs this sequence.
Deploying an unenrolled Control SHA is `0056`-safe: Control routes short-circuit
until a workspace UUID is enrolled. **Do not set
`COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS` until `0059` is applied.** Enrolling on
`0056` or `0057` without `0059` columns makes the Control brief
`FEATURE_UNAVAILABLE`.

1. Run the `pre-0057` encrypted backup and restore drill from the exact candidate SHA. It must verify production head `0056_decision_cycle_expected_amount` and upload `encrypted-postgres-backup-pre-0057`.
2. Run the complete disposable PostgreSQL migration and Commitment Control store/route/privacy tests.
3. Prefer the GitHub **Production database activation** workflow with operation
	`apply-control-0057`, confirmation `APPLY_CONTROL_0057_PRODUCTION`, and the
	successful `pre-0057` backup run ID from the previous 24 hours.
4. If GitHub Actions is unavailable, from a trusted founder-controlled terminal
	run the bounded one-off directly:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true \
  npm run db:apply-production-0057 -- --confirm-0056-to-0057-production
```

5. The operator must start exactly at `0056_decision_cycle_expected_amount`,
	acquire the canonical migration advisory lock, verify both migration
	checksums, apply only `0057`, and refuse a second invocation.
6. Verify the ledger head is exactly `0057_commitment_control_v0` and its checksum matches this repository.
7. Verify all six `commitment_control_*` tables and six immutable triggers exist.
8. Verify existing Recovery and Autopilot row counts, mutation kinds, and product-event names are unchanged.

Rollback before enrollment means leave `COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS`
unset. After enrollment, fail closed by removing those UUIDs; do not drop
`0057` tables or rewrite immutable authorization rows.

## Pending additive apply after `0057`: `0058` through `0069`

Do this only after the ledger head is exactly `0057_commitment_control_v0` with
checksum `eb1145d8248f5044c38472870525209560122fad5b4aa3175fb26f6edc9afc4f`.
Do **not** re-run `apply-control-0057`. Do **not** use `apply-latest` (that
operator is locked to the `0026` Phase A cutover).

From a trusted founder-controlled terminal, apply remaining pending files with
the canonical schema applier:

```bash
DATABASE_URL='<production-postgres-url>' POSTGRES_SSL=true npm run db:apply-schema
```

That command applies only unrecorded files in sorted order. After a successful
`0057` apply, the pending files are:

| id | checksum |
| --- | --- |
| `0058_workspace_invites` | `fa5c919f578376065d3db63e9efdc7cd06ac057a0882090583311b50eb9d27b9` |
| `0059_control_authority_hardening` | `c9c873a20353690e14263a982a18cc95108f4887d76de777518e7a186375eaba` |
| `0060_control_outcome_authorization_window` | `5fd24057ba422ea4fc8e06eba48520bd4674dfca9b74211acb976d34d791c944` |
| `0061_control_outcome_observation_honesty` | `5e46f1d77a71f87776b81034368b1ad5e70c96824afe4f561b50d8d8e043f9b6` |
| `0062_control_outcome_basis_constraint_name` | `05d46fb0d0dd93985360816b286ca1fd2fac99e2d55cbe22aa218c1d0d63f012` |
| `0063_control_authorization_expiry_verdict` | `05ebecf4e21193a098231a8b810615262000684f3c9b7921c09689976bf5d8be` |
| `0064_control_expired_verdict_integrity` | `45504f4be1aac017d1e23c923e8de382c18736bb6f20308ae0ce8798bbf2ca07` |
| `0065_control_attention_outbox` | `5dd30214702e11cbeaff5458a78fa2d64c0df9fbe86e7e706b2c45e4fccee22b` |
| `0066_control_attention_provider_events` | `65a1121069f4904b29c00b62352171581c8081d8b4a2fabe4bc424cdb2e92390` |
| `0067_control_follow_through` | `d82bf65f09b697288b0aa3ba42136432c40816256b34ada0bc6867dd3ce9e4b3` |
| `0068_control_attention_target_identity` | `b0fa0d7cc7c3ef08d2261fd0ab254bd7a522d9fb4c961cea89c639a163ff5f47` |
| `0069_control_projection_empty_windows` | `e15830e1ba218a72e792fa5871648985991aa208daa3efb1b5a9d6ca24755baf` |

Stop if any checksum drifts. Verify the resulting head is
`0069_control_projection_empty_windows`. If the command exits after applying only part of `0058`–`0069`, keep enrollment unset and rerun the same canonical command to completion; do not claim a verified backup or ready schema at an intermediate head. Then keep `COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS` unset. Schema readiness does not
authorize customer-data access or enrollment.

Cleared payment and an independent security assessment with the current retest
exit are both required before enrollment. After both exist, copy the paid
finance-owner workspace UUID from Profile, put that same exact UUID in both
`COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS` and
`COMMITMENT_CONTROL_PAID_WORKSPACE_IDS`, and record the assessment and retest dates, exact
deployed commit SHA, private report/retest SHA-256 hashes, passed statuses, and
zero open Critical/High or data-impacting Medium findings using the fields in
`.env.example`. On a non-Vercel host, also set
`COMMITMENT_CONTROL_DEPLOYED_COMMIT_SHA` to the immutable deployed Git commit;
Vercel's system commit SHA wins when present. Redeploy, verify internal readiness reports
`commitmentControlEnrollment.status = ready`, run a synthetic smoke, and invite
the engineering lead as `member`. Issue the ₹14,999 invoice after the explicit
offer is accepted; mark it paid only after settlement.

## First Commitment Control pilot preflight

Before putting real customer financial data into the first workspace, run:

```bash
npm run control:preflight -- --report-only https://www.vognary.com
```

Remove `--report-only` for the blocking gate. `READY` requires all of the
following at the target release:

- authenticated internal readiness with migrations `0057` through `0069`;
- exactly one enrolled workspace with cleared-payment and release-bound
	independent-assessment evidence accepted by the existing enrollment guard;
- a valid target release commit from authenticated readiness that exactly
	matches `COMMITMENT_CONTROL_OPERATIONS_EVIDENCE_COMMIT_SHA` in the restricted
	operator evidence pack;
- assigned incident commander and independent backup, referenced only by a
	SHA-256 restricted staffing record;
- a passed tabletop no older than 90 days and its restricted record hash;
- written legal/security logging review marked `cleared-for-pilot`, with date
	and restricted evidence hash;
- a successful restore drill no older than 30 days, with a restricted record
	hash;
- a passed monitoring delivery test, with observation date and restricted
	record hash; and
- provider-confirmed Control attention delivery with no queued, sending,
  retrying, provider-accepted, failed, or dead-lettered notification rows in
	authenticated readiness for every currently enrolled pilot workspace; and
- an approved proposal-review procedure and record hash.

The operations evidence commit is the immutable deployed Git SHA, not the local
working tree or a branch name. A matching SHA binds the staffing, tabletop,
legal/logging, restore, monitoring, and proposal-review records to that release;
it does not prove the records' contents. Keep it blank until those restricted
records name the same candidate release returned by authenticated readiness.

The legal/logging flag records a written founder/counsel decision about the
actual deployment. It **does not prove legal applicability or compliance** and
does not replace counsel. Keep it blank when scope, log location, retention,
incident-reporting duty, Point-of-Contact filing, or clock evidence is unknown.

Control attention uses a durable, consent-gated outbox after committed Control
writes and accepted Recovery evidence. Email selects one highest-consequence
item per proposal and recipient; the in-app desk retains the complete attention
list. Sending retries with a bounded budget. Provider acceptance is not
delivery: only a signed Resend event may set `DELIVERED`, and complaints disable
future product email for that recipient. Authenticated readiness must report
`commitmentControlAttention.status = delivery-observed`, `failed = 0`, and
`deadLetters = 0` before preflight can pass. Any queued, sending, retrying, or
provider-accepted row keeps status at `delivery-observed-work-pending`.
Historical delivery from a workspace outside the current explicit enrollment
cannot satisfy this gate.

Email remains an aid, not the authority or a delivery guarantee. The first
pilot procedure must still name who reviews the Control desk and how often.
`COMMITMENT_CONTROL_PROPOSAL_REVIEW_PROCEDURE_STATUS=approved` proves only that
the manual procedure was accepted. Do not add a second customer until observed
notification and manual-review evidence justify it.

## Phase 0: Stop Conditions

Do not show the forwarding-first landing or set any receipt-inbox operator flag unless all earlier phases pass.

Stop immediately when any of these is true:

- An enrolled Commitment Control deployment is missing `0069_control_projection_empty_windows` (unenrolled deploys may remain on `0056`).
- Authenticated readiness reports pending delivery work, any failed or
	dead-lettered Control attention notification, or no provider-confirmed
	Control attention delivery.
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

11. Query `schema_migrations` and verify the last row is `0069_control_projection_empty_windows` for the current candidate.
12. Verify PostgreSQL still contains the three cutover guards plus `recovery_inbound_alias_milestones_immutable`. Re-run the zero-nonterminal legacy queries from step 5.
13. Run the fresh and staged upgrade migration tests against disposable PostgreSQL 16. The staged rehearsal must begin at the production resume point and end at `0053` without losing aliases, inbound events, Recovery evidence, commitments, corrections, or provenance.

Expected success:

- `/api/readiness` reports `capabilities.schema.status = ready`.
- `capabilities.schema.status` is `ready`, and `capabilities.schema.applied` ends at `0069_control_projection_empty_windows`.
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
- Retain the observed provider receipt and command result outside Git; set
	`MONITORING_DELIVERY_TEST_STATUS`, `MONITORING_DELIVERY_TEST_AT`, and
	`MONITORING_DELIVERY_TEST_RECORD_SHA256` only from that hashed record.
- Complete and record an encrypted backup restore drill.
- Run `pg_dump`/`pg_restore` with a client at least as new as the production
	server. The repository Docker fallback is pinned to PostgreSQL 18.4 because
	production currently reports PostgreSQL 18.4; PostgreSQL 16 correctly refuses
	that dump. A restore rehearsal proves recoverability only when the decrypted
	checksum, all required core tables, and every Recovery row count match.
- A successful local/disposable restore does **not** make backups READY by
	itself. Keep `BACKUP_RESTORE_DRILL_STATUS` blank until the encrypted dump and
	manifest use a persistent founder-held key, are uploaded to configured durable
	object storage, that stored object is the artifact restored in the drill, and
	the restricted result is recorded in `BACKUP_RESTORE_DRILL_RECORD_SHA256`.
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
- Feature migrations are `READY` through `0057_commitment_control_v0`.
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
