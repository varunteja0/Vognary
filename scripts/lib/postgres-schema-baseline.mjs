export const initialSchemaRelations = [
  "users",
  "auth_magic_links",
  "private_audit_leads",
  "waitlist_leads",
  "workspaces",
  "workspace_members",
  "data_sources",
  "connected_accounts",
  "connector_token_refs",
  "connector_sync_jobs",
  "connector_sync_runs",
  "connector_webhook_events",
  "uploaded_files",
  "transactions",
  "recurring_items",
  "evidence_links",
  "connector_evidence",
  "usage_observations",
  "recommendations",
  "alerts",
  "audit_reports",
  "audit_log",
];

export const initialSchemaTypes = [
  "source_kind",
  "recurring_status",
  "connector_auth_type",
  "token_status",
  "sync_job_status",
  "webhook_event_status",
];

export async function assertInitialSchemaBaseline(client, schemaName = "public") {
  const relations = await client.query(
    `select relation.relname as name
     from pg_class relation
     join pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = $1
       and relation.relkind in ('r', 'p')
       and relation.relname = any($2::text[])`,
    [schemaName, initialSchemaRelations],
  );
  const types = await client.query(
    `select type.typname as name
     from pg_type type
     join pg_namespace namespace on namespace.oid = type.typnamespace
     where namespace.nspname = $1
       and type.typtype = 'e'
       and type.typname = any($2::text[])`,
    [schemaName, initialSchemaTypes],
  );

  const presentRelations = new Set(relations.rows.map((row) => row.name));
  const presentTypes = new Set(types.rows.map((row) => row.name));
  const missing = [
    ...initialSchemaRelations.filter((name) => !presentRelations.has(name)).map((name) => `relation:${name}`),
    ...initialSchemaTypes.filter((name) => !presentTypes.has(name)).map((name) => `type:${name}`),
  ].sort();

  if (missing.length) {
    throw new Error(`PostgreSQL initial schema baseline is incomplete; missing ${missing.join(", ")}. Refusing to record 0001_initial_schema.`);
  }
}
