-- 0008: metsätilan luovutukset omaan tauluun (DECISIONS 27.9.2026).
--
-- Tilasta voi myydä osan (määräala tai määräosa), ja useita kertoja. Siksi
-- 0007:n luovutussarakkeet siirretään riveiksi tähän tauluun ja poistetaan
-- tilataulusta. Koko tilan myynti on luovutus, jonka osuus on 100 %.
--
-- share_pct: myydyn osan osuus tilan hankintamenosta. Sen mukaan jaetaan
-- hankintameno luovutusvoittoon, metsävähennyksen lisäyksen enimmäismäärä ja
-- tien ja ojien poistamaton arvo, ja tilan jäljelle jäävä metsävähennyspohja
-- pienenee saman verran (Verohallinto: Metsävähennys, luvut 3.4 ja 7.1.3).
-- Jos osuutta ei muuten tiedetä, se lasketaan metsämaan pinta-aloista.
--
-- Laskenta tehdään ohjelmassa (src/lib/tax/forest-sale.ts) eikä tuloksia
-- tallenneta, jotta ne pysyvät oikeina, vaikka aiempia vuosia korjattaisiin.

create table sk_forest_property_disposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  forest_property_id uuid not null references sk_forest_properties(id) on delete cascade,
  -- Lopullisen kauppakirjan päivä: se ratkaisee luovutusvoiton verovuoden.
  disposed_on date not null,
  tax_year smallint generated always as (extract(year from disposed_on)::smallint) stored,
  sale_price numeric(14,2) not null check (sale_price >= 0),
  share_pct numeric(5,2) not null check (share_pct > 0 and share_pct <= 100),
  -- Voiton hankkimisesta aiheutuneet menot. Vähennetään vain, kun käytetään todellista hankintamenoa.
  selling_costs numeric(14,2) not null default 0 check (selling_costs >= 0),
  -- Vastikkeeton tai verovapaa luovutus: käytettyä metsävähennystä ei lisätä luovutusvoittoon.
  no_deduction_addition boolean not null default false,
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sk_forest_property_disposals_property on sk_forest_property_disposals (forest_property_id, disposed_on);
create index sk_forest_property_disposals_client on sk_forest_property_disposals (client_id);

-- 0007:n tiedot: koko tilan myynti. Siirto ennen lukitustriggeriä, jotta
-- suljetun vuoden myynti siirtyy sellaisenaan.
insert into sk_forest_property_disposals (organization_id, client_id, forest_property_id, disposed_on, sale_price, share_pct, no_deduction_addition)
select organization_id, client_id, id, disposed_on, coalesce(sale_price, 0), 100, no_deduction_addition
  from sk_forest_properties where disposed_on is not null;

alter table sk_forest_properties
  drop constraint sk_forest_properties_disposal_after_acquisition,
  drop column disposed_on,
  drop column sale_price,
  drop column no_deduction_addition;

-- Saman organisaation ja saman asiakkaan tarkistukset.
create trigger sk_forest_property_disposals_same_org before insert or update on sk_forest_property_disposals
  for each row execute function sk_check_same_org('sk_clients', 'client_id');
create trigger sk_forest_property_disposals_same_client before insert or update on sk_forest_property_disposals
  for each row execute function sk_check_same_client('sk_forest_properties', 'forest_property_id');

-- Luovutus ei voi olla ennen tilan hankintaa, eikä tilasta voi myydä yli 100 %.
-- Funktio näkee kaikki tilan luovutukset riippumatta käyttäjän oikeuksista.
create or replace function sk_check_disposal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acquired date;
  total numeric;
begin
  select acquired_on into acquired from sk_forest_properties where id = new.forest_property_id;
  if acquired is not null and new.disposed_on < acquired then
    raise exception 'Luovutuspäivä on ennen tilan hankintaa' using errcode = '23514';
  end if;
  select coalesce(sum(share_pct), 0) into total from sk_forest_property_disposals
   where forest_property_id = new.forest_property_id and id <> new.id;
  if total + new.share_pct > 100 then
    raise exception 'Tilasta on myyty yli 100 prosenttia' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger sk_forest_property_disposals_check before insert or update on sk_forest_property_disposals
  for each row execute function sk_check_disposal();

-- Suljetun vuoden lukitus: luovutusta ei voi lisätä, muuttaa, siirtää eikä
-- poistaa suljetulla vuodella. Generoitu tax_year ei ole vielä new-rivillä
-- before-triggerissä, joten vuosi lasketaan päivästä.
create or replace function sk_check_disposal_year_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and sk_year_is_closed(old.client_id, extract(year from old.disposed_on)::int) then
    raise exception 'Verovuosi % on suljettu', extract(year from old.disposed_on)::int using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and sk_year_is_closed(new.client_id, extract(year from new.disposed_on)::int) then
    raise exception 'Verovuosi % on suljettu', extract(year from new.disposed_on)::int using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger sk_forest_property_disposals_year_open before insert or update or delete on sk_forest_property_disposals
  for each row execute function sk_check_disposal_year_open();

create trigger sk_forest_property_disposals_touch before update on sk_forest_property_disposals
  for each row execute function sk_touch_updated_at();

-- RLS: sama näkyvyys kuin asiakkaalla.
alter table sk_forest_property_disposals enable row level security;
create policy forest_property_disposals_all on sk_forest_property_disposals for all to authenticated
  using (sk_can_access_client(client_id)) with check (sk_can_access_client(client_id));

-- 0003 poisti anon-oikeudet vain silloin olemassa olleilta tauluilta ja funktioilta.
revoke all on sk_forest_property_disposals from anon;
revoke all on function sk_check_disposal() from anon, public;
revoke all on function sk_check_disposal_year_open() from anon, public;
grant select, insert, update, delete on sk_forest_property_disposals to authenticated;
grant all on sk_forest_property_disposals to service_role;
