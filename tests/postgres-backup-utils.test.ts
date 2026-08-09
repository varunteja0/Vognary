import assert from "node:assert/strict";
import test from "node:test";

import { postgresConnectionEnv, postgresDockerEnvironment } from "../scripts/lib/postgres-backup-utils.mjs";

test("PostgreSQL URLs become explicit libpq connection environment", () => {
  assert.deepEqual(
    postgresConnectionEnv("postgresql://backup%20user:p%40ss@db.example:5544/vognary%20prod"),
    {
      PGHOST: "db.example",
      PGPORT: "5544",
      PGUSER: "backup user",
      PGPASSWORD: "p@ss",
      PGDATABASE: "vognary prod",
    },
  );
});

test("PostgreSQL URL parsing rejects non-database targets", () => {
  assert.throws(() => postgresConnectionEnv("https://db.example/vognary"), /invalid/);
  assert.throws(() => postgresConnectionEnv("postgresql://db.example"), /name a database/);
});

test("Docker PostgreSQL clients translate loopback without changing the host URL", () => {
  const environment = postgresConnectionEnv("postgresql://vognary:secret@127.0.0.1:55432/vognary");
  const dockerEnvironment = postgresDockerEnvironment(environment);
  assert.equal(environment.PGHOST, "127.0.0.1");
  assert.equal(dockerEnvironment.PGHOST, "host.docker.internal");
  assert.equal(dockerEnvironment.PGDATABASE, "vognary");
});