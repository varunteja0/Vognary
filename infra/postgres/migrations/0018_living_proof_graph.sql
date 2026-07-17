-- Promote the normalized living ledger into a typed, queryable Proof Graph.
-- Existing tables remain authoritative typed nodes; proof_nodes/proof_edges are
-- the stable graph projection and ledger_events is the append-only history.

alter table workspaces
  add column if not exists workspace_type text not null default 'personal'
    check (workspace_type in ('personal', 'family', 'founder', 'team'));

create table if not exists merchant_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  normalized_name text not null check (length(btrim(normalized_name)) between 1 and 240),
  display_name text not null check (length(btrim(display_name)) between 1 and 240),
  country_code char(2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, normalized_name)
);

alter table recurring_items
  add column if not exists merchant_entity_id uuid references merchant_entities(id) on delete set null;

insert into merchant_entities (workspace_id, normalized_name, display_name)
select workspace_id, normalized_merchant, min(merchant)
from recurring_items
where length(btrim(normalized_merchant)) > 0
group by workspace_id, normalized_merchant
on conflict (workspace_id, normalized_name) do update
set display_name = excluded.display_name,
    updated_at = now();

update recurring_items item
set merchant_entity_id = merchant.id
from merchant_entities merchant
where merchant.workspace_id = item.workspace_id
  and merchant.normalized_name = item.normalized_merchant
  and item.merchant_entity_id is distinct from merchant.id;

create index if not exists recurring_items_merchant_entity_idx
  on recurring_items(workspace_id, merchant_entity_id);

create table if not exists payment_rails (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,62}$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  regulated boolean not null default false,
  created_at timestamptz not null default now()
);

insert into payment_rails (id, label, regulated) values
  ('statement', 'Bank or card statement', false),
  ('email-receipt', 'Email receipt', false),
  ('cloud-provider', 'Cloud or SaaS provider', false),
  ('account-aggregator', 'Account Aggregator', true),
  ('upi-autopay', 'UPI AutoPay', true),
  ('card-mandate', 'Card mandate', true),
  ('app-store', 'App store', false),
  ('manual-proof', 'User-confirmed evidence', false)
on conflict (id) do update
set label = excluded.label,
    regulated = excluded.regulated;

alter table data_sources
  add column if not exists rail_id text references payment_rails(id) on delete set null;

update data_sources
set rail_id = case kind::text
  when 'csv_upload' then 'statement'
  when 'pdf_statement' then 'statement'
  when 'gmail_receipt' then 'email-receipt'
  when 'cloud_connector' then 'cloud-provider'
  when 'account_aggregator' then 'account-aggregator'
  when 'upi_mandate' then 'upi-autopay'
  when 'card_mandate' then 'card-mandate'
  when 'app_store' then 'app-store'
  when 'manual_entry' then 'manual-proof'
  else null
end
where rail_id is null;

create table if not exists proof_nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('commitment', 'evidence', 'source', 'merchant', 'rail', 'action', 'saving')),
  entity_ref text not null check (length(btrim(entity_ref)) between 1 and 240),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (workspace_id, kind, entity_ref),
  unique (workspace_id, id),
  check ((status = 'retired') = (retired_at is not null))
);

create table if not exists proof_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_node_id uuid not null,
  to_node_id uuid not null,
  edge_type text not null check (edge_type in (
    'describes', 'proven_by', 'observed_in', 'paid_via', 'resolved_to',
    'authorized_by', 'produced', 'amends'
  )),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by_event_id uuid,
  foreign key (workspace_id, from_node_id) references proof_nodes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, to_node_id) references proof_nodes(workspace_id, id) on delete cascade,
  check (from_node_id <> to_node_id),
  check (valid_to is null or valid_to >= valid_from)
);

create unique index if not exists proof_edges_active_unique_idx
  on proof_edges(workspace_id, from_node_id, to_node_id, edge_type)
  where valid_to is null;
create index if not exists proof_edges_from_idx on proof_edges(workspace_id, from_node_id, edge_type) where valid_to is null;
create index if not exists proof_edges_to_idx on proof_edges(workspace_id, to_node_id, edge_type) where valid_to is null;

create table if not exists workspace_event_counters (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  next_sequence bigint not null default 1 check (next_sequence > 0),
  updated_at timestamptz not null default now()
);

create table if not exists ledger_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workspace_sequence bigint not null check (workspace_sequence > 0),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  schema_version integer not null default 1 check (schema_version > 0),
  actor_user_id uuid references users(id) on delete set null,
  entity_kind text not null check (length(btrim(entity_kind)) between 1 and 80),
  entity_ref text not null check (length(btrim(entity_ref)) between 1 and 240),
  idempotency_key text not null check (length(idempotency_key) between 16 and 160),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  payload_hash char(64) not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  previous_event_hash char(64),
  event_hash char(64) not null check (event_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now(),
  unique (workspace_id, workspace_sequence),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, event_hash),
  check (previous_event_hash is null or previous_event_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists ledger_events_workspace_occurred_idx
  on ledger_events(workspace_id, occurred_at desc);
create index if not exists ledger_events_entity_idx
  on ledger_events(workspace_id, entity_kind, entity_ref, workspace_sequence desc);

alter table proof_edges
  drop constraint if exists proof_edges_created_by_event_id_fkey;
alter table proof_edges
  add constraint proof_edges_created_by_event_id_fkey
  foreign key (created_by_event_id) references ledger_events(id) on delete set null;

create table if not exists confidence_explanations (
  recurring_item_id uuid primary key references recurring_items(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  score integer not null check (score between 0 and 99),
  proof_density numeric(6, 5) not null check (proof_density between 0 and 1),
  source_diversity numeric(6, 5) not null check (source_diversity between 0 and 1),
  freshness numeric(6, 5) not null check (freshness between 0 and 1),
  cadence_stability numeric(6, 5) not null check (cadence_stability between 0 and 1),
  model_version text not null check (length(btrim(model_version)) between 1 and 80),
  graph_revision bigint not null check (graph_revision > 0),
  explanation jsonb not null default '{}'::jsonb check (jsonb_typeof(explanation) = 'object'),
  computed_at timestamptz not null default now()
);

create index if not exists confidence_explanations_workspace_score_idx
  on confidence_explanations(workspace_id, score desc);

-- Backfill stable graph identities for the normalized ledger that already exists.
insert into proof_nodes (workspace_id, kind, entity_ref)
select workspace_id, 'commitment', id::text from recurring_items
on conflict (workspace_id, kind, entity_ref) do nothing;

insert into proof_nodes (workspace_id, kind, entity_ref)
select workspace_id, 'source', id::text from data_sources
on conflict (workspace_id, kind, entity_ref) do nothing;

insert into proof_nodes (workspace_id, kind, entity_ref)
select workspace_id, 'merchant', id::text from merchant_entities
on conflict (workspace_id, kind, entity_ref) do nothing;

insert into proof_nodes (workspace_id, kind, entity_ref)
select distinct workspace_id, 'rail', rail_id from data_sources where rail_id is not null
on conflict (workspace_id, kind, entity_ref) do nothing;

insert into proof_nodes (workspace_id, kind, entity_ref)
select item.workspace_id, 'evidence', 'evidence-link:' || evidence.id::text
from evidence_links evidence
join recurring_items item on item.id = evidence.recurring_item_id
on conflict (workspace_id, kind, entity_ref) do nothing;

insert into proof_nodes (workspace_id, kind, entity_ref)
select workspace_id, 'evidence', 'connector-evidence:' || id::text from connector_evidence
on conflict (workspace_id, kind, entity_ref) do nothing;

insert into proof_edges (workspace_id, from_node_id, to_node_id, edge_type)
select item.workspace_id, commitment.id, merchant.id, 'describes'
from recurring_items item
join proof_nodes commitment on commitment.workspace_id = item.workspace_id and commitment.kind = 'commitment' and commitment.entity_ref = item.id::text
join proof_nodes merchant on merchant.workspace_id = item.workspace_id and merchant.kind = 'merchant' and merchant.entity_ref = item.merchant_entity_id::text
where item.merchant_entity_id is not null
on conflict (workspace_id, from_node_id, to_node_id, edge_type) where valid_to is null do nothing;

insert into proof_edges (workspace_id, from_node_id, to_node_id, edge_type)
select item.workspace_id, commitment.id, evidence_node.id, 'proven_by'
from evidence_links evidence
join recurring_items item on item.id = evidence.recurring_item_id
join proof_nodes commitment on commitment.workspace_id = item.workspace_id and commitment.kind = 'commitment' and commitment.entity_ref = item.id::text
join proof_nodes evidence_node on evidence_node.workspace_id = item.workspace_id and evidence_node.kind = 'evidence' and evidence_node.entity_ref = 'evidence-link:' || evidence.id::text
on conflict (workspace_id, from_node_id, to_node_id, edge_type) where valid_to is null do nothing;

insert into proof_edges (workspace_id, from_node_id, to_node_id, edge_type)
select item.workspace_id, evidence_node.id, source_node.id, 'observed_in'
from evidence_links evidence
join recurring_items item on item.id = evidence.recurring_item_id
join proof_nodes evidence_node on evidence_node.workspace_id = item.workspace_id and evidence_node.kind = 'evidence' and evidence_node.entity_ref = 'evidence-link:' || evidence.id::text
join proof_nodes source_node on source_node.workspace_id = item.workspace_id and source_node.kind = 'source' and source_node.entity_ref = evidence.source_id::text
where evidence.source_id is not null
on conflict (workspace_id, from_node_id, to_node_id, edge_type) where valid_to is null do nothing;

insert into proof_edges (workspace_id, from_node_id, to_node_id, edge_type)
select source.workspace_id, source_node.id, rail_node.id, 'paid_via'
from data_sources source
join proof_nodes source_node on source_node.workspace_id = source.workspace_id and source_node.kind = 'source' and source_node.entity_ref = source.id::text
join proof_nodes rail_node on rail_node.workspace_id = source.workspace_id and rail_node.kind = 'rail' and rail_node.entity_ref = source.rail_id
where source.rail_id is not null
on conflict (workspace_id, from_node_id, to_node_id, edge_type) where valid_to is null do nothing;

-- Every pre-graph workspace begins with a checksummed baseline event. Later
-- mutations are appended by the application with a workspace-locked counter.
insert into workspace_event_counters (workspace_id, next_sequence)
select id, 1 from workspaces
on conflict (workspace_id) do nothing;

with baselines as (
  select workspace.id as workspace_id,
    jsonb_build_object(
      'commitments', (select count(*) from recurring_items item where item.workspace_id = workspace.id),
      'sources', (select count(*) from data_sources source where source.workspace_id = workspace.id),
      'proofNodes', (select count(*) from proof_nodes node where node.workspace_id = workspace.id),
      'proofEdges', (select count(*) from proof_edges edge where edge.workspace_id = workspace.id)
    ) as payload
  from workspaces workspace
), hashes as (
  select workspace_id, payload, encode(digest(payload::text, 'sha256'), 'hex') as payload_hash
  from baselines
)
insert into ledger_events (
  workspace_id, workspace_sequence, event_type, entity_kind, entity_ref,
  idempotency_key, payload, payload_hash, event_hash
)
select workspace_id, 1, 'graph.baseline.created', 'workspace', workspace_id::text,
  'graph-baseline-' || workspace_id::text, payload, payload_hash,
  encode(digest(workspace_id::text || ':1:graph.baseline.created:' || payload_hash, 'sha256'), 'hex')
from hashes
on conflict (workspace_id, idempotency_key) do nothing;

update workspace_event_counters counter
set next_sequence = greatest(counter.next_sequence, 2),
    updated_at = now()
where exists (select 1 from ledger_events event where event.workspace_id = counter.workspace_id);
