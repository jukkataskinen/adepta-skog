-- 0010: tositteiden tunnistuksen kirjausehdotukset (DECISIONS 28.9.2026).
--
-- Tekoäly lukee vuoden tositteen ja ehdottaa yhtä tai useampaa kirjausta.
-- Ehdotus ei ole kirjaus: kirjanpitäjä tarkistaa rivit kirjanpidon taulukossa,
-- ja ne tallentuvat sk_transactions-tauluun vasta taulukon tallennuksessa.
-- Silloin tosite liitetään syntyneeseen kirjaukseen ja ehdotus merkitään
-- hyväksytyksi. Hylätty ehdotus jää talteen tilalla dismissed.
--
-- Rivit ovat jsonb-taulukossa, koska ne ovat ehdotuksen kertakäyttöinen sisältö:
-- niitä ei haeta eikä lasketa kannassa, ja ohjelma tarkistaa ne luettaessa
-- (src/lib/ai/receipts/schema.ts). Tekoälyn raakavastausta ei tallenneta.

create table sk_receipt_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  -- Tositteen poisto poistaa myös sen ehdotukset.
  document_id uuid not null references sk_documents(id) on delete cascade,
  tax_year smallint not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 60),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  -- Tunnistuksen tekijä: malli tai 'mock' (testitila).
  model text not null check (length(model) <= 100),
  created_by uuid references sk_users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references sk_users(id),
  decided_at timestamptz
);
create index sk_receipt_suggestions_client_year on sk_receipt_suggestions (client_id, tax_year) where status = 'pending';
-- Tositteella on kerrallaan yksi odottava ehdotus; uusi tunnistus hylkää edellisen.
create unique index sk_receipt_suggestions_one_pending on sk_receipt_suggestions (document_id) where status = 'pending';

-- Saman organisaation ja saman asiakkaan tarkistukset.
create trigger sk_receipt_suggestions_same_org before insert or update on sk_receipt_suggestions
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_receipt_suggestions_same_client before insert or update on sk_receipt_suggestions
  for each row execute function sk_check_same_client('sk_documents', 'document_id');

-- Suljetun vuoden lukitus kuten kirjauksilla: suljetulle vuodelle ei tunnisteta
-- eikä ehdotusta voi hyväksyä tai hylätä.
create trigger sk_receipt_suggestions_year_open before insert or update or delete on sk_receipt_suggestions
  for each row execute function sk_check_year_open('direct');

-- RLS: sama näkyvyys kuin asiakkaalla.
alter table sk_receipt_suggestions enable row level security;
create policy receipt_suggestions_all on sk_receipt_suggestions for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));

-- 0003 poisti anon-oikeudet vain silloin olemassa olleilta tauluilta.
revoke all on sk_receipt_suggestions from anon;
grant select, insert, update, delete on sk_receipt_suggestions to authenticated;
grant all on sk_receipt_suggestions to service_role;
