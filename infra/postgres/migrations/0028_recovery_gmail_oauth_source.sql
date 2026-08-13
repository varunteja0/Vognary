-- Reserve GMAIL_OAUTH as a Recovery source type. Capture stays fail-closed until
-- restricted-scope verification, CASA, and a Recovery-native materializer exist.
-- Do not revive the retired connector adapter path.

alter table recovery_submissions
  drop constraint if exists recovery_submissions_source_type_check;
alter table recovery_submissions
  add constraint recovery_submissions_source_type_check
  check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL', 'GMAIL_OAUTH'));

alter table recovery_sources
  drop constraint if exists recovery_sources_source_type_check;
alter table recovery_sources
  add constraint recovery_sources_source_type_check
  check (source_type in ('RECEIPT_PASTE', 'CSV_IMPORT', 'FORWARDED_EMAIL', 'GMAIL_OAUTH'));
