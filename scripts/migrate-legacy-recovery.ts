import pg from "pg";

import { countLegacyLedgerRows, migrateLegacyRecovery } from "./lib/migrate-legacy-recovery";

async function main() {
  const { Pool } = pg;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for legacy Recovery migration.");
  const reportOnly = process.argv.includes("--report");
  if (!reportOnly && !process.argv.includes("--confirm")) {
    throw new Error("Refusing to migrate legacy production authority without --confirm. Use --report to count rows.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.POSTGRES_SSL === "true" ? {
      ca: process.env.POSTGRES_CA_CERT || undefined,
      rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
    } : undefined,
  });

  try {
    if (reportOnly) {
      const report = await countLegacyLedgerRows(pool);
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "clean") process.exitCode = 2;
      return;
    }
    const before = await countLegacyLedgerRows(pool);
    const result = await migrateLegacyRecovery(pool);
    const after = await countLegacyLedgerRows(pool);
    console.log(JSON.stringify({ before, result, after }, null, 2));
    if (after.status !== "clean") {
      throw new Error(`Zero-difference reconciliation failed: ${after.legacyRows} legacy rows remain.`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
