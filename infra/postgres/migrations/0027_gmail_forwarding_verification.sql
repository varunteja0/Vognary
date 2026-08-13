-- Gmail refuses to forward anything until the user confirms the challenge it
-- sends to the receipt address. Storing the challenge lets the workspace show
-- it to its owner instead of discarding it as unreadable evidence.
alter table recovery_inbound_aliases
  add column if not exists gmail_verification_code text
    check (gmail_verification_code is null or gmail_verification_code ~ '^[0-9]{6,12}$'),
  add column if not exists gmail_verification_url text
    check (gmail_verification_url is null or gmail_verification_url like 'https://mail-settings.google.com/mail/%'),
  add column if not exists gmail_verification_received_at timestamptz;

alter table recovery_inbound_aliases
  drop constraint if exists recovery_inbound_aliases_gmail_verification_check;
alter table recovery_inbound_aliases
  add constraint recovery_inbound_aliases_gmail_verification_check
  check (
    (gmail_verification_received_at is null
      and gmail_verification_code is null
      and gmail_verification_url is null)
    or (gmail_verification_received_at is not null
      and (gmail_verification_code is not null or gmail_verification_url is not null))
  );

-- A revoked or rotated alias must not keep an actionable challenge.
update recovery_inbound_aliases
set gmail_verification_code = null,
  gmail_verification_url = null,
  gmail_verification_received_at = null
where status <> 'ACTIVE';
