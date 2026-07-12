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
      max: readPositiveInteger("POSTGRES_POOL_MAX", 5),
      connectionTimeoutMillis: readPositiveInteger("POSTGRES_CONNECTION_TIMEOUT_MS", 5_000),
      idleTimeoutMillis: readPositiveInteger("POSTGRES_IDLE_TIMEOUT_MS", 30_000),
      statement_timeout: readPositiveInteger("POSTGRES_STATEMENT_TIMEOUT_MS", 30_000),
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

function readPositiveInteger(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
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
