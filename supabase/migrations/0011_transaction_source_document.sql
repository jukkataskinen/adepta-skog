-- 0011: kirjauksen lähdetosite ja sivut (DECISIONS 28.9.2026, kokoomatiedosto).
--
-- Yksi skannattu tiedosto voi sisältää monta tositetta (esimerkiksi puukaupan
-- vuosi-ilmoituksen ja muutaman laskun). Sellainen tiedosto jää vuoden
-- tositteeksi (sk_documents.transaction_id on null), koska se ei kuulu yhteen
-- kirjaukseen. Kirjaus viittaa siihen tällä sarakkeella, ja source_pages
-- kertoo sivut, joilla kirjauksen tiedot ovat (1-pohjaisina).
--
-- Tositteen poisto ei poista kirjausta: viittaus tyhjenee. Ohjelma estää
-- kuitenkin sellaisen vuoden tositteen poiston, johon kirjaus viittaa.

alter table sk_transactions
  add column source_document_id uuid references sk_documents(id) on delete set null,
  add column source_pages smallint[]
    check (source_pages is null or (cardinality(source_pages) between 1 and 50 and 0 < all (source_pages)));

create index sk_transactions_source_document on sk_transactions (source_document_id) where source_document_id is not null;

-- Viitattu tosite on saman asiakkaan (ja siten saman organisaation) tosite.
create trigger sk_transactions_same_client_source before insert or update on sk_transactions
  for each row execute function sk_check_same_client('sk_documents', 'source_document_id');
