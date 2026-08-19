-- Thin V1 decision-context overlay.
--
-- Purpose, importance, and owner are human overlays on a commitment. They never
-- rewrite evidence, amounts, cadence, or the commitment graph. Workspace isolation
-- is the composite primary key; erasure still cascades from workspaces.

create table if not exists recovery_commitment_context (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  commitment_id uuid not null,
  purpose text check (
    purpose is null or purpose in (
      'CODING', 'RESEARCH', 'WRITING', 'DESIGN', 'INFRASTRUCTURE', 'CRM',
      'MARKETING', 'COMMUNICATION', 'ANALYTICS', 'OPERATIONS', 'OTHER'
    )
  ),
  importance text check (
    importance is null or importance in (
      'PRODUCTION_BREAKS', 'TEAM_WORKFLOW_BREAKS', 'CUSTOMER_FACING_BREAKS',
      'PRODUCTIVITY_DECREASES', 'NOTHING_IMPORTANT', 'NOT_SURE'
    )
  ),
  owner text check (
    owner is null or owner in (
      'FOUNDER', 'ENGINEERING', 'SALES', 'MARKETING', 'OPERATIONS', 'OTHER'
    )
  ),
  updated_by_user_id uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, commitment_id),
  foreign key (workspace_id, commitment_id)
    references recovery_commitments(workspace_id, id) on delete cascade,
  check (purpose is not null or importance is not null or owner is not null)
);
