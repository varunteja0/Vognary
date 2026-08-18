import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function getBackupStorageConfig(env = process.env) {
  const bucket = env.BACKUP_STORAGE_BUCKET?.trim() || env.S3_BUCKET?.trim() || env.R2_BUCKET?.trim() || "";
  const endpoint = env.BACKUP_STORAGE_ENDPOINT?.trim().replace(/\/$/, "") || "";
  const region = env.BACKUP_STORAGE_REGION?.trim() || env.AWS_REGION?.trim() || (env.R2_BUCKET?.trim() ? "auto" : "");
  const accessKeyId = env.BACKUP_STORAGE_ACCESS_KEY_ID?.trim() || env.AWS_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = env.BACKUP_STORAGE_SECRET_ACCESS_KEY?.trim() || env.AWS_SECRET_ACCESS_KEY?.trim() || "";
  const sessionToken = env.BACKUP_STORAGE_SESSION_TOKEN?.trim() || env.AWS_SESSION_TOKEN?.trim() || "";
  const prefix = normalizePrefix(env.BACKUP_STORAGE_PREFIX || "vognary-postgres/");
  const provider = env.R2_BUCKET?.trim() ? "r2" : endpoint ? "s3-compatible" : "s3";
  const missing = [];

  if (!bucket) missing.push("BACKUP_STORAGE_BUCKET or S3_BUCKET or R2_BUCKET");
  if (!region) missing.push("BACKUP_STORAGE_REGION or AWS_REGION");
  if (!accessKeyId) missing.push("BACKUP_STORAGE_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("BACKUP_STORAGE_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY");
  if (provider !== "s3" && !endpoint) missing.push("BACKUP_STORAGE_ENDPOINT");

  return {
    ready: missing.length === 0,
    provider,
    bucket,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    prefix,
    missing,
  };
}

export function storedBackupObjectKeys(manifest) {
  const status = manifest?.storage?.status;
  const encryptedDump = manifest?.storage?.objects?.encryptedDump?.trim() || "";
  const manifestObject = manifest?.storage?.objects?.manifest?.trim() || "";
  if (status !== "uploaded" || !encryptedDump || !manifestObject) {
    throw new Error("Backup manifest does not reference uploaded durable-storage objects.");
  }
  return { encryptedDump, manifest: manifestObject };
}

export async function uploadBackupObject(config, { filePath, objectKey, contentType }) {
  const body = await readFile(filePath);
  const target = buildS3Target(config, objectKey);
  const response = await signedS3Fetch(config, {
    method: "PUT",
    objectKey,
    body,
    contentType,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Backup object upload failed with HTTP ${response.status}. ${detail.slice(0, 500)}`.trim());
  }

  return {
    provider: config.provider,
    bucket: config.bucket,
    region: config.region,
    objectKey,
    url: target.redactedUrl,
    etag: response.headers.get("etag") ?? undefined,
  };
}

export async function downloadBackupObject(config, { objectKey, filePath }) {
  const target = buildS3Target(config, objectKey);
  const response = await signedS3Fetch(config, {
    method: "GET",
    objectKey,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Backup object download failed with HTTP ${response.status}. ${detail.slice(0, 500)}`.trim());
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, bytes, { mode: 0o600 });

  return {
    provider: config.provider,
    bucket: config.bucket,
    region: config.region,
    objectKey,
    url: target.redactedUrl,
    etag: response.headers.get("etag") ?? undefined,
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
  };
}

export function backupObjectKey(config, filePath) {
  return `${config.prefix}${path.basename(filePath)}`;
}

async function signedS3Fetch(config, { method, objectKey, body, contentType, now = new Date() }) {
  if (!config.ready) throw new Error(`Backup storage is not configured: ${config.missing.join(", ")}`);

  const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const target = buildS3Target(config, objectKey);
  const headers = {
    host: target.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  if (contentType) headers["content-type"] = contentType;
  if (config.sessionToken) headers["x-amz-security-token"] = config.sessionToken;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((key) => `${key}:${String(headers[key]).trim()}\n`).join("");
  const canonicalRequest = [
    method,
    target.canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmacHex(getSigningKey(config.secretAccessKey, dateStamp, config.region, "s3"), stringToSign);

  return fetch(target.url, {
    method,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body || undefined,
  });
}

function buildS3Target(config, objectKey) {
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");

  if (config.endpoint) {
    const base = new URL(config.endpoint);
    const bucketSegment = encodeURIComponent(config.bucket);
    const canonicalUri = `/${bucketSegment}/${encodedKey}`;
    const url = new URL(`${base.pathname.replace(/\/$/, "")}${canonicalUri}`, `${base.protocol}//${base.host}`);
    return {
      url: url.toString(),
      redactedUrl: url.toString(),
      host: url.host,
      canonicalUri,
    };
  }

  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const canonicalUri = `/${encodedKey}`;
  const url = `https://${host}${canonicalUri}`;
  return { url, redactedUrl: url, host, canonicalUri };
}

function normalizePrefix(value) {
  const cleaned = value.trim().replace(/^\/+/, "");
  return cleaned && !cleaned.endsWith("/") ? `${cleaned}/` : cleaned;
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const dateRegionKey = hmac(dateKey, region);
  const dateRegionServiceKey = hmac(dateRegionKey, service);
  return hmac(dateRegionServiceKey, "aws4_request");
}