import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMigrationTarget, selectMigrationFiles } from "../scripts/lib/migration-target.mjs";

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
  assert.match(source, /assertInitialSchemaBaseline/);
  assert.match(source, /--through/);
  assert.match(source, /selectMigrationFiles\(await listMigrationFiles\(\), throughMigrationId\)/);
  assert.match(source, /--through is allowed only on an existing schema/);
  assert.ok(
    source.indexOf("assertTargetedRunUsesExistingSchema(client)") < source.indexOf("ensureMigrationLedger(client)"),
    "a targeted fresh install must fail before creating the migration ledger",
  );
  assert.ok(
    source.indexOf("assertInitialSchemaBaseline") < source.indexOf("recordMigration(client, migrationId, schema)"),
    "an existing database must pass baseline validation before 0001 is recorded",
  );
  assert.doesNotMatch(source, /on conflict \(id\) do nothing/);
});

test("migration targets reject missing, duplicate, malformed, unknown, and absent values", () => {
  assert.equal(parseMigrationTarget([]), null);
  assert.equal(parseMigrationTarget(["--through=0025_recovery_renewal_alerts"]), "0025_recovery_renewal_alerts");
  assert.equal(parseMigrationTarget(["--through", "0025_recovery_renewal_alerts"]), "0025_recovery_renewal_alerts");
  assert.throws(() => parseMigrationTarget(["--through"]), /requires one migration id/i);
  assert.throws(() => parseMigrationTarget(["--through="]), /requires one migration id/i);
  assert.throws(() => parseMigrationTarget(["--through", "--other"]), /requires one migration id/i);
  assert.throws(() => parseMigrationTarget(["--through=0025_recovery_renewal_alerts", "--through=0026_recovery_inbound_retention"]), /only once/i);
  assert.throws(() => parseMigrationTarget(["--through=../../0025"]), /must name one migration id/i);
  assert.throws(() => parseMigrationTarget(["--unknown"]), /unknown migration argument/i);
  assert.deepEqual(
    selectMigrationFiles(["0024_recovery_inbound_receipts.sql", "0025_recovery_renewal_alerts.sql", "0026_recovery_inbound_retention.sql"], "0025_recovery_renewal_alerts"),
    ["0024_recovery_inbound_receipts.sql", "0025_recovery_renewal_alerts.sql"],
  );
  assert.throws(
    () => selectMigrationFiles(["0024_recovery_inbound_receipts.sql"], "0025_recovery_renewal_alerts"),
    /target 0025_recovery_renewal_alerts does not exist/i,
  );
});