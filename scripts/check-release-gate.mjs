import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import pg from "pg";

const { Pool } = pg;

const args = process.argv.slice(2);
const planOnly = args.includes("--plan");
const urlArg = args.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));
const target = (urlArg || process.env.NEXT_PUBLIC_APP_URL || "https://www.vognary.com").replace(/\/$/, "");
const releaseDatabaseUrl = process.env.RELEASE_DATABASE_URL?.trim() ?? "";
const productionDatabaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const releaseDatabaseIdentity = databaseIdentity(releaseDatabaseUrl);
const productionDatabaseIdentity = databaseIdentity(productionDatabaseUrl);
const e2eEmail = process.env.VOGNARY_E2E_DEV_LOGIN_EMAIL?.trim() ?? "";
const e2eCode = process.env.VOGNARY_E2E_DEV_LOGIN_CODE?.trim() ?? "";
const targetInternalSecret = process.env.PRODUCTION_INTERNAL_SYNC_SECRET?.trim()
  || process.env.INTERNAL_SYNC_SECRET?.trim()
  || "";

if (args.includes("--help")) {
  console.log(`Run every code, database, browser, corpus, operations, and production release gate without mutating production data.

Usage:
  npm run release:gate -- https://www.vognary.com
  npm run release:gate -- --plan https://www.vognary.com

Required operator environment:
  RELEASE_DATABASE_URL             disposable non-production database
  RELEASE_CONFIRM_DISPOSABLE=true  explicit permission to mutate that database
  VOGNARY_E2E_DEV_LOGIN_EMAIL      local browser-test identity
  VOGNARY_E2E_DEV_LOGIN_CODE       local browser-test access code
  PRODUCTION_INTERNAL_SYNC_SECRET  deployed readiness secret (falls back to INTERNAL_SYNC_SECRET)

The gate refuses to run database or browser tests when RELEASE_DATABASE_URL equals DATABASE_URL.`);
  process.exit(0);
}

const requirements = [
  requirement("RELEASE_DATABASE_URL", Boolean(releaseDatabaseUrl)),
  requirement(
    "RELEASE_DATABASE_URL must differ from DATABASE_URL",
    Boolean(releaseDatabaseIdentity)
      && (!productionDatabaseUrl || (Boolean(productionDatabaseIdentity) && releaseDatabaseIdentity !== productionDatabaseIdentity)),
  ),
  requirement("RELEASE_CONFIRM_DISPOSABLE=true", process.env.RELEASE_CONFIRM_DISPOSABLE?.trim() === "true"),
  requirement("VOGNARY_E2E_DEV_LOGIN_EMAIL", Boolean(e2eEmail)),
  requirement("VOGNARY_E2E_DEV_LOGIN_CODE", Boolean(e2eCode)),
  requirement("PRODUCTION_INTERNAL_SYNC_SECRET or INTERNAL_SYNC_SECRET", Boolean(targetInternalSecret)),
];

const plannedSteps = [
  { id: "code-ci", label: "Lint, typecheck, unit tests, build, budgets, and Lighthouse" },
  { id: "database", label: "All migrations and PostgreSQL integration tests on the disposable database" },
  { id: "browser", label: "Complete Playwright desktop/mobile suite with embedded axe checks" },
  { id: "local-smoke", label: "Production-build smoke suite on a disposable local server" },
  { id: "local-load", label: "Loopback-only audit and maximum-size PDF load budgets" },
  { id: "statement-corpus", label: "Strict real-statement corpus quality gate" },
  { id: "receipt-corpus", label: "Strict real-receipt corpus quality gate" },
  { id: "operations", label: "Production operations and readiness preflight" },
  { id: "production", label: "Strict read-only production activation probes" },
];

if (planOnly) {
  console.log(JSON.stringify({
    status: "plan",
    target,
    requirements,
    steps: plannedSteps,
  }, null, 2));
  process.exit(0);
}

const missing = requirements.filter((entry) => !entry.ready).map((entry) => entry.label);
if (missing.length) {
  console.error(JSON.stringify({
    status: "blocked",
    target,
    missing,
    message: "Release gate did not start. Fix the operator preconditions; production data was not touched.",
  }, null, 2));
  process.exit(1);
}

const baseEnvironment = sanitizeLocalEnvironment(process.env);
baseEnvironment.DATABASE_URL = "";
baseEnvironment.DATABASE_URL_UNPOOLED = "";
const releaseEnvironment = {
  ...baseEnvironment,
  DATABASE_URL: releaseDatabaseUrl,
  POSTGRES_SSL: process.env.RELEASE_POSTGRES_SSL?.trim() || inferReleasePostgresSsl(releaseDatabaseUrl),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  SESSION_SECRET: randomBytes(48).toString("base64url"),
  INTERNAL_SYNC_SECRET: `internal-${randomBytes(24).toString("base64url")}`,
  CRON_SECRET: `cron-${randomBytes(24).toString("base64url")}`,
};
const productionProbeEnvironment = {
  ...process.env,
  PRODUCTION_INTERNAL_SYNC_SECRET: targetInternalSecret,
};

const results = [];
results.push(await runCommand(plannedSteps[0], "npm", ["run", "ci"], baseEnvironment));
results.push(await runCommand(plannedSteps[1], "npm", ["run", "ci:database"], releaseEnvironment));
results.push(await runBrowserGate(plannedSteps[2], releaseEnvironment));
results.push(await runLocalSmoke(plannedSteps[3], releaseEnvironment));
results.push(await runLocalLoad(plannedSteps[4], releaseEnvironment));
results.push(await runCommand(plannedSteps[5], "npm", ["run", "corpus:strict"], baseEnvironment));
results.push(await runCommand(plannedSteps[6], "npm", ["run", "receipt-corpus:strict"], baseEnvironment));
results.push(await runCommand(plannedSteps[7], process.execPath, ["scripts/check-ops-preflight.mjs", target], productionProbeEnvironment));
results.push(await runCommand(plannedSteps[8], process.execPath, ["scripts/check-production-activation.mjs", target, "--strict"], productionProbeEnvironment));

const ready = results.every((result) => result.status === "passed");
console.log(`\n${JSON.stringify({ status: ready ? "ready" : "blocked", target, steps: results }, null, 2)}`);
if (!ready) process.exitCode = 1;

function requirement(label, ready) {
  return { label, ready };
}

async function runCommand(step, command, commandArgs, environment) {
  console.log(`\n[release:gate] ${step.id} — ${step.label}`);
  const code = await spawnAndWait(command, commandArgs, { env: environment, stdio: "inherit" });
  return { id: step.id, status: code === 0 ? "passed" : "failed", exitCode: code };
}

async function runBrowserGate(step, environment) {
  console.log(`\n[release:gate] ${step.id} — ${step.label}`);
  try {
    await clearDisposableRateLimits(environment);
    const port = await findOpenPort();
    const origin = `http://127.0.0.1:${port}`;
    const serverEnvironment = {
      ...environment,
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: origin,
      ENABLE_DEVELOPMENT_LOGIN: "true",
      DEVELOPMENT_LOGIN_EMAIL: e2eEmail,
      DEVELOPMENT_LOGIN_ACCESS_CODE: e2eCode,
    };
    const server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: process.cwd(),
      env: serverEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverOutput = "";
    server.stdout.on("data", (chunk) => { serverOutput = boundedAppend(serverOutput, chunk); });
    server.stderr.on("data", (chunk) => { serverOutput = boundedAppend(serverOutput, chunk); });
    await waitForHealth(origin, server, () => serverOutput);
    try {
      const code = await spawnAndWait("npm", ["run", "test:e2e"], {
        env: {
          ...serverEnvironment,
          PLAYWRIGHT_EXTERNAL_SERVER: "1",
          PLAYWRIGHT_BASE_URL: origin,
          VOGNARY_E2E_DEV_LOGIN_EMAIL: e2eEmail,
          VOGNARY_E2E_DEV_LOGIN_CODE: e2eCode,
          VOGNARY_E2E_EVIDENCE_DIR: "output/release-evidence",
        },
        stdio: "inherit",
      });
      return { id: step.id, status: code === 0 ? "passed" : "failed", exitCode: code };
    } finally {
      await stopChild(server);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Browser gate server failed.");
    return { id: step.id, status: "failed", exitCode: 1 };
  }
}

async function runLocalSmoke(step, environment) {
  console.log(`\n[release:gate] ${step.id} — ${step.label}`);
  const port = await findOpenPort();
  const origin = `http://127.0.0.1:${port}`;
  const internalSecret = `release-gate-${randomBytes(24).toString("base64url")}`;
  const serverEnvironment = {
    ...environment,
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: origin,
    INTERNAL_SYNC_SECRET: internalSecret,
    CRON_SECRET: `cron-${randomBytes(24).toString("base64url")}`,
  };
  const server = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: serverEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput = boundedAppend(serverOutput, chunk); });
  server.stderr.on("data", (chunk) => { serverOutput = boundedAppend(serverOutput, chunk); });
  try {
    await waitForHealth(origin, server, () => serverOutput);
    const code = await spawnAndWait(process.execPath, ["scripts/smoke-test.mjs"], {
      env: { ...serverEnvironment, SMOKE_BASE_URL: origin, SMOKE_INTERNAL_SECRET: internalSecret },
      stdio: "inherit",
    });
    return { id: step.id, status: code === 0 ? "passed" : "failed", exitCode: code };
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Local smoke server failed.");
    return { id: step.id, status: "failed", exitCode: 1 };
  } finally {
    await stopChild(server);
  }
}

async function runLocalLoad(step, environment) {
  console.log(`\n[release:gate] ${step.id} — ${step.label}`);
  const port = await findOpenPort();
  const origin = `http://127.0.0.1:${port}`;
  const serverEnvironment = {
    ...environment,
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: origin,
  };
  const server = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: serverEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput = boundedAppend(serverOutput, chunk); });
  server.stderr.on("data", (chunk) => { serverOutput = boundedAppend(serverOutput, chunk); });
  try {
    await waitForHealth(origin, server, () => serverOutput);
    const code = await spawnAndWait(process.execPath, ["scripts/check-load-budget.mjs", origin], {
      env: serverEnvironment,
      stdio: "inherit",
    });
    return { id: step.id, status: code === 0 ? "passed" : "failed", exitCode: code };
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Local load server failed.");
    return { id: step.id, status: "failed", exitCode: 1 };
  } finally {
    await stopChild(server);
  }
}

function spawnAndWait(command, commandArgs, options) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: process.cwd(), ...options });
    child.once("error", (error) => {
      console.error(`${command} could not start: ${error.message}`);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      if (signal) console.error(`${command} exited from signal ${signal}.`);
      resolve(code ?? 1);
    });
  });
}

async function clearDisposableRateLimits(environment) {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    ssl: environment.POSTGRES_SSL === "true" ? {
      ca: environment.POSTGRES_CA_CERT || undefined,
      rejectUnauthorized: environment.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
    } : undefined,
  });
  try {
    const result = await pool.query("delete from rate_limit_buckets");
    console.log(`[release:gate] reset ${result.rowCount ?? 0} disposable rate-limit buckets before browser tests`);
  } finally {
    await pool.end();
  }
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(origin, child, readOutput) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Release test server exited before becoming ready.\n${readOutput()}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Release test server did not become ready within 60 seconds.\n${readOutput()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function boundedAppend(current, chunk) {
  return `${current}${String(chunk)}`.slice(-12_000);
}

function inferReleasePostgresSsl(connectionString) {
  try {
    const hostname = new URL(connectionString).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ? "false" : "true";
  } catch {
    return "true";
  }
}

function databaseIdentity(connectionString) {
  if (!connectionString) return "";
  try {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return "";
    const port = url.port || "5432";
    return `${url.hostname.toLowerCase()}:${port}${url.pathname}`;
  } catch {
    return "";
  }
}

function sanitizeLocalEnvironment(input) {
  const output = { ...input };
  const externalPrefixes = [
    "ANTHROPIC_",
    "AUDIT_PACK_",
    "AWS_",
    "BACKUP_",
    "BETTER_STACK_",
    "CLERK_",
    "GOOGLE_",
    "OPENAI_",
    "RAZORPAY_",
    "RESEND_",
    "SENTRY_",
    "SETU_",
    "UPSTASH_",
    "VERCEL_",
  ];
  const externalNames = new Set([
    "ACCOUNT_AGGREGATOR_PARTNER_STATUS",
    "AUDIT_INTAKE_WEBHOOK_URL",
    "AUTH_PROVIDER",
    "AXIOM_TOKEN",
    "CARD_MANDATE_PARTNER_STATUS",
    "CONNECTOR_WEBHOOK_SECRET",
    "CRON_SECRET",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "INTERNAL_SYNC_SECRET",
    "MONITORING_DELIVERY_TEST_STATUS",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "PRIVATE_BETA_ACCESS_CODE",
    "PRODUCTION_INTERNAL_SYNC_SECRET",
    "SESSION_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "UPI_MANDATE_PARTNER_STATUS",
    "WAITLIST_WEBHOOK_URL",
    "VERCEL",
  ]);
  const candidateNames = new Set([...Object.keys(output), ...readLocalEnvironmentNames()]);
  for (const name of candidateNames) {
    if (externalNames.has(name) || externalPrefixes.some((prefix) => name.startsWith(prefix))) output[name] = "";
  }
  return output;
}

function readLocalEnvironmentNames() {
  const names = new Set();
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) names.add(match[1]);
    }
  }
  return names;
}
