-- 0015: maatalous (docs/maatalous-suunnitelma-2026-10-02.md, DECISIONS 2.10.2026).
--
-- Sama asiakas voi harjoittaa metsätaloutta ja maataloutta. Verovuosi,
-- lukitus, tositteet ja arvonlisävero ovat asiakkaan yhteisiä; toiminto
-- erottaa vain tuloverotuksen laskelmat (2C ja lomake 2).
--
-- Olemassa olevat rivit ovat metsätaloutta: uudet sarakkeet saavat
-- oletusarvon, joka ei kirjoita rivejä uudelleen (Postgres 11+), joten
-- suljettujen vuosien lukitus- ja aikaleimatriggerit eivät laukea, eikä
-- mikään luku muutu.

-- ---------------------------------------------------------------------------
-- Asiakkaan toiminnot
-- ---------------------------------------------------------------------------
-- Maatalouden luokat ja sivut näkyvät vain, kun has_agriculture on päällä.
-- Pelkkä maatalousasiakas voi kytkeä metsätalouden pois, jolloin 2C jää
-- ilmoitustiedostosta pois.
alter table sk_clients
  add column has_forestry boolean not null default true,
  add column has_agriculture boolean not null default false;

-- ---------------------------------------------------------------------------
-- Kirjauksen toiminto ja osuudet
-- ---------------------------------------------------------------------------
-- activity tulee luokasta: maatalouden luokkien tunnukset alkavat agri_
-- (src/lib/tax/rules.ts). Tarkistus pitää ne yhdessä kannassa, jolloin
-- kirjaus ei voi olla väärän toiminnon laskelmassa.
--
-- business_share_pct (0013) on kirjauksen oman toiminnon osuus ja
-- other_share_pct toisen toiminnon osuus (metsä ↔ maatalous). Loppu on
-- yksityiskäyttöä, jonka ostojen veroa ei vähennetä. Toisen toiminnon osuus
-- on vain menoilla: tulo ja investointi kuuluvat yhdelle toiminnolle.
alter table sk_transactions
  add column activity text not null default 'forestry' check (activity in ('forestry', 'agriculture')),
  add column other_share_pct numeric(5,2) not null default 0 check (other_share_pct >= 0 and other_share_pct < 100);
alter table sk_transactions add constraint sk_transactions_shares check (business_share_pct + other_share_pct <= 100);
alter table sk_transactions add constraint sk_transactions_other_share_expense check (other_share_pct = 0 or kind = 'expense');
alter table sk_transactions add constraint sk_transactions_activity_category check ((activity = 'agriculture') = (category like 'agri\_%'));

-- ---------------------------------------------------------------------------
-- Investoinnin toiminto ja maatalouden poistoryhmä
-- ---------------------------------------------------------------------------
-- Metsätalouden lajin kertoo menojäännöspoiston prosentti kuten ennen.
-- Maataloudessa prosentti ei riitä (25 % on sekä koneet että
-- ympäristönsuojelun rakennelma), joten ryhmä on oma sarakkeensa.
-- accelerated: uusi kone, käyttöön 2020–2025, korotettu poisto 50 %
-- verovuosina 2020–2025 (lomake 2, 2025: 364–584).
alter table sk_assets
  add column activity text not null default 'forestry' check (activity in ('forestry', 'agriculture')),
  add column asset_class text check (asset_class in (
    'agri_production_building', 'agri_dwelling', 'agri_greenhouse', 'agri_environmental', 'agri_machinery', 'agri_bridges', 'agri_drainage')),
  add column accelerated boolean not null default false;
alter table sk_assets add constraint sk_assets_activity_class check ((activity = 'agriculture') = (asset_class is not null));
alter table sk_assets add constraint sk_assets_agri_declining check (activity = 'forestry' or method = 'declining_balance');
alter table sk_assets add constraint sk_assets_accelerated check (not accelerated or asset_class = 'agri_machinery');

-- Aiemman investoinnin lukitus (0014) kattaa myös toiminnon ja ryhmän.
create or replace function sk_check_prior_asset_year_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.opening_year is not null then
    if tg_op = 'DELETE' or (old.description, old.acquired_on, old.acquisition_cost, old.method, old.declining_rate_pct, old.opening_book_value,
                            old.opening_year, old.opening_accumulated_depreciation, old.forest_property_id, old.activity, old.asset_class, old.accelerated)
                           is distinct from
                           (new.description, new.acquired_on, new.acquisition_cost, new.method, new.declining_rate_pct, new.opening_book_value,
                            new.opening_year, new.opening_accumulated_depreciation, new.forest_property_id, new.activity, new.asset_class, new.accelerated) then
      if sk_year_is_closed(old.client_id, old.opening_year) then
        raise exception 'Verovuosi % on suljettu', old.opening_year using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.opening_year is not null and sk_year_is_closed(new.client_id, new.opening_year) then
    if tg_op = 'INSERT' or new.opening_year is distinct from old.opening_year then
      raise exception 'Verovuosi % on suljettu', new.opening_year using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Maatilat
-- ---------------------------------------------------------------------------
-- Tasausvaraus tehdään maatiloittain, joten tila on mukana alusta asti.
-- farm_code on Ruokaviraston tilatunnus (ei henkilötieto).
create table sk_farms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  farm_code text check (length(farm_code) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sk_farms_client on sk_farms (client_id);

-- ---------------------------------------------------------------------------
-- Maatalouden vuoden tiedot (lomakkeen 2 tiedot, joita ei saa kirjauksista)
-- ---------------------------------------------------------------------------
create table sk_agri_years (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null check (tax_year between 2000 and 2100),
  -- Yrittäjäpuolison osuudet (414 ja 416). Yrittäjän osuus on loppu (413, 415). Tyhjä = ei puolisoa.
  spouse_wealth_share_pct numeric(5,2) check (spouse_wealth_share_pct between 0 and 100),
  spouse_work_share_pct numeric(5,2) check (spouse_work_share_pct between 0 and 100),
  -- 418: tyhjä = pääomatulo-osuus 20 %, ten = enintään 10 %, earned = kokonaan ansiotuloa.
  income_split_claim text check (income_split_claim in ('ten', 'earned')),
  -- 420: pääomatuloista vähennettävä tappio.
  loss_to_capital_income numeric(14,2) check (loss_to_capital_income >= 0),
  -- 437: ennakonpidätyksen alaiset palkat ilman sivukuluja.
  wages_subject_to_withholding numeric(14,2) not null default 0 check (wages_subject_to_withholding >= 0),
  -- Varallisuuslaskelman syötettävät erät: 432, 431, 468, 469 (lisä laskettuun), 732, 470.
  land_value numeric(14,2) check (land_value >= 0),
  rental_dwellings_value numeric(14,2) check (rental_dwellings_value >= 0),
  shares_value numeric(14,2) check (shares_value >= 0),
  other_assets_value numeric(14,2) check (other_assets_value >= 0),
  liabilities numeric(14,2) check (liabilities >= 0),
  other_farm_assets numeric(14,2) check (other_farm_assets >= 0),
  -- Edellisen vuoden nettovarallisuus ja vahvistetut tappiot seurantaa ja myöhempää yritystulon jakoa varten.
  prior_net_wealth numeric(14,2),
  confirmed_losses_carried numeric(14,2) not null default 0 check (confirmed_losses_carried >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, tax_year)
);

-- ---------------------------------------------------------------------------
-- Maatalouden poistot ryhmittäin
-- ---------------------------------------------------------------------------
-- Lomake 2 ilmoittaa poistot ryhmittäin (240–277, 511–527), ja koneilla on
-- yhteinen menojäännös. Siksi maatalouden poisto valitaan ryhmälle eikä
-- investoinnille (metsätaloudessa sk_depreciations). Ryhmän menojäännös
-- lasketaan investoinneista ja näistä poistoista (src/lib/tax/agri-depreciation.ts).
create table sk_agri_depreciations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null,
  pool text not null check (pool in (
    'agri_production_building', 'agri_dwelling', 'agri_greenhouse', 'agri_environmental', 'agri_machinery', 'agri_machinery_accelerated',
    'agri_bridges', 'agri_drainage')),
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (client_id, tax_year, pool)
);

-- ---------------------------------------------------------------------------
-- Investointituet (vähennetään poistopohjasta: 243, 248, 253, 258, 264, 270, 276)
-- ---------------------------------------------------------------------------
create table sk_asset_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  asset_id uuid not null references sk_assets(id) on delete cascade,
  tax_year smallint not null,
  kind text not null default 'grant' check (kind in ('grant')),
  amount numeric(14,2) not null check (amount > 0),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index sk_asset_adjustments_client on sk_asset_adjustments (client_id, tax_year);

-- ---------------------------------------------------------------------------
-- Varaukset: tasausvaraus ja jälleenhankintavaraus
-- ---------------------------------------------------------------------------
-- Syötetään käsin (Jukan päätös 2.10.2026); laskuri myöhemmin. Käyttö
-- investointiin pienentää poistopohjaa (242, 262 …), tuloutus on tuloa
-- (219 tai 220). Purkamaton määrä lasketaan: tehty − käytetty.
create table sk_agri_reserves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  farm_id uuid references sk_farms(id) on delete set null,
  kind text not null check (kind in ('equalization', 'replacement')),
  made_year smallint not null check (made_year between 2000 and 2100),
  amount numeric(14,2) not null check (amount > 0),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index sk_agri_reserves_client on sk_agri_reserves (client_id);

create table sk_agri_reserve_uses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  reserve_id uuid not null references sk_agri_reserves(id) on delete cascade,
  tax_year smallint not null,
  -- asset = käytetty maatalouden investointiin, income = tuloutettu.
  use_kind text not null check (use_kind in ('asset', 'income')),
  asset_id uuid references sk_assets(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  check ((use_kind = 'asset') = (asset_id is not null))
);
create index sk_agri_reserve_uses_reserve on sk_agri_reserve_uses (reserve_id);

-- ---------------------------------------------------------------------------
-- Kotieläinten jaksotukset (211/212 ja 227/228) aiemmilta vuosilta
-- ---------------------------------------------------------------------------
create table sk_agri_deferrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  -- Jaksotuksen syntyvuosi.
  tax_year smallint not null check (tax_year between 2000 and 2100),
  kind text not null check (kind in ('livestock_sale', 'livestock_purchase')),
  amount numeric(14,2) not null check (amount > 0),
  year1 numeric(14,2) not null check (year1 >= 0),
  year2 numeric(14,2) not null check (year2 >= 0),
  year3 numeric(14,2) not null check (year3 >= 0),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  check (year1 + year2 + year3 = amount)
);
create index sk_agri_deferrals_client on sk_agri_deferrals (client_id, tax_year);

-- ---------------------------------------------------------------------------
-- Harvinaiset lomakkeen 2 kentät (ajoneuvot, matkat, käyttöön ottamattomat …)
-- ---------------------------------------------------------------------------
-- Sallitut tunnukset ovat koodissa vuosittain (src/lib/filing/vsy002.ts).
create table sk_agri_form_extras (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null,
  code text not null check (code ~ '^[0-9]{3}$'),
  value numeric(14,2) not null check (value >= 0),
  created_at timestamptz not null default now(),
  unique (client_id, tax_year, code)
);

-- ---------------------------------------------------------------------------
-- Saman organisaation ja saman asiakkaan tarkistukset
-- ---------------------------------------------------------------------------
create trigger sk_farms_same_org before insert or update on sk_farms
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_agri_years_same_org before insert or update on sk_agri_years
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_agri_depreciations_same_org before insert or update on sk_agri_depreciations
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_asset_adjustments_same_org before insert or update on sk_asset_adjustments
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_asset_adjustments_same_client before insert or update on sk_asset_adjustments
  for each row execute function sk_check_same_client('sk_assets', 'asset_id');
create trigger sk_agri_reserves_same_org before insert or update on sk_agri_reserves
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_agri_reserves_same_client before insert or update on sk_agri_reserves
  for each row execute function sk_check_same_client('sk_farms', 'farm_id');
create trigger sk_agri_reserve_uses_same_org before insert or update on sk_agri_reserve_uses
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_agri_reserve_uses_same_client before insert or update on sk_agri_reserve_uses
  for each row execute function sk_check_same_client('sk_agri_reserves', 'reserve_id');
create trigger sk_agri_reserve_uses_same_client_asset before insert or update on sk_agri_reserve_uses
  for each row execute function sk_check_same_client('sk_assets', 'asset_id');
create trigger sk_agri_deferrals_same_org before insert or update on sk_agri_deferrals
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_agri_form_extras_same_org before insert or update on sk_agri_form_extras
  for each row execute function sk_check_same_org('sk_clients', 'client_id');

-- Varauksesta ei voi käyttää enempää kuin se on, eikä käyttää ennen tekovuotta.
-- Funktio näkee kaikki varauksen käytöt riippumatta käyttäjän oikeuksista.
create or replace function sk_check_reserve_use() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  total numeric;
  r record;
begin
  select amount, made_year into r from sk_agri_reserves where id = new.reserve_id;
  if new.tax_year < r.made_year then
    raise exception 'Varausta ei voi käyttää ennen sen tekovuotta' using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into total from sk_agri_reserve_uses where reserve_id = new.reserve_id and id <> new.id;
  if total + new.amount > r.amount then
    raise exception 'Varauksesta käytettäisiin enemmän kuin se on' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger sk_agri_reserve_uses_check before insert or update on sk_agri_reserve_uses
  for each row execute function sk_check_reserve_use();

-- ---------------------------------------------------------------------------
-- Suljetun vuoden lukitus
-- ---------------------------------------------------------------------------
create trigger sk_agri_years_year_open before insert or update or delete on sk_agri_years
  for each row execute function sk_check_year_open('direct');
create trigger sk_agri_depreciations_year_open before insert or update or delete on sk_agri_depreciations
  for each row execute function sk_check_year_open('direct');
create trigger sk_asset_adjustments_year_open before insert or update or delete on sk_asset_adjustments
  for each row execute function sk_check_year_open('direct');
create trigger sk_agri_reserve_uses_year_open before insert or update or delete on sk_agri_reserve_uses
  for each row execute function sk_check_year_open('direct');
create trigger sk_agri_deferrals_year_open before insert or update or delete on sk_agri_deferrals
  for each row execute function sk_check_year_open('direct');
create trigger sk_agri_form_extras_year_open before insert or update or delete on sk_agri_form_extras
  for each row execute function sk_check_year_open('direct');

-- Varauksen tekovuosi on sen verovuosi.
create or replace function sk_check_reserve_year_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and sk_year_is_closed(old.client_id, old.made_year) then
    raise exception 'Verovuosi % on suljettu', old.made_year using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and sk_year_is_closed(new.client_id, new.made_year) then
    raise exception 'Verovuosi % on suljettu', new.made_year using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger sk_agri_reserves_year_open before insert or update or delete on sk_agri_reserves
  for each row execute function sk_check_reserve_year_open();

create trigger sk_farms_touch before update on sk_farms for each row execute function sk_touch_updated_at();
create trigger sk_agri_years_touch before update on sk_agri_years for each row execute function sk_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: sama näkyvyys kuin asiakkaalla
-- ---------------------------------------------------------------------------
alter table sk_farms enable row level security;
alter table sk_agri_years enable row level security;
alter table sk_agri_depreciations enable row level security;
alter table sk_asset_adjustments enable row level security;
alter table sk_agri_reserves enable row level security;
alter table sk_agri_reserve_uses enable row level security;
alter table sk_agri_deferrals enable row level security;
alter table sk_agri_form_extras enable row level security;

create policy farms_all on sk_farms for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy agri_years_all on sk_agri_years for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy agri_depreciations_all on sk_agri_depreciations for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy asset_adjustments_all on sk_asset_adjustments for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy agri_reserves_all on sk_agri_reserves for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy agri_reserve_uses_all on sk_agri_reserve_uses for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy agri_deferrals_all on sk_agri_deferrals for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));
create policy agri_form_extras_all on sk_agri_form_extras for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));

-- 0003 poisti anon-oikeudet vain silloin olemassa olleilta tauluilta ja funktioilta.
revoke all on sk_farms, sk_agri_years, sk_agri_depreciations, sk_asset_adjustments, sk_agri_reserves, sk_agri_reserve_uses,
  sk_agri_deferrals, sk_agri_form_extras from anon;
revoke all on function sk_check_reserve_use() from anon, public;
revoke all on function sk_check_reserve_year_open() from anon, public;
grant select, insert, update, delete on sk_farms, sk_agri_years, sk_agri_depreciations, sk_asset_adjustments, sk_agri_reserves,
  sk_agri_reserve_uses, sk_agri_deferrals, sk_agri_form_extras to authenticated;
grant all on sk_farms, sk_agri_years, sk_agri_depreciations, sk_asset_adjustments, sk_agri_reserves, sk_agri_reserve_uses,
  sk_agri_deferrals, sk_agri_form_extras to service_role;
