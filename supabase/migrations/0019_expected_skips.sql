-- 0019: odotettujen kirjausten ohitukset (DECISIONS 5.10.2026).
--
-- Odotetut kirjaukset lasketaan aiempien vuosien kirjauksista eikä niitä
-- tallenneta (src/lib/ledger/expected.ts). Tallennetaan vain kirjanpitäjän
-- merkintä "ei tule tänä vuonna". expected_key on tiiviste toiminnosta,
-- luokasta ja selitteen sanoista, joten taulussa ei ole selitteitä.
-- Suljetun vuoden ohituksia ei voi muuttaa (sama lukitus kuin kirjauksilla).

create table sk_expected_skips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null check (tax_year between 2000 and 2100),
  expected_key text not null check (expected_key ~ '^[0-9a-f]{8}$'),
  created_by uuid references sk_users(id),
  created_at timestamptz not null default now(),
  unique (client_id, tax_year, expected_key)
);

create trigger sk_expected_skips_same_org before insert or update on sk_expected_skips
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_expected_skips_year_open before insert or update or delete on sk_expected_skips
  for each row execute function sk_check_year_open('direct');

alter table sk_expected_skips enable row level security;
create policy expected_skips_all on sk_expected_skips for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));

revoke all on sk_expected_skips from anon;
grant select, insert, delete on sk_expected_skips to authenticated;
grant all on sk_expected_skips to service_role;
