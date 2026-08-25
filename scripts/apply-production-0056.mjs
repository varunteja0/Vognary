/**
 * Bounded one-off production migration: 0055_recovery_decision_cycles
 * -> 0056_decision_cycle_expected_amount.
 *
 * This is intentionally not a general migration command. It refuses any
 * starting head other than 0055, non-adjacent local 0055/0056 files, schema
 * drift, checksum drift, or a second invocation after success.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const fromMigration = "0055_recovery_decision_cycles";
const toMigration = "0056_decision_cycle_expected_amount";
const expectedChecksum = "7b0f25a129e7692968d5e30846035480a6a60c179ac526a84ecba4e56e038ef5";
const confirmation = "--confirm-0055-to-0056-production";
const migrationLockId = 8_668_642_791;
const beforeOutcomes = ["CANNOT_EVALUATE", "CHARGE_ARRIVED", "NO_CHARGE_IN_WINDOW"];
const afterOutcomes = ["AMOUNT_DIFFERED", ...beforeOutcomes].sort();

if (process.argv.length !== 3 || process.argv[2] !== confirmation) {
  console.error(`Refusing bounded production migration. Supply exactly ${confirmation}.`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required for the bounded 0055 to 0056 production migration.");
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
const fromMigrationIndex = localMigrationIds.indexOf(fromMigration);
const toMigrationIndex = localMigrationIds.indexOf(toMigration);
assert(fromMigrationIndex >= 0 && toMigrationIndex >= 0,
  `Bounded one-off requires local ${fromMigration} and ${toMigration} migration files.`);
assert(toMigrationIndex === fromMigrationIndex + 1,
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
    const after = await readAndVerifyAfterState(client, before.cycleRows);
    await client.query("commit");

    const committed = await readAndVerifyAfterState(client, before.cycleRows);
    console.log(JSON.stringify({
      status: "ok",
      mode: "bounded-one-off",
      from: fromMigration,
      to: toMigration,
      checksum: actualChecksum,
      cycleRowsPreserved: committed.cycleRows,
      nonNullExpectedAmounts: committed.nonNullExpectedAmounts,
    }, null, 2));
    assert(after.cycleRows === committed.cycleRows, "Post-commit cycle count changed unexpectedly.");
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
  const ledger = await queryable.query(
    `select id, checksum from schema_migrations order by id`,
  );
  const head = ledger.rows.at(-1);
  assert(head?.id === fromMigration,
    `Bounded production migration must start exactly at ${fromMigration}; found ${head?.id ?? "missing"}.`);
  const recordedPrevious = ledger.rows.find((row) => row.id === fromMigration);
  assert(recordedPrevious?.checksum === previousChecksum,
    `Applied ${fromMigration} checksum does not match the repository migration.`);
  assert(!ledger.rows.some((row) => row.id === toMigration), `${toMigration} is already recorded.`);

  const column = await queryable.query(
    `select data_type
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'recovery_decision_cycles'
       and column_name = 'expected_amount_minor'`,
  );
  assert(column.rowCount === 0,
    "Schema drift: expected_amount_minor exists before migration 0056 is recorded.");
  await assertVerificationOutcomes(queryable, beforeOutcomes);

  const cycles = await queryable.query(`select count(*)::text as cycle_rows from recovery_decision_cycles`);
  return { cycleRows: cycles.rows[0]?.cycle_rows ?? "0" };
}

async function readAndVerifyAfterState(queryable, expectedCycleRows) {
  const ledger = await queryable.query(
    `select id, checksum from schema_migrations order by id`,
  );
  const head = ledger.rows.at(-1);
  assert(head?.id === toMigration, `Migration ledger head is ${head?.id ?? "missing"}; expected ${toMigration}.`);
  assert(head?.checksum === expectedChecksum,
    `Recorded ${toMigration} checksum is ${head?.checksum ?? "missing"}; expected ${expectedChecksum}.`);

  const column = await queryable.query(
    `select data_type, udt_name, is_nullable, column_default
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'recovery_decision_cycles'
       and column_name = 'expected_amount_minor'`,
  );
  assert(column.rowCount === 1, "expected_amount_minor was not created exactly once.");
  assert(column.rows[0]?.data_type === "bigint" && column.rows[0]?.udt_name === "int8",
    "expected_amount_minor is not PostgreSQL bigint.");
  assert(column.rows[0]?.is_nullable === "YES", "expected_amount_minor must remain nullable.");
  assert(column.rows[0]?.column_default === null, "expected_amount_minor must not have a fabricated default.");
  await assertVerificationOutcomes(queryable, afterOutcomes);

  const cycles = await queryable.query(
    `select count(*)::text as cycle_rows,
            count(*) filter (where expected_amount_minor is not null)::text as non_null_expected_amounts
     from recovery_decision_cycles`,
  );
  const cycleRows = cycles.rows[0]?.cycle_rows ?? "0";
  const nonNullExpectedAmounts = cycles.rows[0]?.non_null_expected_amounts ?? "0";
  assert(cycleRows === expectedCycleRows,
    `Migration changed recovery_decision_cycles row count from ${expectedCycleRows} to ${cycleRows}.`);
  assert(nonNullExpectedAmounts === "0",
    `Migration fabricated expected amounts for ${nonNullExpectedAmounts} legacy decision cycles.`);
  return { cycleRows, nonNullExpectedAmounts };
}

async function assertVerificationOutcomes(queryable, expected) {
  const result = await queryable.query(
    `select pg_get_constraintdef(oid) as definition
     from pg_constraint
     where conrelid = 'recovery_decision_cycles'::regclass
       and conname = 'recovery_decision_cycles_verification_outcome_check'`,
  );
  assert(result.rowCount === 1,
    "recovery_decision_cycles_verification_outcome_check is missing or duplicated.");
  const definition = result.rows[0]?.definition ?? "";
  const values = [...definition.matchAll(/'(AMOUNT_DIFFERED|CANNOT_EVALUATE|CHARGE_ARRIVED|NO_CHARGE_IN_WINDOW)'/g)]
    .map((match) => match[1])
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort();
  assert(JSON.stringify(values) === JSON.stringify([...expected].sort()),
    `Verification outcome CHECK has [${values.join(", ")}]; expected [${[...expected].sort().join(", ")}].`);
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
