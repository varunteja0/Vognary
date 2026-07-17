alter table action_authorizations
  add column if not exists authorization_text text;

alter table action_authorizations
  drop constraint if exists action_authorizations_text_length_check;

alter table action_authorizations
  add constraint action_authorizations_text_length_check
  check (authorization_text is null or length(btrim(authorization_text)) between 40 and 4000);

comment on column action_authorizations.authorization_text is
  'Exact customer-visible authorization accepted for this version. Null only for authorizations created before migration 0020.';
