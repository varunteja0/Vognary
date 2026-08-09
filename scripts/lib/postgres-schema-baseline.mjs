const requiredColumnSpecs = {
  alerts: [["id", "uuid", true], ["workspace_id", "uuid", true], ["recurring_item_id", "uuid", false], ["alert_type", "text", true], ["scheduled_for", "timestamp with time zone", true], ["sent_at", "timestamp with time zone", false], ["status", "text", true], ["created_at", "timestamp with time zone", true]],
  audit_log: [["id", "uuid", true], ["workspace_id", "uuid", false], ["user_id", "uuid", false], ["action", "text", true], ["entity_type", "text", true], ["entity_id", "uuid", false], ["metadata", "jsonb", true], ["created_at", "timestamp with time zone", true]],
  audit_reports: [["id", "uuid", true], ["workspace_id", "uuid", true], ["title", "text", true], ["summary", "jsonb", true], ["report_json", "jsonb", true], ["exported_at", "timestamp with time zone", false], ["created_at", "timestamp with time zone", true]],
  auth_magic_links: [["id", "uuid", true], ["token_hash", "text", true], ["email", "text", true], ["display_name", "text", false], ["workspace_name", "text", false], ["redirect_path", "text", true], ["expires_at", "timestamp with time zone", true], ["created_at", "timestamp with time zone", true]],
  connected_accounts: [["id", "uuid", true], ["workspace_id", "uuid", true], ["source_id", "uuid", false], ["connector_id", "text", true], ["auth_type", "connector_auth_type", true], ["provider_account_id", "text", false], ["display_name", "text", true], ["scopes", "text[]", true], ["status", "text", true], ["consent_expires_at", "timestamp with time zone", false], ["last_synced_at", "timestamp with time zone", false], ["last_error", "text", false], ["metadata", "jsonb", true], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]],
  connector_evidence: [["id", "uuid", true], ["workspace_id", "uuid", true], ["connected_account_id", "uuid", false], ["sync_run_id", "uuid", false], ["source_id", "uuid", false], ["recurring_item_id", "uuid", false], ["connector_id", "text", true], ["provider", "text", true], ["evidence_type", "text", true], ["external_id", "text", false], ["observed_at", "timestamp with time zone", true], ["merchant_raw", "text", false], ["amount", "numeric(14,2)", false], ["currency", "character(3)", false], ["cadence_hint", "text", false], ["next_debit_hint", "date", false], ["confidence_score", "integer", true], ["payload_hash", "text", true], ["payload", "jsonb", true], ["created_at", "timestamp with time zone", true]],
  connector_sync_jobs: [["id", "uuid", true], ["workspace_id", "uuid", true], ["connected_account_id", "uuid", false], ["connector_id", "text", true], ["job_type", "text", true], ["status", "sync_job_status", true], ["schedule_cron", "text", false], ["priority", "integer", true], ["cursor_state", "jsonb", true], ["next_run_at", "timestamp with time zone", false], ["locked_at", "timestamp with time zone", false], ["locked_by", "text", false], ["last_error", "text", false], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]],
  connector_sync_runs: [["id", "uuid", true], ["sync_job_id", "uuid", false], ["workspace_id", "uuid", true], ["connected_account_id", "uuid", false], ["connector_id", "text", true], ["status", "sync_job_status", true], ["started_at", "timestamp with time zone", true], ["finished_at", "timestamp with time zone", false], ["records_seen", "integer", true], ["records_written", "integer", true], ["evidence_written", "integer", true], ["next_cursor_state", "jsonb", true], ["error_code", "text", false], ["error_message", "text", false]],
  connector_token_refs: [["id", "uuid", true], ["connected_account_id", "uuid", true], ["token_kind", "text", true], ["secret_ref", "text", true], ["encrypted_payload", "jsonb", true], ["key_fingerprint", "text", false], ["scopes", "text[]", true], ["expires_at", "timestamp with time zone", false], ["status", "token_status", true], ["last_rotated_at", "timestamp with time zone", false], ["metadata", "jsonb", true], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]],
  connector_webhook_events: [["id", "uuid", true], ["workspace_id", "uuid", false], ["connected_account_id", "uuid", false], ["connector_id", "text", true], ["provider_event_id", "text", false], ["event_type", "text", true], ["signature_valid", "boolean", true], ["status", "webhook_event_status", true], ["payload_hash", "text", true], ["payload", "jsonb", true], ["received_at", "timestamp with time zone", true], ["processed_at", "timestamp with time zone", false], ["error_message", "text", false]],
  data_sources: [["id", "uuid", true], ["workspace_id", "uuid", true], ["kind", "source_kind", true], ["provider", "text", false], ["display_name", "text", true], ["consent_scope", "text", false], ["status", "text", true], ["last_synced_at", "timestamp with time zone", false], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]],
  evidence_links: [["id", "uuid", true], ["recurring_item_id", "uuid", true], ["transaction_id", "uuid", false], ["source_id", "uuid", false], ["evidence_type", "text", true], ["evidence_text", "text", true], ["evidence_date", "date", false], ["amount", "numeric(14,2)", false], ["created_at", "timestamp with time zone", true]],
  private_audit_leads: [["id", "uuid", true], ["source", "text", true], ["name", "text", true], ["email", "text", true], ["contact", "text", false], ["persona", "text", true], ["spend_guess", "text", false], ["payment_types", "text[]", true], ["source_types", "text[]", true], ["biggest_concern", "text", false], ["message", "text", false], ["score", "integer", true], ["created_at", "timestamp with time zone", true]],
  recommendations: [["id", "uuid", true], ["recurring_item_id", "uuid", true], ["recommendation_type", "recurring_status", true], ["reason", "text", true], ["estimated_monthly_savings", "numeric(14,2)", true], ["confidence_score", "integer", true], ["accepted_at", "timestamp with time zone", false], ["dismissed_at", "timestamp with time zone", false], ["created_at", "timestamp with time zone", true]],
  recurring_items: [["id", "uuid", true], ["workspace_id", "uuid", true], ["merchant", "text", true], ["normalized_merchant", "text", true], ["category", "text", true], ["frequency", "text", true], ["amount_min", "numeric(14,2)", true], ["amount_max", "numeric(14,2)", true], ["average_amount", "numeric(14,2)", true], ["monthly_cost", "numeric(14,2)", true], ["annual_cost", "numeric(14,2)", true], ["last_charge_date", "date", false], ["next_expected_date", "date", false], ["confidence_score", "integer", true], ["status", "recurring_status", true], ["recommendation_reason", "text", false], ["risk_tags", "text[]", true], ["first_detected_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]],
  transactions: [["id", "uuid", true], ["workspace_id", "uuid", true], ["source_id", "uuid", false], ["uploaded_file_id", "uuid", false], ["transaction_date", "date", true], ["description", "text", true], ["normalized_merchant", "text", true], ["category", "text", true], ["amount", "numeric(14,2)", true], ["currency", "character(3)", true], ["direction", "text", true], ["external_reference", "text", false], ["raw_row", "jsonb", true], ["created_at", "timestamp with time zone", true]],
  uploaded_files: [["id", "uuid", true], ["workspace_id", "uuid", true], ["source_id", "uuid", false], ["file_name", "text", true], ["mime_type", "text", true], ["byte_size", "bigint", true], ["storage_key", "text", true], ["sha256", "text", true], ["encrypted", "boolean", true], ["parsed_at", "timestamp with time zone", false], ["deleted_at", "timestamp with time zone", false], ["created_at", "timestamp with time zone", true]],
  usage_observations: [["id", "uuid", true], ["workspace_id", "uuid", true], ["connected_account_id", "uuid", false], ["recurring_item_id", "uuid", false], ["connector_id", "text", true], ["provider", "text", true], ["metric_name", "text", true], ["metric_value", "numeric(18,6)", true], ["metric_unit", "text", true], ["window_start", "timestamp with time zone", true], ["window_end", "timestamp with time zone", true], ["payload_hash", "text", false], ["created_at", "timestamp with time zone", true]],
  users: [["id", "uuid", true], ["email", "text", true], ["display_name", "text", false], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true], ["deleted_at", "timestamp with time zone", false]],
  waitlist_leads: [["id", "uuid", true], ["source", "text", true], ["email", "text", true], ["name", "text", false], ["segment", "text", false], ["message", "text", false], ["created_at", "timestamp with time zone", true]],
  workspace_members: [["workspace_id", "uuid", true], ["user_id", "uuid", true], ["role", "text", true], ["created_at", "timestamp with time zone", true]],
  workspaces: [["id", "uuid", true], ["owner_user_id", "uuid", true], ["name", "text", true], ["plan", "text", true], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]],
};

const requiredEnums = {
  connector_auth_type: ["oauth", "api-key", "iam-role", "partner-api", "manual", "file-fallback"],
  recurring_status: ["keep", "watch", "downgrade", "cancel", "investigate", "unknown"],
  source_kind: ["csv_upload", "manual_entry", "gmail_receipt", "pdf_statement", "account_aggregator", "cloud_connector", "app_store", "upi_mandate", "card_mandate"],
  sync_job_status: ["queued", "running", "succeeded", "failed", "paused", "blocked"],
  token_status: ["active", "expired", "revoked", "rotation_required"],
  webhook_event_status: ["received", "verified", "processed", "failed", "ignored"],
};

const requiredKeyConstraints = [
  "alerts|p|PRIMARY KEY (id)", "audit_log|p|PRIMARY KEY (id)", "audit_reports|p|PRIMARY KEY (id)",
  "auth_magic_links|p|PRIMARY KEY (id)", "auth_magic_links|u|UNIQUE (token_hash)",
  "connected_accounts|p|PRIMARY KEY (id)", "connected_accounts|u|UNIQUE NULLS NOT DISTINCT (workspace_id, connector_id, provider_account_id)",
  "connector_evidence|p|PRIMARY KEY (id)", "connector_sync_jobs|p|PRIMARY KEY (id)", "connector_sync_runs|p|PRIMARY KEY (id)",
  "connector_token_refs|p|PRIMARY KEY (id)", "connector_token_refs|u|UNIQUE (connected_account_id, token_kind)",
  "connector_webhook_events|p|PRIMARY KEY (id)", "data_sources|p|PRIMARY KEY (id)", "evidence_links|p|PRIMARY KEY (id)",
  "private_audit_leads|p|PRIMARY KEY (id)", "recommendations|p|PRIMARY KEY (id)", "recurring_items|p|PRIMARY KEY (id)",
  "transactions|p|PRIMARY KEY (id)", "uploaded_files|p|PRIMARY KEY (id)", "usage_observations|p|PRIMARY KEY (id)",
  "users|p|PRIMARY KEY (id)", "users|u|UNIQUE (email)", "waitlist_leads|p|PRIMARY KEY (id)",
  "workspace_members|p|PRIMARY KEY (workspace_id, user_id)", "workspaces|p|PRIMARY KEY (id)",
  "alerts|f|FOREIGN KEY (recurring_item_id) REFERENCES recurring_items(id) ON DELETE CASCADE",
  "alerts|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "audit_log|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL",
  "audit_log|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL",
  "audit_reports|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "connected_accounts|f|FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE SET NULL",
  "connected_accounts|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "connector_evidence|f|FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE SET NULL",
  "connector_evidence|f|FOREIGN KEY (recurring_item_id) REFERENCES recurring_items(id) ON DELETE SET NULL",
  "connector_evidence|f|FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE SET NULL",
  "connector_evidence|f|FOREIGN KEY (sync_run_id) REFERENCES connector_sync_runs(id) ON DELETE SET NULL",
  "connector_evidence|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "connector_sync_jobs|f|FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE",
  "connector_sync_jobs|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "connector_sync_runs|f|FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE SET NULL",
  "connector_sync_runs|f|FOREIGN KEY (sync_job_id) REFERENCES connector_sync_jobs(id) ON DELETE SET NULL",
  "connector_sync_runs|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "connector_token_refs|f|FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE",
  "connector_webhook_events|f|FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE SET NULL",
  "connector_webhook_events|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "data_sources|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "evidence_links|f|FOREIGN KEY (recurring_item_id) REFERENCES recurring_items(id) ON DELETE CASCADE",
  "evidence_links|f|FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE SET NULL",
  "evidence_links|f|FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL",
  "recommendations|f|FOREIGN KEY (recurring_item_id) REFERENCES recurring_items(id) ON DELETE CASCADE",
  "recurring_items|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "transactions|f|FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE SET NULL",
  "transactions|f|FOREIGN KEY (uploaded_file_id) REFERENCES uploaded_files(id) ON DELETE SET NULL",
  "transactions|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "uploaded_files|f|FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE SET NULL",
  "uploaded_files|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "usage_observations|f|FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE SET NULL",
  "usage_observations|f|FOREIGN KEY (recurring_item_id) REFERENCES recurring_items(id) ON DELETE SET NULL",
  "usage_observations|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "workspace_members|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
  "workspace_members|f|FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE",
  "workspaces|f|FOREIGN KEY (owner_user_id) REFERENCES users(id)",
];

const requiredCheckDefinitions = {
  connected_accounts: [
    "CHECK (status = ANY (ARRAY['active'::text, 'needs_reauth'::text, 'blocked'::text, 'revoked'::text, 'manual'::text]))",
    "CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'needs_reauth'::text, 'blocked'::text, 'revoked'::text, 'manual'::text]))",
  ],
  connector_evidence: ["CHECK (confidence_score >= 0 AND confidence_score <= 100)"],
  connector_sync_jobs: ["CHECK (job_type = ANY (ARRAY['initial_sync'::text, 'incremental_sync'::text, 'backfill'::text, 'webhook_replay'::text, 'manual_refresh'::text]))"],
  connector_token_refs: ["CHECK (token_kind = ANY (ARRAY['access'::text, 'refresh'::text, 'api_key'::text, 'iam_role'::text, 'partner_secret'::text]))"],
  recommendations: ["CHECK (confidence_score >= 0 AND confidence_score <= 100)"],
  recurring_items: ["CHECK (confidence_score >= 0 AND confidence_score <= 100)"],
  transactions: ["CHECK (direction = ANY (ARRAY['debit'::text, 'credit'::text, 'unknown'::text]))"],
  workspace_members: ["CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text]))"],
};

export const initialSchemaRelations = Object.freeze(Object.keys(requiredColumnSpecs));
export const initialSchemaTypes = Object.freeze(Object.keys(requiredEnums));

export async function assertInitialSchemaBaseline(client, schemaName = "public") {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) throw new Error("PostgreSQL baseline schema name is invalid.");
  const relations = await client.query(
    `select relation.relname as relation_name,
            attribute.attname as column_name,
            case when type.typtype = 'e' then type.typname else format_type(attribute.atttypid, attribute.atttypmod) end as data_type,
            attribute.attnotnull as not_null
     from pg_class relation
     join pg_namespace namespace on namespace.oid = relation.relnamespace
     join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
     join pg_type type on type.oid = attribute.atttypid
     where namespace.nspname = $1
       and relation.relkind in ('r', 'p')
       and relation.relname = any($2::text[])`,
    [schemaName, initialSchemaRelations],
  );
  const enums = await client.query(
    `select type.typname as type_name, array_agg(enum.enumlabel::text order by enum.enumsortorder) as labels
     from pg_type type
     join pg_namespace namespace on namespace.oid = type.typnamespace
     join pg_enum enum on enum.enumtypid = type.oid
     where namespace.nspname = $1 and type.typname = any($2::text[])
     group by type.typname`,
    [schemaName, initialSchemaTypes],
  );
  const constraints = await client.query(
    `select relation.relname as relation_name, constraint_record.contype::text as constraint_type,
            pg_get_constraintdef(constraint_record.oid, true) as definition
     from pg_constraint constraint_record
     join pg_class relation on relation.oid = constraint_record.conrelid
     join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = $1 and constraint_record.contype in ('p', 'u', 'f', 'c')`,
    [schemaName],
  );

  const presentRelations = new Set(relations.rows.map((row) => row.relation_name));
  const columns = new Map(relations.rows.map((row) => [`${row.relation_name}.${row.column_name}`, row]));
  const enumLabels = new Map(enums.rows.map((row) => [row.type_name, row.labels]));
  const constraintSignatures = new Set(constraints.rows
    .filter((row) => row.constraint_type === "p" || row.constraint_type === "u" || row.constraint_type === "f")
    .map((row) => `${row.relation_name}|${row.constraint_type}|${normalizeConstraint(row.definition, schemaName)}`));
  const checksByRelation = new Map();
  for (const row of constraints.rows.filter((entry) => entry.constraint_type === "c")) {
    const current = checksByRelation.get(row.relation_name) ?? new Set();
    current.add(normalizeConstraint(row.definition, schemaName));
    checksByRelation.set(row.relation_name, current);
  }

  const invalid = [];
  for (const [relationName, specs] of Object.entries(requiredColumnSpecs)) {
    if (!presentRelations.has(relationName)) invalid.push(`relation:${relationName}`);
    for (const [columnName, dataType, notNull] of specs) {
      const actual = columns.get(`${relationName}.${columnName}`);
      if (!actual) invalid.push(`column:${relationName}.${columnName}:missing`);
      else {
        if (actual.data_type !== dataType) invalid.push(`column:${relationName}.${columnName}:type:${actual.data_type}`);
        if (actual.not_null !== notNull) invalid.push(`column:${relationName}.${columnName}:${notNull ? "not-null" : "nullable"}`);
      }
    }
  }
  for (const [typeName, labels] of Object.entries(requiredEnums)) {
    if (JSON.stringify(enumLabels.get(typeName) ?? []) !== JSON.stringify(labels)) invalid.push(`enum:${typeName}`);
  }
  for (const signature of requiredKeyConstraints) {
    if (!constraintSignatures.has(signature)) invalid.push(`constraint:${signature}`);
  }
  for (const [relationName, allowedDefinitions] of Object.entries(requiredCheckDefinitions)) {
    const definitions = checksByRelation.get(relationName) ?? new Set();
    if (!allowedDefinitions.some((definition) => definitions.has(definition))) invalid.push(`check:${relationName}`);
  }

  if (invalid.length) {
    throw new Error(`PostgreSQL initial schema baseline is incomplete or incompatible; ${[...new Set(invalid)].sort().join(", ")}. Refusing to record 0001_initial_schema.`);
  }
}

function normalizeConstraint(definition, schemaName) {
  return definition.replaceAll(`${schemaName}.`, "").replaceAll(`"${schemaName}".`, "");
}
