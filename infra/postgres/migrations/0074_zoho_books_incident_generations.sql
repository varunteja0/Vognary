drop index zoho_books_open_incident;
create unique index zoho_books_open_incident on zoho_books_incidents(connection_id,generation) where resumed_at is null;
