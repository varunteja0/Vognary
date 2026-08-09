import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  assertInitialSchemaBaseline,
  initialSchemaRelations,
  initialSchemaTypes,
} from "../../scripts/lib/postgres-schema-baseline.mjs";
import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("a users-only database cannot be blessed as the initial schema", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const schema = temporarySchema("partial");

  try {
    await pool.query(`create schema ${schema}`);
    await pool.query(`create table ${schema}.users (id integer primary key)`);

    await assert.rejects(
      assertInitialSchemaBaseline(pool, schema),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /initial schema baseline is incomplete/i);
        assert.match(error.message, /relation:workspaces/);
        assert.match(error.message, /type:source_kind/);
        return true;
      },
    );
  } finally {
    await pool.query(`drop schema if exists ${schema} cascade`);
  }
});

test("a complete legacy initial schema is accepted for baseline recording", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const schema = temporarySchema("complete");

  try {
    await pool.query(`create schema ${schema}`);
    for (const typeName of initialSchemaTypes) {
      await pool.query(`create type ${schema}.${typeName} as enum ('test')`);
    }
    for (const relationName of initialSchemaRelations) {
      await pool.query(`create table ${schema}.${relationName} (id integer)`);
    }

    await assert.doesNotReject(assertInitialSchemaBaseline(pool, schema));
  } finally {
    await pool.query(`drop schema if exists ${schema} cascade`);
  }
});

function temporarySchema(label: string) {
  return `migration_${label}_${randomUUID().replaceAll("-", "")}`;
}