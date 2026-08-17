-- Canonical merchant identity.
--
-- Commitment detection is unchanged. This adds a canonical merchant that a
-- commitment may point at, plus the signals and the reversible decision that
-- put it there. Two rules are enforced by the database rather than by callers:
-- a link may never cross currency, and a rejected merge is recorded so it is
-- never proposed automatically again.
create table if not exists recovery_merchants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, currency, display_name)
);

create index if not exists recovery_merchants_workspace_idx
  on recovery_merchants(workspace_id, currency);

-- Every signal is anchored to the persisted evidence row it was read from, so a
-- merge can always show its working.
create table if not exists recovery_merchant_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  merchant_id uuid not null,
  evidence_id uuid not null,
  signal_kind text not null check (
    signal_kind in (
      'EXPLICIT_MERCHANT_ID', 'GSTIN', 'BILLING_DOMAIN', 'SENDER_DOMAIN',
      'PROCESSOR_DESCRIPTOR', 'ACCOUNT_IDENTIFIER', 'INVOICE_IDENTIFIER', 'FUZZY_ALIAS'
    )
  ),
  -- Canonical form produced by the resolver, never the raw receipt text.
  signal_key text not null check (length(btrim(signal_key)) between 1 and 253),
  observed_at timestamptz not null default now(),
  foreign key (workspace_id, merchant_id)
    references recovery_merchants(workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id)
    references recovery_evidence(workspace_id, id) on delete cascade,
  unique (workspace_id, merchant_id, signal_kind, signal_key, evidence_id)
);

create index if not exists recovery_merchant_signals_lookup_idx
  on recovery_merchant_signals(workspace_id, signal_kind, signal_key);

create table if not exists recovery_merchant_links (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  merchant_id uuid not null,
  decision text not null check (decision in ('AUTO_MERGE', 'USER_CONFIRMED')),
  score smallint not null check (score between 0 and 100),
  strongest_signal_kind text not null,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  cited_evidence_ids uuid[] not null default '{}' check (cardinality(cited_evidence_ids) >= 1),
  linked_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by_user_id uuid references users(id) on delete set null,
  primary key (workspace_id, commitment_id, merchant_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, merchant_id)
    references recovery_merchants(workspace_id, id) on delete cascade,
  constraint recovery_merchant_links_reversal_check
    check (reversed_at is not null or reversed_by_user_id is null)
);

-- A commitment belongs to at most one canonical merchant at a time.
create unique index if not exists recovery_merchant_links_active_idx
  on recovery_merchant_links(workspace_id, commitment_id)
  where reversed_at is null;

-- A merge the customer reversed. Automatic resolution must read this and skip.
create table if not exists recovery_merchant_merge_rejections (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  merchant_id uuid not null,
  rejected_at timestamptz not null default now(),
  rejected_by_user_id uuid references users(id) on delete set null,
  primary key (workspace_id, commitment_id, merchant_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, merchant_id)
    references recovery_merchants(workspace_id, id) on delete cascade
);

-- Money in different currencies is never the same commitment, whatever the
-- identity signals say. Enforced here so no caller can bypass it.
create or replace function recovery_merchant_link_currency_guard()
returns trigger
language plpgsql
as $$
declare
  merchant_currency char(3);
  commitment_currency char(3);
begin
  select currency into merchant_currency
    from recovery_merchants
    where workspace_id = new.workspace_id and id = new.merchant_id;
  -- Currency is not a correctable fact, so the base column is the commitment currency.
  select base_currency into commitment_currency
    from recovery_commitments
    where workspace_id = new.workspace_id and id = new.commitment_id;
  if merchant_currency is distinct from commitment_currency then
    raise exception 'Recovery merchant links may not cross currency.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists recovery_merchant_links_currency_trigger on recovery_merchant_links;
create trigger recovery_merchant_links_currency_trigger
  before insert or update on recovery_merchant_links
  for each row execute function recovery_merchant_link_currency_guard();

-- Identity signals are derived facts about immutable evidence, so they are
-- append-only. Whole-workspace privacy erasure still cascades.
create or replace function reject_recovery_merchant_signal_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from workspaces where id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'Recovery merchant signals are append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists recovery_merchant_signals_append_only_trigger on recovery_merchant_signals;
create trigger recovery_merchant_signals_append_only_trigger
  before update or delete on recovery_merchant_signals
  for each row execute function reject_recovery_merchant_signal_mutation();
