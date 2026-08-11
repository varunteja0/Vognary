import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../infra/postgres/migrations/0023_recovery_v1.sql", import.meta.url), "utf8");
const inboundMigration = readFileSync(new URL("../infra/postgres/migrations/0024_recovery_inbound_receipts.sql", import.meta.url), "utf8");
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
    assert.match(sql, /source_type in \('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL'\)/i);
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
    /alter table connected_accounts\s+drop constraint if exists connected_accounts_workspace_id_id_key;\s*alter table connected_accounts\s+add constraint connected_accounts_workspace_id_id_key\s+unique \(workspace_id, id\);/i,
  );
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
