# PostgreSQL migrations

> **Operating motto: Take smart risks. Do not play safe.** Take product risk in
> bounded experiments, never by weakening forward-only migration integrity or
> recovery. Full doctrine: [`THE-LAW.md`](../../../docs/THE-LAW.md).

Add forward-only SQL migrations in this directory using the pattern `0002_short_description.sql`.

`npm run db:apply-schema` creates a `schema_migrations` ledger, applies `infra/postgres/schema.sql` as `0001_initial_schema` for fresh databases, baselines existing databases that already have the initial schema, and then applies pending migration files in sorted order.