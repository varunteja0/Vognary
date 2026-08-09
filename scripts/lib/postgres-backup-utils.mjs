import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const algorithm = "aes-256-gcm";
const keyByteLength = 32;

export function parseBackupEncryptionKey(rawKey, name = "BACKUP_ENCRYPTION_KEY") {
  const value = rawKey?.trim();
  if (!value) throw new Error(`${name} is required for encrypted database backups.`);

  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64url");

  if (key.length !== keyByteLength) {
    throw new Error(`${name} must decode to 32 bytes for AES-256-GCM.`);
  }

  return key;
}

export async function encryptFile({ inputPath, outputPath, key, associatedData }) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));

  const hash = createHash("sha256");
  let bytes = 0;
  const hashPlaintext = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(
    createReadStream(inputPath),
    hashPlaintext,
    cipher,
    createWriteStream(outputPath, { mode: 0o600 }),
  );

  return {
    algorithm,
    associatedData,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    keyFingerprint: fingerprintKey(key),
    plaintextSha256: hash.digest("hex"),
    plaintextBytes: bytes,
  };
}

export async function decryptFile({ inputPath, outputPath, key, encryption }) {
  if (encryption.algorithm !== algorithm) throw new Error(`Unsupported backup encryption algorithm: ${encryption.algorithm}`);

  const expectedFingerprint = Buffer.from(fingerprintKey(key));
  const actualFingerprint = Buffer.from(encryption.keyFingerprint ?? "");
  if (expectedFingerprint.length !== actualFingerprint.length || !timingSafeEqual(expectedFingerprint, actualFingerprint)) {
    throw new Error("BACKUP_ENCRYPTION_KEY fingerprint does not match the selected backup manifest.");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });

  const decipher = createDecipheriv(algorithm, key, Buffer.from(encryption.iv, "base64url"));
  decipher.setAAD(Buffer.from(encryption.associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(encryption.tag, "base64url"));

  const hash = createHash("sha256");
  let bytes = 0;
  const hashPlaintext = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(
    createReadStream(inputPath),
    decipher,
    hashPlaintext,
    createWriteStream(outputPath, { mode: 0o600 }),
  );

  return {
    plaintextSha256: hash.digest("hex"),
    plaintextBytes: bytes,
  };
}

export function fingerprintKey(key) {
  return createHash("sha256").update(key).digest("base64url").slice(0, 16);
}

export function redactDatabaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = "redacted";
    if (url.password) url.password = "redacted";
    url.search = "";
    return url.toString();
  } catch {
    return "redacted-database-url";
  }
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function sanitizeLabel(value) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "backup";
}

export function timestampLabel(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString());
    });
    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}. ${stderr || stdout}`.trim()));
    });
  });
}

export async function runPostgresCommand(command, args, options = {}) {
  const forceDocker = options.env?.POSTGRES_CLIENT_MODE === "docker";
  if (!forceDocker && commandExists(command)) return runCommand(command, args, options);

  if (!commandExists("docker")) {
    throw new Error(`${command} is not installed and Docker fallback is unavailable.`);
  }

  const volumes = options.volumes ?? [];
  const dockerEnvironment = postgresDockerEnvironment(options.env ?? process.env);
  const dockerArgs = [
    "run",
    "--rm",
    ...volumes.flatMap((volume) => ["-v", `${volume.hostPath}:${volume.containerPath}`]),
    ...dockerEnvNames(dockerEnvironment).flatMap((name) => ["-e", name]),
    "postgres:16.14@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b",
    command,
    ...args.map((arg) => rewriteDockerPath(arg, volumes)),
  ];

  return runCommand("docker", dockerArgs, { ...options, env: dockerEnvironment });
}

export function postgresConnectionEnv(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error("PostgreSQL connection URL is invalid.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!database) throw new Error("PostgreSQL connection URL must name a database.");
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
}

export function postgresDockerEnvironment(environment) {
  if (!["localhost", "127.0.0.1", "::1"].includes(environment.PGHOST)) return environment;
  return { ...environment, PGHOST: "host.docker.internal" };
}

export function relativeFromRoot(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

export function hasPostgresClientTool(command) {
  return commandExists(command) || isDockerUsable();
}

function commandExists(command) {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

export function isDockerUsable() {
  if (!commandExists("docker")) return false;
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

function dockerEnvNames(env) {
  return [
    "PGDATABASE",
    "PGSSLMODE",
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGPASSFILE",
    "PGSERVICE",
    "PGSSLROOTCERT",
  ].filter((name) => env[name]);
}

function rewriteDockerPath(arg, volumes) {
  if (typeof arg !== "string") return arg;

  for (const volume of volumes) {
    const relative = path.relative(volume.hostPath, arg);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return path.posix.join(volume.containerPath, relative.split(path.sep).join("/"));
    }
    if (relative === "") return volume.containerPath;
  }

  return arg;
}

function appendLimited(current, next) {
  const combined = current + next;
  return combined.length > 6000 ? combined.slice(-6000) : combined;
}