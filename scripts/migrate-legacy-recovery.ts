import pg from "pg";

import { migrateLegacyRecovery } from "./lib/migrate-legacy-recovery";

async function main() {
  const { Pool } = pg;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for legacy Recovery migration.");
  if (!process.argv.includes("--confirm")) {
    throw new Error("Refusing to migrate legacy production authority without --confirm.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.POSTGRES_SSL === "true" ? {
      ca: process.env.POSTGRES_CA_CERT || undefined,
      rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
    } : undefined,
  });

  try {
    const result = await migrateLegacyRecovery(pool);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
