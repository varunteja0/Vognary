# PostgreSQL migrations

Add forward-only SQL migrations in this directory using the pattern `0002_short_description.sql`.

`npm run db:apply-schema` creates a `schema_migrations` ledger, applies `infra/postgres/schema.sql` as `0001_initial_schema` for fresh databases, baselines existing databases that already have the initial schema, and then applies pending migration files in sorted order.