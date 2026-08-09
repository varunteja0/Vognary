import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertInitialSchemaBaseline,
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
        assert.match(error.message, /enum:source_kind/);
        return true;
      },
    );
  } finally {
    await pool.query(`drop schema if exists ${schema} cascade`);
  }
});

test("a complete schema is accepted for baseline recording", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const schema = temporarySchema("complete");
  const client = await pool.connect();

  try {
    await createCompleteSchema(client, schema);
    await assert.doesNotReject(assertInitialSchemaBaseline(client, schema));
  } finally {
    await client.query("reset search_path");
    await client.query(`drop schema if exists ${schema} cascade`);
    client.release();
  }
});

test("baseline validation rejects wrong columns, enum labels, and key constraints", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const schema = temporarySchema("corrupt");
  const client = await pool.connect();

  try {
    await createCompleteSchema(client, schema);
    await client.query(`alter table ${schema}.users alter column email drop not null`);
    await client.query(`alter table ${schema}.users alter column email type varchar(320)`);
    await client.query(`alter table ${schema}.users drop constraint users_email_key`);
    await client.query(`alter table ${schema}.alerts drop constraint alerts_pkey`);
    await client.query(`alter table ${schema}.workspaces drop constraint workspaces_owner_user_id_fkey`);
    await client.query(`alter table ${schema}.recurring_items drop constraint recurring_items_confidence_score_check`);
    await client.query(`alter table ${schema}.recurring_items add constraint recurring_items_confidence_score_check check (confidence_score >= 0 or confidence_score <= 100)`);
    await client.query(`alter type ${schema}.source_kind rename value 'card_mandate' to 'broken_card_mandate'`);

    await assert.rejects(
      assertInitialSchemaBaseline(client, schema),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /column:users\.email:not-null/);
        assert.match(error.message, /column:users\.email:type:character varying\(320\)/);
        assert.match(error.message, /enum:source_kind/);
        assert.match(error.message, /constraint:alerts\|p\|PRIMARY KEY \(id\)/);
        assert.match(error.message, /constraint:users\|u\|UNIQUE \(email\)/);
        assert.match(error.message, /constraint:workspaces\|f\|FOREIGN KEY \(owner_user_id\) REFERENCES users\(id\)/);
        assert.match(error.message, /check:recurring_items/);
        return true;
      },
    );
  } finally {
    await client.query("reset search_path");
    await client.query(`drop schema if exists ${schema} cascade`);
    client.release();
  }
});

function temporarySchema(label: string) {
  return `migration_${label}_${randomUUID().replaceAll("-", "")}`;
}

async function createCompleteSchema(client: import("pg").PoolClient, schema: string) {
  const sql = readFileSync(new URL("../../infra/postgres/schema.sql", import.meta.url), "utf8");
  await client.query(`create schema ${schema}`);
  await client.query(`set search_path = ${schema}, public`);
  await client.query(sql);
}