/**
 * Bounded one-off production migration: 0056_decision_cycle_expected_amount
 * -> 0057_commitment_control_v0.
 *
 * This command applies exactly one additive migration. It refuses schema drift,
 * checksum drift, a non-0056 starting head, existing Control tables, concurrent
 * migration ownership, or a second invocation.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const fromMigration = "0056_decision_cycle_expected_amount";
const toMigration = "0057_commitment_control_v0";
const expectedChecksum = "eb1145d8248f5044c38472870525209560122fad5b4aa3175fb26f6edc9afc4f";
const confirmation = "--confirm-0056-to-0057-production";
const migrationLockId = 8_668_642_791;
const controlTables = [
  "commitment_control_policies",
  "commitment_control_proposals",
  "commitment_control_evaluations",
  "commitment_control_evaluation_evidence",
  "commitment_control_decisions",
  "commitment_control_reconciliations",
];
const controlTriggers = [
  "commitment_control_policies_immutable",
  "commitment_control_proposals_immutable",
  "commitment_control_evaluations_immutable",
  "commitment_control_evaluation_evidence_immutable",
  "commitment_control_decisions_immutable",
  "commitment_control_reconciliations_immutable",
];
const preservedCountQuery = `select
  (select count(*)::text from recovery_workspace_states) as recovery_workspace_states,
  (select count(*)::text from recovery_workspace_versions) as recovery_workspace_versions,
  (select count(*)::text from recovery_commitments) as recovery_commitments,
  (select count(*)::text from recovery_evidence) as recovery_evidence,
  (select count(*)::text from recovery_decision_cycles) as recovery_decision_cycles,
  (select count(*)::text from product_events) as product_events`;

if (process.argv.length !== 3 || process.argv[2] !== confirmation) {
  console.error(`Refusing bounded production migration. Supply exactly ${confirmation}.`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required for the bounded 0056 to 0057 production migration.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsPath = path.join(root, "infra", "postgres", "migrations");
const migrationPath = path.join(migrationsPath, `${toMigration}.sql`);
const previousMigrationPath = path.join(migrationsPath, `${fromMigration}.sql`);
const migrationSql = await readFile(migrationPath, "utf8");
const previousMigrationSql = await readFile(previousMigrationPath, "utf8");
const actualChecksum = checksum(migrationSql);
const previousChecksum = checksum(previousMigrationSql);

assert(actualChecksum === expectedChecksum,
  `Migration ${toMigration} checksum is ${actualChecksum}; expected ${expectedChecksum}.`);

const localMigrationIds = (await readdir(migrationsPath))
  .filter((entry) => /^\d{4}_.+\.sql$/.test(entry))
  .sort()
  .map((entry) => entry.replace(/\.sql$/, ""));
const fromIndex = localMigrationIds.indexOf(fromMigration);
const toIndex = localMigrationIds.indexOf(toMigration);
assert(fromIndex >= 0 && toIndex === fromIndex + 1,
  `Bounded one-off requires ${fromMigration} immediately before ${toMigration}.`);

const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "true" ? {
    ca: process.env.POSTGRES_CA_CERT || undefined,
    rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
  } : undefined,
});

let client;
let lockAcquired = false;

try {
  client = await pool.connect();
  const lock = await client.query("select pg_try_advisory_lock($1) as acquired", [migrationLockId]);
  lockAcquired = lock.rows[0]?.acquired === true;
  assert(lockAcquired, "Another Vognary schema migration runner already holds the migration lock.");

  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '120s'");

    const before = await readAndVerifyBeforeState(client);
    await client.query(migrationSql);
    await client.query(
      `insert into schema_migrations (id, checksum) values ($1, $2)`,
      [toMigration, actualChecksum],
    );
    const after = await readAndVerifyAfterState(client, before.preservedCounts);
    await client.query("commit");

    const committed = await readAndVerifyAfterState(client, before.preservedCounts);
    assert(JSON.stringify(after) === JSON.stringify(committed), "Post-commit verification changed unexpectedly.");
    console.log(JSON.stringify({
      status: "ok",
      mode: "bounded-one-off",
      from: fromMigration,
      to: toMigration,
      checksum: actualChecksum,
      preservedCounts: committed.preservedCounts,
      controlTables: committed.controlTables,
      controlTriggers: committed.controlTriggers,
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (client && lockAcquired) {
    await client.query("select pg_advisory_unlock($1)", [migrationLockId]).catch(() => undefined);
  }
  client?.release();
  await pool.end();
}

async function readAndVerifyBeforeState(queryable) {
  const ledger = await queryable.query(`select id, checksum from schema_migrations order by id`);
  const head = ledger.rows.at(-1);
  assert(head?.id === fromMigration,
    `Bounded production migration must start exactly at ${fromMigration}; found ${head?.id ?? "missing"}.`);
  const recordedPrevious = ledger.rows.find((row) => row.id === fromMigration);
  assert(recordedPrevious?.checksum === previousChecksum,
    `Applied ${fromMigration} checksum does not match the repository migration.`);
  assert(!ledger.rows.some((row) => row.id === toMigration), `${toMigration} is already recorded.`);

  const relations = await queryable.query(
    `select name
     from unnest($1::text[]) as requested(name)
     where to_regclass('public.' || name) is not null`,
    [controlTables],
  );
  assert(relations.rowCount === 0,
    `Schema drift: Control tables exist before ${toMigration} is recorded.`);

  const counts = await queryable.query(preservedCountQuery);
  return { preservedCounts: counts.rows[0] };
}

async function readAndVerifyAfterState(queryable, expectedCounts) {
  const ledger = await queryable.query(`select id, checksum from schema_migrations order by id`);
  const head = ledger.rows.at(-1);
  assert(head?.id === toMigration, `Migration ledger head is ${head?.id ?? "missing"}; expected ${toMigration}.`);
  assert(head?.checksum === expectedChecksum,
    `Recorded ${toMigration} checksum is ${head?.checksum ?? "missing"}; expected ${expectedChecksum}.`);

  const relations = await queryable.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])
     order by table_name`,
    [controlTables],
  );
  const installedTables = relations.rows.map((row) => row.table_name);
  assert(sameStrings(installedTables, [...controlTables].sort()),
    `Control tables are incomplete: [${installedTables.join(", ")}].`);

  const triggers = await queryable.query(
    `select tgname from pg_trigger
     where not tgisinternal and tgname = any($1::text[])
     order by tgname`,
    [controlTriggers],
  );
  const installedTriggers = triggers.rows.map((row) => row.tgname);
  assert(sameStrings(installedTriggers, [...controlTriggers].sort()),
    `Control immutable triggers are incomplete: [${installedTriggers.join(", ")}].`);

  const constraints = await queryable.query(
    `select conname, pg_get_constraintdef(oid) as definition
     from pg_constraint
     where conname in ('product_events_event_name_check', 'recovery_workspace_versions_mutation_kind_check')
     order by conname`,
  );
  const definitions = Object.fromEntries(constraints.rows.map((row) => [row.conname, row.definition]));
  for (const event of [
    "control.policy_recorded",
    "control.proposal_submitted",
    "control.decision_recorded",
    "control.reconciliation_recorded",
  ]) {
    assert(definitions.product_events_event_name_check?.includes(event), `Product-event CHECK is missing ${event}.`);
  }
  for (const kind of ["MANDATE", "CANDIDATE", "CONTROL_POLICY", "CONTROL_PROPOSAL", "CONTROL_DECISION", "CONTROL_RECONCILIATION"]) {
    assert(definitions.recovery_workspace_versions_mutation_kind_check?.includes(kind), `Workspace mutation CHECK is missing ${kind}.`);
  }

  const controlCounts = await queryable.query(
    `select
       (select count(*)::text from commitment_control_policies) as policies,
       (select count(*)::text from commitment_control_proposals) as proposals,
       (select count(*)::text from commitment_control_evaluations) as evaluations,
       (select count(*)::text from commitment_control_evaluation_evidence) as evaluation_evidence,
       (select count(*)::text from commitment_control_decisions) as decisions,
       (select count(*)::text from commitment_control_reconciliations) as reconciliations`,
  );
  assert(Object.values(controlCounts.rows[0] ?? {}).every((value) => value === "0"),
    "The additive Control migration fabricated tenant data.");

  const counts = await queryable.query(preservedCountQuery);
  assert(JSON.stringify(counts.rows[0]) === JSON.stringify(expectedCounts),
    "The additive Control migration changed existing Recovery or product-event row counts.");

  return {
    preservedCounts: counts.rows[0],
    controlTables: installedTables,
    controlTriggers: installedTriggers,
  };
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameStrings(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
