import { Pool } from "pg";

export type DatabaseStatus = {
  status: "not-configured" | "ready" | "error";
  latencyMs?: number;
  serverTime?: string;
  message?: string;
};

const globalStore = globalThis as typeof globalThis & {
  __vognaryPostgresPool?: Pool;
};

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabasePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  if (!globalStore.__vognaryPostgresPool) {
    globalStore.__vognaryPostgresPool = new Pool({
      connectionString,
      max: Number.parseInt(process.env.POSTGRES_POOL_MAX ?? "5", 10),
      ssl: getPostgresSsl(),
    });
  }

  return globalStore.__vognaryPostgresPool;
}

function getPostgresSsl() {
  if (process.env.POSTGRES_SSL !== "true") return undefined;

  return {
    ca: process.env.POSTGRES_CA_CERT || undefined,
    rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
  };
}

export async function checkDatabaseConnection(): Promise<DatabaseStatus> {
  if (!isDatabaseConfigured()) return { status: "not-configured" };

  const startedAt = Date.now();

  try {
    const result = await getDatabasePool().query<{ server_time: Date }>("select now() as server_time");
    return {
      status: "ready",
      latencyMs: Date.now() - startedAt,
      serverTime: result.rows[0]?.server_time?.toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - startedAt,
      message: formatDatabaseError(error),
    };
  }
}

export function formatDatabaseError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;

  if (error && typeof error === "object") {
    const detail = [
      readErrorField(error, "code"),
      readErrorField(error, "errno"),
      readErrorField(error, "syscall"),
      readErrorField(error, "address"),
      readErrorField(error, "port"),
    ].filter(Boolean).join(" ");

    if (error instanceof Error && detail) return `${error.name}: ${detail}`;
    if (detail) return `Database error: ${detail}`;
    if ("errors" in error && Array.isArray(error.errors) && error.errors.length) {
      const nested = error.errors.map(formatDatabaseError).filter(Boolean).join("; ");
      if (nested) return nested;
    }
  }

  return "Database health check failed.";
}

function readErrorField(error: object, field: string) {
  return field in error ? String((error as Record<string, unknown>)[field]) : "";
}
