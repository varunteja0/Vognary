alter table zoho_books_connections add column watermark_at timestamptz;

alter table zoho_books_snapshots add constraint zoho_books_snapshot_required_fields check (
  jsonb_typeof(bill) = 'object'
  and bill ?& array['version','billId','vendorId','vendorName','billNumber','date','status','currency','totalMinor','balanceMinor','sourceTotal','sourceBalance','modifiedAt','basis']
  and jsonb_typeof(bill->'totalMinor') = 'string'
  and jsonb_typeof(bill->'balanceMinor') = 'string'
  and jsonb_typeof(bill->'sourceTotal') = 'string'
  and jsonb_typeof(bill->'sourceBalance') = 'string'
  and bill->>'currency' ~ '^[A-Z]{3}$'
  and bill->>'vendorId' ~ '^[0-9]{1,64}$'
  and bill->>'version' = '1'
);
