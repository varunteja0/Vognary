import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../infra/postgres/migrations/0023_recovery_v1.sql", import.meta.url), "utf8");
const inboundMigration = readFileSync(new URL("../infra/postgres/migrations/0024_recovery_inbound_receipts.sql", import.meta.url), "utf8");
const gmailOauthMigration = readFileSync(new URL("../infra/postgres/migrations/0028_recovery_gmail_oauth_source.sql", import.meta.url), "utf8");
const tenantIntegrityMigration = readFileSync(new URL("../infra/postgres/migrations/0029_legacy_tenant_integrity.sql", import.meta.url), "utf8");
const tenantOwnershipMigration = readFileSync(new URL("../infra/postgres/migrations/0030_legacy_tenant_ownership_immutable.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../infra/postgres/schema.sql", import.meta.url), "utf8");

const recoveryTables = [
  "recovery_workspace_states",
  "recovery_workspace_versions",
  "recovery_submissions",
  "recovery_sources",
  "recovery_commitments",
  "recovery_evidence",
  "recovery_commitment_evidence",
  "recovery_corrections",
  "recovery_decisions",
  "recovery_changes",
  "recovery_idempotency_keys",
];

test("Recovery v1 is an additive migration after 0022 and is consolidated for fresh databases", () => {
  for (const table of recoveryTables) {
    assert.match(migration, new RegExp(`create table if not exists ${table}\\b`, "i"));
    assert.match(schema, new RegExp(`create table if not exists ${table}\\b`, "i"));
  }
  assert.match(migration, /raw_evidence jsonb not null/i);
  assert.match(migration, /content_hash char\(64\)/i);
  assert.match(migration, /unique \(workspace_id, content_hash\)/i);
  assert.match(migration, /cardinality\(evidence_ids\) > 0/i);
  assert.match(migration, /unique \(workspace_id, idempotency_key\)/i);
  assert.match(migration, /on delete cascade/i);
});

test("Recovery migration indexes every launch hot path", () => {
  for (const pattern of [
    /recovery_commitments\(workspace_id, updated_at desc, id desc\)/,
    /recovery_evidence\(workspace_id, created_at, id\)/,
    /recovery_evidence\(workspace_id, source_id\)/,
    /recovery_corrections\(workspace_id, commitment_id, created_at desc, id desc\)/,
  ]) {
    assert.match(migration, pattern);
    assert.match(schema, pattern);
  }
});

test("Recovery inbound receipts add HMAC-only routing and replay-safe provider events", () => {
  for (const table of ["recovery_inbound_aliases", "recovery_inbound_events", "recovery_inbound_replay_keys"]) {
    assert.match(inboundMigration, new RegExp(`create table if not exists ${table}\\b`, "i"));
    assert.match(schema, new RegExp(`create table if not exists ${table}\\b`, "i"));
  }
  for (const sql of [inboundMigration, schema]) {
    assert.match(sql, /source_type in \('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL'/i);
    assert.match(sql, /provenance_kind in \('USER_SUBMITTED', 'PROVIDER_RECEIVED'\)/i);
    assert.match(sql, /alias_hmac char\(64\)/i);
    assert.match(sql, /encrypted_display jsonb/i);
    assert.match(sql, /unique \(hmac_key_id, alias_hmac\)/i);
    assert.match(sql, /where status = 'ACTIVE'/i);
    assert.match(sql, /unique \(provider, svix_id\)/i);
    assert.match(sql, /unique \(provider, provider_email_id\)/i);
    assert.match(sql, /key_hash char\(64\)/i);
    assert.match(sql, /primary key \(provider, key_kind, key_hash\)/i);
    assert.match(sql, /foreign key \(workspace_id, inbound_event_id\)/i);
    assert.match(sql, /on delete set null \(alias_id\)/i);
    assert.match(sql, /on delete set null \(inbound_event_id\)/i);
    assert.doesNotMatch(sql, /\blocal_part\b|\bplaintext_address\b|raw_provider_event_id/i);
  }
});

test("Recovery inbound aliases cannot cross workspace ownership boundaries", () => {
  assert.match(
    inboundMigration,
    /if not exists \([\s\S]*conname = 'connected_accounts_workspace_id_id_key'[\s\S]*add constraint connected_accounts_workspace_id_id_key\s+unique \(workspace_id, id\)/i,
  );
  assert.doesNotMatch(inboundMigration, /drop constraint(?: if exists)? connected_accounts_workspace_id_id_key/i);
  const connectedAccountsTable = schema.match(/create table connected_accounts \([\s\S]*?\n\);/i)?.[0];
  assert.ok(connectedAccountsTable);
  assert.match(connectedAccountsTable, /unique \(workspace_id, id\)/i);

  for (const sql of [inboundMigration, schema]) {
    const inboundAliasesTable = sql.match(
      /create table if not exists recovery_inbound_aliases \([\s\S]*?\n\);/i,
    )?.[0];
    assert.ok(inboundAliasesTable);
    assert.match(
      inboundAliasesTable,
      /foreign key \(workspace_id, connected_account_id\)\s+references connected_accounts\(workspace_id, id\) on delete cascade/i,
    );
    assert.match(
      inboundAliasesTable,
      /foreign key \(workspace_id, replaced_by_id\)\s+references recovery_inbound_aliases\(workspace_id, id\) on delete set null \(replaced_by_id\)/i,
    );
    assert.doesNotMatch(
      inboundAliasesTable,
      /connected_account_id uuid not null\s+references connected_accounts\(id\)|foreign key \(connected_account_id\)\s+references connected_accounts\(id\)/i,
    );
    assert.doesNotMatch(
      inboundAliasesTable,
      /replaced_by_id uuid\s+references recovery_inbound_aliases\(id\)|foreign key \(replaced_by_id\)\s+references recovery_inbound_aliases\(id\)/i,
    );
  }
});

test("Gmail OAuth is reserved on Recovery sources without reviving living-ledger writes", () => {
  for (const sql of [gmailOauthMigration, schema]) {
    assert.match(sql, /source_type in \('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL', 'GMAIL_OAUTH'\)/i);
  }
  assert.doesNotMatch(gmailOauthMigration, /connector_evidence|living.ledger|gmail-readonly-adapter/i);
});

test("legacy tenant integrity refuses cross-workspace relations without rewriting ownership", () => {
  const recoveryMarker = "\n-- Recovery v1:";
  const markerIndex = schema.indexOf(recoveryMarker);
  assert.ok(markerIndex > 0);
  const schemaThrough0022 = schema.slice(0, markerIndex);
  assert.doesNotMatch(schemaThrough0022, /commitment_decisions_workspace_recurring_item_fkey/);
  assert.doesNotMatch(schemaThrough0022, /reject_cross_workspace_evidence_link/);
  assert.doesNotMatch(schemaThrough0022, /evidence_links_tenant_workspace_guard/);

  assert.match(tenantIntegrityMigration, /not valid/i);
  assert.doesNotMatch(tenantIntegrityMigration, /update commitment_decisions|update evidence_links|set workspace_id/i);
  for (const sql of [tenantIntegrityMigration, schema]) {
    assert.match(sql, /data_sources_workspace_id_id_key/);
    assert.match(sql, /recurring_items_workspace_id_id_key/);
    assert.match(sql, /commitment_decisions_workspace_recurring_item_fkey/);
    assert.match(sql, /reject_cross_workspace_evidence_link/);
    assert.match(sql, /Evidence source workspace must match the recurring item workspace/);
  }
});

test("legacy workspace ownership is immutable without rewriting historical rows", () => {
  const recoveryMarker = "\n-- Recovery v1:";
  const markerIndex = schema.indexOf(recoveryMarker);
  assert.ok(markerIndex > 0);
  const schemaThrough0022 = schema.slice(0, markerIndex);
  assert.doesNotMatch(schemaThrough0022, /reject_legacy_workspace_reassignment/);
  assert.doesNotMatch(schemaThrough0022, /data_sources_workspace_immutable/);
  assert.doesNotMatch(schemaThrough0022, /recurring_items_workspace_immutable/);

  assert.doesNotMatch(tenantOwnershipMigration, /update data_sources|update recurring_items|set workspace_id/i);
  for (const sql of [tenantOwnershipMigration, schema]) {
    assert.match(sql, /reject_legacy_workspace_reassignment/);
    assert.match(sql, /data_sources_workspace_immutable/);
    assert.match(sql, /recurring_items_workspace_immutable/);
    assert.match(sql, /Legacy workspace ownership is immutable/);
    assert.match(sql, /before update of workspace_id on data_sources/i);
    assert.match(sql, /before update of workspace_id on recurring_items/i);
  }
});

test("autopilot loop schema is additive and consolidated for fresh databases", () => {
  const migration = readFileSync(new URL("../infra/postgres/migrations/0031_autopilot_loop.sql", import.meta.url), "utf8");
  for (const table of [
    "recovery_standing_mandates",
    "recovery_action_candidates",
    "recovery_veto_notices",
    "recovery_executions",
    "recovery_covered_windows",
    "recovery_fee_ledger",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}\\b`, "i"));
    assert.match(schema, new RegExp(`create table if not exists ${table}\\b`, "i"));
  }
  assert.match(migration, /eligibility <> 'ELIGIBLE' or commitment_class = 'discretionary-subscription'/);
  assert.match(schema, /eligibility <> 'ELIGIBLE' or commitment_class = 'discretionary-subscription'/);
  assert.match(migration, /razorpay_charge_status text not null default 'FAIL_CLOSED'/);
  assert.match(schema, /'MANDATE', 'CANDIDATE'/);
  const proofMigration = readFileSync(new URL("../infra/postgres/migrations/0032_autopilot_proof_integrity.sql", import.meta.url), "utf8");
  assert.match(proofMigration, /recovery_covered_windows_source_fk/);
  assert.match(proofMigration, /recovery_fee_ledger_workspace_currency_period_key/);
  const integrityMigration = readFileSync(new URL("../infra/postgres/migrations/0033_autopilot_integrity.sql", import.meta.url), "utf8");
  const repairMigration = readFileSync(new URL("../infra/postgres/migrations/0034_autopilot_repair.sql", import.meta.url), "utf8");
  const codexRepairMigration = readFileSync(new URL("../infra/postgres/migrations/0035_autopilot_codex_repair.sql", import.meta.url), "utf8");
  assert.match(integrityMigration, /recovery_fee_ledger_no_overlap/);
  assert.match(integrityMigration, /recovery_execution_attempts/);
  assert.match(integrityMigration, /recovery_shadow_gate_snapshots/);
  assert.match(integrityMigration, /on delete cascade/);
  assert.match(repairMigration, /alter column finalized_at set default now\(\)/);
  assert.match(repairMigration, /new.year_start is distinct from old.year_start/);
  assert.match(repairMigration, /email.delivery_delayed/);
  assert.match(repairMigration, /recovery_billing_year_anchors/);
  assert.match(schema, /recovery_covered_windows_source_fk/);
  assert.match(schema, /recovery_fee_ledger_workspace_currency_period_key/);
  assert.match(schema, /recovery_fee_ledger_no_overlap/);
  assert.match(schema, /finalized_at timestamptz not null default now\(\)/);
  assert.match(schema, /new.year_start is distinct from old.year_start/);
  assert.match(schema, /recovery_billing_year_anchors/);
  const noticeHoldMigration = readFileSync(new URL("../infra/postgres/migrations/0036_autopilot_notice_hold.sql", import.meta.url), "utf8");
  assert.match(codexRepairMigration, /veto_expires_at/);
  assert.match(codexRepairMigration, /notice_body_hash/);
  assert.match(schema, /veto_expires_at timestamptz/);
  assert.match(schema, /notice_body_hash char\(64\)/);
  assert.match(noticeHoldMigration, /recovery_notice_pending_events/);
  assert.match(noticeHoldMigration, /recovery_connected_mandate_cohort/);
  assert.match(noticeHoldMigration, /notice_from_email/);
  assert.match(noticeHoldMigration, /recovery_sources/);
  assert.match(schema, /recovery_notice_pending_events/);
  assert.match(schema, /recovery_connected_mandate_cohort/);
  assert.match(schema, /notice_from_email text/);
  const clockIntegrityMigration = readFileSync(new URL("../infra/postgres/migrations/0037_autopilot_clock_integrity.sql", import.meta.url), "utf8");
  assert.match(clockIntegrityMigration, /reject_recovery_evidence_mutation/);
  assert.match(clockIntegrityMigration, /reject_recovery_cohort_mutation/);
  assert.match(clockIntegrityMigration, /recovery_source_disconnections/);
  assert.match(clockIntegrityMigration, /not exists \(select 1 from workspaces where id = old.workspace_id\)/);
  assert.doesNotMatch(clockIntegrityMigration, /or not exists \(\s*select 1 from recovery_sources/);
  assert.match(schema, /reject_recovery_cohort_mutation/);
  assert.match(schema, /recovery_source_disconnections/);
  const reconcileMigration = readFileSync(new URL("../infra/postgres/migrations/0038_autopilot_reconcile_integrity.sql", import.meta.url), "utf8");
  assert.match(reconcileMigration, /notice_tags/);
  assert.match(reconcileMigration, /notice_payload_version/);
  assert.match(reconcileMigration, /reconnected_at/);
  assert.doesNotMatch(reconcileMigration, /create or replace function reject_recovery_evidence_mutation/);
  assert.match(schema, /notice_tags jsonb/);
  assert.match(schema, /notice_payload_version integer/);
  assert.match(schema, /reconnected_at timestamptz/);
  const frozenNoticeMigration = readFileSync(new URL("../infra/postgres/migrations/0039_autopilot_frozen_notice_integrity.sql", import.meta.url), "utf8");
  assert.match(frozenNoticeMigration, /reject_recovery_frozen_notice_mutation/);
  assert.match(frozenNoticeMigration, /old.frozen_at is not null/);
  assert.match(frozenNoticeMigration, /notice_from_email/);
  assert.match(frozenNoticeMigration, /notice_tags/);
  assert.match(frozenNoticeMigration, /notice_payload_version/);
  assert.match(frozenNoticeMigration, /notice_body_hash/);
  assert.match(frozenNoticeMigration, /veto_token_hash/);
  assert.match(frozenNoticeMigration, /veto_expires_at/);
  assert.match(frozenNoticeMigration, /frozen_at/);
  assert.doesNotMatch(frozenNoticeMigration, /delivery_status is distinct from old.delivery_status/);
  assert.doesNotMatch(reconcileMigration, /reject_recovery_frozen_notice_mutation/);
  assert.doesNotMatch(clockIntegrityMigration, /reject_recovery_frozen_notice_mutation/);
  const reviewIntegrityMigration = readFileSync(new URL("../infra/postgres/migrations/0040_autopilot_review_integrity.sql", import.meta.url), "utf8");
  assert.match(reviewIntegrityMigration, /notice_hash_version/);
  assert.match(reviewIntegrityMigration, /before update or delete/i);
  assert.match(reviewIntegrityMigration, /Frozen notice cannot be deleted directly/i);
  assert.match(reviewIntegrityMigration, /exists \(select 1 from workspaces where id = old.workspace_id\)/);
  assert.match(schema, /reject_recovery_frozen_notice_mutation/);
  assert.match(schema, /notice_hash_version smallint/);
  assert.match(schema, /frozen notice payload cannot be mutated/i);
  const activationIntegrityMigration = readFileSync(new URL("../infra/postgres/migrations/0041_workspace_activation_integrity.sql", import.meta.url), "utf8");
  assert.match(activationIntegrityMigration, /product_events_workspace_activated_once_idx/);
  assert.match(activationIntegrityMigration, /event_name = 'workspace.activated'/);
  assert.match(activationIntegrityMigration, /workspace_id is not null/);
  assert.match(activationIntegrityMigration, /row_number\(\) over/i);
  assert.match(activationIntegrityMigration, /create unique index/i);
  assert.doesNotMatch(activationIntegrityMigration, /drop table|truncate/i);
  const activationResetMigration = readFileSync(new URL("../infra/postgres/migrations/0042_workspace_activation_semantic_reset.sql", import.meta.url), "utf8");
  assert.match(activationResetMigration, /delete from product_events/i);
  assert.match(activationResetMigration, /event_name = 'workspace.activated'/);
  assert.doesNotMatch(activationResetMigration, /drop index|drop table|truncate/i);
  const activationMarkerMigration = readFileSync(new URL("../infra/postgres/migrations/0043_workspace_activation_semantic_version.sql", import.meta.url), "utf8");
  assert.match(activationMarkerMigration, /activation_semantic_version/);
  assert.match(activationMarkerMigration, /is not distinct from 1/);
  assert.match(activationMarkerMigration, /product_events_workspace_activated_semantic_version_check/);
  assert.match(activationMarkerMigration, /delete from product_events/i);
  assert.match(activationMarkerMigration, /event_name = 'workspace.activated'/);
  assert.doesNotMatch(activationMarkerMigration, /drop index|drop table|truncate/i);
  assert.doesNotMatch(activationMarkerMigration, /0042_workspace_activation_semantic_reset/);
  const auditImmutabilityMigration = readFileSync(new URL("../infra/postgres/migrations/0044_autopilot_audit_immutability.sql", import.meta.url), "utf8");
  assert.match(auditImmutabilityMigration, /before update or delete on recovery_fee_ledger/i);
  assert.match(auditImmutabilityMigration, /Finalized fee ledger rows cannot be deleted directly/);
  assert.match(auditImmutabilityMigration, /before update or delete on recovery_billing_year_anchors/i);
  assert.match(auditImmutabilityMigration, /Workspace activation cannot be deleted directly/);
  assert.doesNotMatch(auditImmutabilityMigration, /drop table|truncate/i);
  assert.match(schema, /recovery_fee_ledger_immutable/);
  assert.match(schema, /before insert or update or delete on recovery_fee_ledger/i);
  assert.match(schema, /product_events_workspace_activated_immutable/);
  assert.match(schema, /product_events_workspace_activated_once_idx/);
  assert.match(schema, /event_name = 'workspace.activated' and workspace_id is not null/);
  assert.match(schema, /activation_semantic_version/);
  assert.match(schema, /product_events_workspace_activated_semantic_version_check/);
  const mandateExecutionMigration = readFileSync(new URL("../infra/postgres/migrations/0045_autopilot_mandate_execution_immutability.sql", import.meta.url), "utf8");
  assert.match(mandateExecutionMigration, /Standing mandate terms cannot be mutated/);
  assert.match(mandateExecutionMigration, /recovery_classification_snapshots_immutable/);
  assert.match(mandateExecutionMigration, /recovery_execution_attempts_constrain_mutation/);
  assert.match(mandateExecutionMigration, /razorpay_charge_status is distinct from old.razorpay_charge_status/);
  assert.doesNotMatch(mandateExecutionMigration, /drop table|truncate/i);
  assert.match(schema, /recovery_standing_mandates_constrain_mutation/);
  assert.match(schema, /recovery_execution_attempts_constrain_mutation/);
  const billedWindowMigration = readFileSync(new URL("../infra/postgres/migrations/0046_billed_window_immutability.sql", import.meta.url), "utf8");
  assert.match(billedWindowMigration, /Billed covered windows cannot be mutated/);
  assert.match(billedWindowMigration, /recovery_covered_windows_billed_immutable/);
  assert.match(billedWindowMigration, /before update or delete on recovery_covered_windows/i);
  assert.doesNotMatch(billedWindowMigration, /drop table|truncate/i);
  const billedWindowInsertMigration = readFileSync(new URL("../infra/postgres/migrations/0047_billed_window_insert_immutability.sql", import.meta.url), "utf8");
  assert.match(billedWindowInsertMigration, /pg_advisory_xact_lock/);
  assert.match(billedWindowInsertMigration, /before insert or update or delete on recovery_fee_ledger/i);
  assert.match(billedWindowInsertMigration, /before insert or update or delete on recovery_covered_windows/i);
  assert.match(billedWindowInsertMigration, /Billed covered windows cannot be mutated/);
  assert.doesNotMatch(billedWindowInsertMigration, /drop table|truncate/i);
  assert.match(schema, /recovery_covered_windows_billed_immutable/);
  assert.match(schema, /before insert or update or delete on recovery_covered_windows/i);
});
