import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("migration runner serializes the full pass and rejects forward checksum drift", () => {
  const source = readFileSync(new URL("../scripts/apply-postgres-schema.mjs", import.meta.url), "utf8");
  const lock = source.indexOf("pg_try_advisory_lock");
  const initial = source.indexOf("applyInitialSchema", lock);
  const pending = source.indexOf("applyPendingMigrations", initial);
  const unlock = source.indexOf("pg_advisory_unlock", pending);
  assert.ok(lock > -1 && initial > lock && pending > initial && unlock > pending);
  assert.match(source, /Migration checksum mismatch/);
  assert.match(source, /Another schema migration runner already holds/);
  assert.match(source, /recordedChecksum !== expectedChecksum/);
  assert.match(source, /set local lock_timeout = '10s'/);
  assert.match(source, /set local statement_timeout = '120s'/);
  assert.doesNotMatch(source, /on conflict \(id\) do nothing/);
});