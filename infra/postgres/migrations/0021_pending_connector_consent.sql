alter table connected_accounts
  drop constraint if exists connected_accounts_status_check;

alter table connected_accounts
  add constraint connected_accounts_status_check
  check (status in ('pending', 'active', 'needs_reauth', 'blocked', 'revoked', 'manual'));

comment on column connected_accounts.status is
  'pending means provider consent was created but has not yet been approved; only active accounts may be presented as connected evidence sources.';
