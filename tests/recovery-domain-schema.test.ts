import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../infra/postgres/migrations/0023_recovery_v1.sql", import.meta.url), "utf8");
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
