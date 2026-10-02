-- 0018: maatalouden kirjanpidon täydennykset (PLAN 9, DECISIONS 2.10.2026).
--
-- 1. Kirjauksen maatila: tasausvaraus tehdään ja käytetään maatiloittain
--    (vero.fi, Tasausvaraus ja jälleenhankintavaraus), joten usean tilan
--    asiakkaalla tulo lasketaan tiloittain kirjauksen tilasta.
-- 2. Kotieläinten jaksotuksen linkki kirjaukseen: jaksotettavan kotieläinkirjauksen
--    tallennus luo tai päivittää jaksotusrivin, ja Lomake 2 -välilehti näyttää sen.
--    Käsin syötetyt rivit (aiemmat vuodet) jäävät ilman linkkiä.
-- 3. Ajoneuvo- ja matkaselvitys (lomake 2: 281–288, 401–425, 516–534) vuodelle.
--
-- Uudet sarakkeet ovat tyhjiä ilman oletusarvoa, joten vanhoja rivejä ei
-- kirjoiteta uudelleen eivätkä suljettujen vuosien lukitus- ja
-- aikaleimatriggerit laukea. Tarkistusehdot pätevät vanhoihin riveihin, koska
-- uudet sarakkeet ovat niissä tyhjiä.

-- ---------------------------------------------------------------------------
-- Kirjauksen maatila
-- ---------------------------------------------------------------------------
-- Vain maatalouden kirjauksella. Tilan poisto jättää kirjauksen ilman tilaa
-- (src/lib/agriculture/year.ts tarkistaa ensin suljetut vuodet).
alter table sk_transactions add column farm_id uuid references sk_farms(id) on delete set null;
alter table sk_transactions add constraint sk_transactions_farm_agri check (farm_id is null or activity = 'agriculture');
create index sk_transactions_farm on sk_transactions (farm_id) where farm_id is not null;
create trigger sk_transactions_same_client_farm before insert or update on sk_transactions
  for each row execute function sk_check_same_client('sk_farms', 'farm_id');

-- ---------------------------------------------------------------------------
-- Jaksotuksen kirjaus
-- ---------------------------------------------------------------------------
-- Yksi jaksotus kirjausta kohden. Kirjauksen poisto poistaa jaksotuksen.
alter table sk_agri_deferrals add column transaction_id uuid references sk_transactions(id) on delete cascade;
create unique index sk_agri_deferrals_transaction on sk_agri_deferrals (transaction_id) where transaction_id is not null;
create trigger sk_agri_deferrals_same_client before insert or update on sk_agri_deferrals
  for each row execute function sk_check_same_client('sk_transactions', 'transaction_id');

-- ---------------------------------------------------------------------------
-- Ajoneuvo- ja matkaselvitys
-- ---------------------------------------------------------------------------
-- Syötetyt tiedot; lomakkeen kentät lasketaan niistä (src/lib/tax/vehicle.ts).
-- Kilometrit kokonaislukuina, matkapäivät kokonaislukuina.
create table sk_agri_vehicle_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null check (tax_year between 2000 and 2100),
  -- Maatalouden kalustoon kuuluva ajoneuvo (281, 516, 282–284).
  vehicle_basis smallint check (vehicle_basis in (1, 2)),
  vehicle_total_km integer check (vehicle_total_km >= 0),
  vehicle_private_km integer check (vehicle_private_km >= 0),
  vehicle_forestry_km integer check (vehicle_forestry_km >= 0),
  vehicle_costs numeric(14,2) check (vehicle_costs >= 0),
  -- Yksityistalouteen kuuluva auto maataloudessa (534, 287, 288, 518, 519, 285).
  car_basis smallint check (car_basis in (1, 2)),
  car_total_km integer check (car_total_km >= 0),
  car_agri_km integer check (car_agri_km >= 0),
  car_deducted numeric(14,2) check (car_deducted >= 0),
  -- Tilapäiset työmatkat (401–411, 423–425, 429, 532, 533, 286).
  trips_full_days integer check (trips_full_days >= 0),
  trips_full_deducted numeric(14,2) check (trips_full_deducted >= 0),
  trips_part_days integer check (trips_part_days >= 0),
  trips_part_deducted numeric(14,2) check (trips_part_deducted >= 0),
  trips_abroad_days integer check (trips_abroad_days >= 0),
  trips_abroad_max numeric(14,2) check (trips_abroad_max >= 0),
  trips_abroad_deducted numeric(14,2) check (trips_abroad_deducted >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, tax_year),
  check (coalesce(vehicle_private_km, 0) + coalesce(vehicle_forestry_km, 0) <= coalesce(vehicle_total_km, 0)),
  check (coalesce(car_agri_km, 0) <= coalesce(car_total_km, 0))
);

create trigger sk_agri_vehicle_reports_same_org before insert or update on sk_agri_vehicle_reports
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_agri_vehicle_reports_year_open before insert or update or delete on sk_agri_vehicle_reports
  for each row execute function sk_check_year_open('direct');
create trigger sk_agri_vehicle_reports_touch before update on sk_agri_vehicle_reports
  for each row execute function sk_touch_updated_at();

alter table sk_agri_vehicle_reports enable row level security;
create policy agri_vehicle_reports_all on sk_agri_vehicle_reports for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));

revoke all on sk_agri_vehicle_reports from anon;
grant select, insert, update, delete on sk_agri_vehicle_reports to authenticated;
grant all on sk_agri_vehicle_reports to service_role;

-- ---------------------------------------------------------------------------
-- Varauksen ja sen käyttöjen eheys (katselmointi 2.10.2026)
-- ---------------------------------------------------------------------------
-- 0015:n tarkistus luki varauksen ennen saman asiakkaan tarkistusta (triggerit
-- laukeavat nimijärjestyksessä), joten toisen asiakkaan varauksen tunnisteella
-- sai tietää sen määrän rajan. Varaus haetaan nyt vain saman asiakkaan riveistä.
create or replace function sk_check_reserve_use() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  total numeric;
  r record;
begin
  select amount, made_year into r from sk_agri_reserves where id = new.reserve_id and client_id = new.client_id;
  if not found then
    raise exception 'Viittaus toisen asiakkaan riviin' using errcode = '42501';
  end if;
  if new.tax_year < r.made_year then
    raise exception 'Varausta ei voi käyttää ennen sen tekovuotta' using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into total from sk_agri_reserve_uses where reserve_id = new.reserve_id and id <> new.id;
  if total + new.amount > r.amount then
    raise exception 'Varauksesta käytettäisiin enemmän kuin se on' using errcode = '23514';
  end if;
  return new;
end $$;

-- Varauksen määrää tai vuotta ei voi muuttaa niin, että käytöt ylittävät sen
-- tai osuvat ennen tekovuotta (verosuunnitelma muuttaa verovuoden varausta).
create or replace function sk_check_reserve_amount() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from sk_agri_reserve_uses u where u.reserve_id = new.id
              having coalesce(sum(u.amount), 0) > new.amount or min(u.tax_year) < new.made_year) then
    raise exception 'Varauksesta käytettäisiin enemmän kuin se on' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger sk_agri_reserves_amount_check before update of amount, made_year on sk_agri_reserves
  for each row execute function sk_check_reserve_amount();
revoke all on function sk_check_reserve_amount() from anon, public;
