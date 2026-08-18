import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  downloadBackupObject,
  getBackupStorageConfig,
  storedBackupObjectKeys,
} from "../scripts/lib/backup-storage.mjs";

const r2Env = {
  R2_BUCKET: "vognary-postgres-backups",
  BACKUP_STORAGE_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  BACKUP_STORAGE_ACCESS_KEY_ID: "AKIAEXAMPLE",
  BACKUP_STORAGE_SECRET_ACCESS_KEY: "secret-example",
};

test("R2 backup storage is ready from bucket, endpoint, and access keys", () => {
  const config = getBackupStorageConfig(r2Env);
  assert.equal(config.ready, true);
  assert.equal(config.provider, "r2");
  assert.equal(config.region, "auto");
  assert.deepEqual(config.missing, []);
});

test("stored backup object keys refuse a local-only manifest", () => {
  assert.throws(
    () => storedBackupObjectKeys({
      storage: { status: "local-encrypted-dump-only", objects: undefined },
    }),
    /uploaded durable-storage objects/,
  );
});

test("stored backup object keys require both dump and manifest object keys", () => {
  const keys = storedBackupObjectKeys({
    storage: {
      status: "uploaded",
      objects: {
        encryptedDump: "vognary-postgres/example.dump.enc",
        manifest: "vognary-postgres/example.manifest.json",
      },
    },
  });
  assert.equal(keys.encryptedDump, "vognary-postgres/example.dump.enc");
  assert.equal(keys.manifest, "vognary-postgres/example.manifest.json");
});

test("downloadBackupObject GETs the stored object and writes those bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vognary-backup-get-"));
  const filePath = path.join(directory, "stored.dump.enc");
  const originalFetch = globalThis.fetch;
  const requests = [];
  const payload = Buffer.from("durable-object-bytes");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ method: init?.method, url });
    assert.equal(init?.method, "GET");
    assert.match(url, /vognary-postgres-backups\/vognary-postgres\/example.dump.enc/);
    return new Response(payload, {
      status: 200,
      headers: { etag: '"abc123"' },
    });
  };

  try {
    const result = await downloadBackupObject(getBackupStorageConfig(r2Env), {
      objectKey: "vognary-postgres/example.dump.enc",
      filePath,
    });
    assert.equal(result.etag, '"abc123"');
    assert.equal(result.bytes, payload.length);
    assert.equal(await readFile(filePath, "utf8"), payload.toString("utf8"));
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloadBackupObject fails closed when the stored object is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not found", { status: 404 });

  try {
    await assert.rejects(
      downloadBackupObject(getBackupStorageConfig(r2Env), {
        objectKey: "vognary-postgres/missing.dump.enc",
        filePath: path.join(os.tmpdir(), "missing.dump.enc"),
      }),
      /HTTP 404/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
