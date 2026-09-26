-- 0002 Tietomalli: asiakkaat, metsätilat, verovuodet, kirjaukset,
-- investoinnit, poistot, metsävähennykset ja asiakirjat.
--
-- Pääkäyttäjä näkee kaikki toimiston asiakkaat, kirjanpitäjä vain ne, joiden
-- vastuukirjanpitäjä hän on (DECISIONS 26.9.2026). Asiakkaan alaiset rivit
-- näkyvät samalla säännöllä funktion sk_can_access_client kautta.
--
-- Suljetun verovuoden kirjauksia, poistoja ja metsävähennyksiä ei voi
-- muuttaa (CLAUDE.md). Vanhassa sovelluksessa lukitus oli vain käyttöliittymässä.
--
-- legacy_id: vanhan kannan tunniste, jotta tiedonsiirto voidaan ajaa uudelleen
-- tuplaamatta rivejä.

-- ---------------------------------------------------------------------------
-- Asiakkaat
-- ---------------------------------------------------------------------------
create table sk_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  business_id text,
  municipality text,
  email text,
  phone text,
  street text,
  postal_code text check (postal_code ~ '^\d{5}$'),
  city text,
  tax_account_reference text,
  vat_registered boolean not null default false,
  responsible_user_id uuid references sk_users(id) on delete set null,
  archived_at timestamptz,
  legacy_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sk_clients_org_name on sk_clients (organization_id, last_name, first_name);
create index sk_clients_responsible on sk_clients (responsible_user_id);

-- Vastuukirjanpitäjän on oltava saman toimiston jäsen. Viiteavain tarkistaa
-- vain, että käyttäjä on olemassa.
create or replace function sk_check_responsible_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.responsible_user_id is not null and not exists (
    select 1 from sk_org_members where organization_id = new.organization_id and user_id = new.responsible_user_id
  ) then
    raise exception 'Vastuukirjanpitäjä ei ole toimiston jäsen' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sk_clients_responsible_member before insert or update on sk_clients
  for each row execute function sk_check_responsible_member();

-- Saako kirjautunut käyttäjä nähdä asiakkaan. Security definer, jotta
-- alaisten taulujen säännöt eivät riipu asiakastaulun omasta RLS:stä.
create or replace function sk_can_access_client(client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sk_clients c
    where c.id = client
      and (sk_has_org_role(c.organization_id, array['owner'])
           or (c.responsible_user_id = sk_current_user_id() and sk_has_org_role(c.organization_id, array['staff'])))
  )
$$;
grant execute on function sk_can_access_client(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Metsätilat
-- ---------------------------------------------------------------------------
create table sk_forest_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  name text not null,
  property_code text,
  area_ha numeric(12,2) check (area_ha >= 0),
  acquisition_price numeric(14,2) check (acquisition_price >= 0),
  acquired_on date,
  -- Metsämaan osuus hankintamenosta. Metsävähennyksen pohja lasketaan tästä
  -- osuudesta (src/lib/tax).
  forest_land_share_pct numeric(5,2) check (forest_land_share_pct between 0 and 100),
  -- Metsävähennystä käytetty ennen tätä ohjelmaa (vanha järjestelmä tai muu kirjanpitäjä).
  deduction_used_before numeric(14,2) not null default 0 check (deduction_used_before >= 0),
  legacy_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sk_forest_properties_client on sk_forest_properties (client_id);

-- ---------------------------------------------------------------------------
-- Verovuodet
-- ---------------------------------------------------------------------------
create table sk_tax_years (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  year smallint not null check (year between 2000 and 2100),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references sk_users(id),
  created_at timestamptz not null default now(),
  unique (client_id, year),
  check ((status = 'closed') = (closed_at is not null))
);

create or replace function sk_year_is_closed(client uuid, y integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sk_tax_years where client_id = client and year = y and status = 'closed')
$$;
grant execute on function sk_year_is_closed(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Investoinnit (käyttöomaisuus) ja poistot
-- ---------------------------------------------------------------------------
create table sk_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  description text not null,
  acquired_on date not null,
  acquisition_cost numeric(14,2) not null check (acquisition_cost >= 0),
  -- straight_line = tasapoisto poistoaikana, declining_balance = menojäännöspoisto prosentilla.
  method text not null check (method in ('straight_line', 'declining_balance')),
  useful_life_years smallint check (useful_life_years > 0),
  declining_rate_pct numeric(5,2) check (declining_rate_pct > 0 and declining_rate_pct <= 100),
  -- Poistamaton hankintameno ohjelman käyttöönoton alussa, jos poistoja on tehty ennen sitä.
  opening_book_value numeric(14,2) check (opening_book_value >= 0),
  disposed_on date,
  sale_price numeric(14,2) check (sale_price >= 0),
  legacy_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method <> 'straight_line' or useful_life_years is not null),
  check (method <> 'declining_balance' or declining_rate_pct is not null),
  check (disposed_on is null or disposed_on >= acquired_on)
);
create index sk_assets_client on sk_assets (client_id);

create table sk_depreciations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  asset_id uuid not null references sk_assets(id) on delete cascade,
  tax_year smallint not null,
  amount numeric(14,2) not null check (amount >= 0),
  book_value_end numeric(14,2) not null check (book_value_end >= 0),
  created_at timestamptz not null default now(),
  unique (asset_id, tax_year)
);

-- ---------------------------------------------------------------------------
-- Metsävähennykset
-- ---------------------------------------------------------------------------
create table sk_forest_deductions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  forest_property_id uuid not null references sk_forest_properties(id) on delete cascade,
  tax_year smallint not null,
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (forest_property_id, tax_year)
);

-- ---------------------------------------------------------------------------
-- Kirjaukset
-- ---------------------------------------------------------------------------
create table sk_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  booked_on date not null,
  -- Metsätalouden verovuosi on kalenterivuosi.
  tax_year smallint generated always as (extract(year from booked_on)::smallint) stored,
  kind text not null check (kind in ('income', 'expense', 'investment')),
  -- Luokat ja niiden oletusarvot ovat koodissa (src/lib/tax/rules.ts).
  category text not null,
  description text not null default '',
  amount_net numeric(14,2) not null,
  vat_rate numeric(5,2) not null default 0 check (vat_rate >= 0 and vat_rate < 100),
  -- Ennakonpidätys (esimerkiksi puukaupasta).
  withholding numeric(14,2) not null default 0 check (withholding >= 0),
  reference text,
  asset_id uuid references sk_assets(id) on delete set null,
  created_by uuid references sk_users(id),
  legacy_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sk_transactions_client_year on sk_transactions (client_id, tax_year, booked_on);

-- ---------------------------------------------------------------------------
-- Asiakirjat: tositteet ja arkistoidut raportit. Tiedosto on Supabase
-- Storagessa (storage_path), ei kannassa.
-- ---------------------------------------------------------------------------
create table sk_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null,
  kind text not null check (kind in ('receipt', 'report', 'other')),
  transaction_id uuid references sk_transactions(id) on delete set null,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes >= 0),
  storage_path text not null unique,
  created_by uuid references sk_users(id),
  created_at timestamptz not null default now()
);
create index sk_documents_client_year on sk_documents (client_id, tax_year);

-- ---------------------------------------------------------------------------
-- Saman organisaation ja saman asiakkaan tarkistukset
-- ---------------------------------------------------------------------------
create trigger sk_forest_properties_same_org before insert or update on sk_forest_properties
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_tax_years_same_org before insert or update on sk_tax_years
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_assets_same_org before insert or update on sk_assets
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_depreciations_same_org before insert or update on sk_depreciations
  for each row execute function sk_check_same_org('sk_assets', 'asset_id');
create trigger sk_forest_deductions_same_org before insert or update on sk_forest_deductions
  for each row execute function sk_check_same_org('sk_forest_properties', 'forest_property_id');
create trigger sk_transactions_same_org before insert or update on sk_transactions
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_documents_same_org before insert or update on sk_documents
  for each row execute function sk_check_same_org('sk_clients', 'client_id');

-- Kirjauksen investointi ja asiakirjan kirjaus kuuluvat samalle asiakkaalle.
-- Organisaatiotarkistus ei riitä: saman toimiston kaksi asiakasta sekoittuisi.
create or replace function sk_check_same_client() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_client uuid;
begin
  execute format('select client_id from %I where id = $1', tg_argv[0]) into parent_client
    using (to_jsonb(new) ->> tg_argv[1])::uuid;
  if parent_client is not null and parent_client <> new.client_id then
    raise exception 'Viittaus toisen asiakkaan riviin' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sk_transactions_same_client before insert or update on sk_transactions
  for each row execute function sk_check_same_client('sk_assets', 'asset_id');
create trigger sk_documents_same_client before insert or update on sk_documents
  for each row execute function sk_check_same_client('sk_transactions', 'transaction_id');

-- ---------------------------------------------------------------------------
-- Suljetun vuoden lukitus
-- ---------------------------------------------------------------------------
-- Argumentit: miten asiakas ja vuosi löytyvät rivistä.
--   'direct'   = rivillä on client_id ja tax_year
--   'asset'    = asiakas investoinnin kautta
--   'property' = asiakas metsätilan kautta
create or replace function sk_assert_year_open(via text, r jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  client uuid;
begin
  if via = 'direct' then
    client := (r ->> 'client_id')::uuid;
  elsif via = 'asset' then
    select client_id into client from sk_assets where id = (r ->> 'asset_id')::uuid;
  else
    select client_id into client from sk_forest_properties where id = (r ->> 'forest_property_id')::uuid;
  end if;
  if sk_year_is_closed(client, (r ->> 'tax_year')::integer) then
    raise exception 'Verovuosi % on suljettu', r ->> 'tax_year' using errcode = '42501';
  end if;
end $$;

-- Päivityksessä tarkistetaan sekä vanha että uusi vuosi: muuten kirjauksen
-- voisi siirtää pois suljetulta vuodelta tai sille.
create or replace function sk_check_year_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform sk_assert_year_open(tg_argv[0], to_jsonb(old));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    -- Generoitu tax_year ei ole vielä new-rivillä before-triggerissä, joten se lasketaan päivästä.
    perform sk_assert_year_open(tg_argv[0],
      case when to_jsonb(new) ? 'booked_on'
        then to_jsonb(new) || jsonb_build_object('tax_year', extract(year from (to_jsonb(new) ->> 'booked_on')::date)::int)
        else to_jsonb(new) end);
  end if;
  return coalesce(new, old);
end $$;

create trigger sk_transactions_year_open before insert or update or delete on sk_transactions
  for each row execute function sk_check_year_open('direct');
create trigger sk_depreciations_year_open before insert or update or delete on sk_depreciations
  for each row execute function sk_check_year_open('asset');
create trigger sk_forest_deductions_year_open before insert or update or delete on sk_forest_deductions
  for each row execute function sk_check_year_open('property');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table sk_clients enable row level security;
alter table sk_forest_properties enable row level security;
alter table sk_tax_years enable row level security;
alter table sk_assets enable row level security;
alter table sk_depreciations enable row level security;
alter table sk_forest_deductions enable row level security;
alter table sk_transactions enable row level security;
alter table sk_documents enable row level security;

-- Asiakastaulun säännöt lukevat rivin omat sarakkeet eivätkä kutsu
-- sk_can_access_client-funktiota: funktio ei näe samassa lauseessa lisättyä
-- riviä, jolloin `insert ... returning` kaatuisi.
-- Kirjanpitäjä saa luoda asiakkaan vain itselleen, muuten se katoaisi häneltä heti.
create policy clients_read on sk_clients for select to authenticated
  using (
    sk_has_org_role(organization_id, array['owner'])
    or (sk_has_org_role(organization_id, array['staff']) and responsible_user_id = sk_current_user_id())
  );
create policy clients_insert on sk_clients for insert to authenticated
  with check (
    sk_has_org_role(organization_id, array['owner'])
    or (sk_has_org_role(organization_id, array['staff']) and responsible_user_id = sk_current_user_id())
  );
create policy clients_update on sk_clients for update to authenticated
  using (
    sk_has_org_role(organization_id, array['owner'])
    or (sk_has_org_role(organization_id, array['staff']) and responsible_user_id = sk_current_user_id())
  )
  with check (
    sk_has_org_role(organization_id, array['owner'])
    or (sk_has_org_role(organization_id, array['staff']) and responsible_user_id = sk_current_user_id())
  );
create policy clients_delete on sk_clients for delete to authenticated
  using (sk_has_org_role(organization_id, array['owner']));

-- Asiakkaan alaiset taulut: sama näkyvyys kuin asiakkaalla.
create policy forest_properties_all on sk_forest_properties for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy assets_all on sk_assets for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy transactions_all on sk_transactions for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy documents_all on sk_documents for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));

create policy depreciations_all on sk_depreciations for all to authenticated
  using (exists (select 1 from sk_assets a where a.id = asset_id and sk_can_access_client(a.client_id)))
  with check (exists (select 1 from sk_assets a where a.id = asset_id and sk_can_access_client(a.client_id)));
create policy forest_deductions_all on sk_forest_deductions for all to authenticated
  using (exists (select 1 from sk_forest_properties p where p.id = forest_property_id and sk_can_access_client(p.client_id)))
  with check (exists (select 1 from sk_forest_properties p where p.id = forest_property_id and sk_can_access_client(p.client_id)));

-- Verovuoden voi avata kuka tahansa asiakkaan näkevä, mutta sulkea ja
-- uudelleen avata vain pääkäyttäjä.
create policy tax_years_read on sk_tax_years for select to authenticated
  using (sk_can_access_client(client_id));
create policy tax_years_insert on sk_tax_years for insert to authenticated
  with check (sk_can_access_client(client_id) and status = 'open');
create policy tax_years_owner_update on sk_tax_years for update to authenticated
  using (sk_has_org_role(organization_id, array['owner']) and sk_can_access_client(client_id))
  with check (sk_has_org_role(organization_id, array['owner']));

grant select, insert, update, delete on sk_clients, sk_forest_properties, sk_assets, sk_depreciations,
  sk_forest_deductions, sk_transactions, sk_documents to authenticated;
grant select, insert, update on sk_tax_years to authenticated;
grant all on sk_clients, sk_forest_properties, sk_tax_years, sk_assets, sk_depreciations,
  sk_forest_deductions, sk_transactions, sk_documents to service_role;

create trigger sk_clients_touch before update on sk_clients for each row execute function sk_touch_updated_at();
create trigger sk_forest_properties_touch before update on sk_forest_properties for each row execute function sk_touch_updated_at();
create trigger sk_assets_touch before update on sk_assets for each row execute function sk_touch_updated_at();
create trigger sk_transactions_touch before update on sk_transactions for each row execute function sk_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Storage: yksityinen ämpäri asiakirjoille. Vain Supabasessa (PGlitessä ei
-- ole storage-skeemaa). Tiedostot luetaan ja kirjoitetaan palvelimelta sen
-- jälkeen, kun oikeus on tarkistettu sk_documents-rivin kautta, joten
-- ämpärille ei anneta käyttäjäkohtaisia sääntöjä.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
  end if;
end $$;
