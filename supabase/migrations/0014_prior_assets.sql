-- 0014: aiemmin hankittu investointi ja sen menojäännös (Jukan pyyntö 28.9.2026).
--
-- Kirjanpitäjä lisää investoinnin, joka on hankittu ennen kuin asiakas tuli
-- Skogiin, esimerkiksi metsäautotien, jonka menojäännös 31.12.2024 on
-- 3 265,60 euroa. Kohteelle tallennetaan hankintahinta, kertynyt poisto
-- vuoden X loppuun ja niistä laskettu menojäännös (opening_book_value).
--
-- opening_year on vuosi, jonka alun arvo opening_book_value on (X + 1).
-- Poistolaskenta alkaa siitä vuodesta, eikä investointi näy aiemmilla
-- vuosilla. Vanhasta sovelluksesta tuoduilla riveillä opening_year on tyhjä,
-- ja ne toimivat kuten ennen (opening_book_value hankintavuodesta alkaen).

alter table sk_assets
  add column opening_year smallint check (opening_year between 1900 and 2200),
  add column opening_accumulated_depreciation numeric(14,2) check (opening_accumulated_depreciation >= 0);

-- Menojäännös on aina hankintahinta miinus kertynyt poisto, jotta kolme lukua
-- eivät voi olla ristiriidassa. Aiempi investointi poistetaan vain
-- menojäännöspoistolla, ja hankintapäivä on ennen ensimmäistä poistovuotta.
alter table sk_assets add constraint sk_assets_prior check (
  opening_year is null
  or (
    method = 'declining_balance'
    and opening_accumulated_depreciation is not null
    and opening_book_value is not null
    and opening_accumulated_depreciation <= acquisition_cost
    and opening_book_value = acquisition_cost - opening_accumulated_depreciation
    and extract(year from acquired_on) < opening_year
  )
);
alter table sk_assets add constraint sk_assets_prior_accumulated check (opening_accumulated_depreciation is null or opening_year is not null);

-- Aiemman investoinnin lähtötietoja ei voi lisätä, muuttaa eikä poistaa, jos
-- sen ensimmäinen poistovuosi on suljettu: suljetun vuoden poistot ja raportti
-- on laskettu niistä. Myynnin tiedot (disposed_on, sale_price) saa muuttaa,
-- koska myynti kirjataan myöhemmälle, avoimelle vuodelle ja sen lukitus
-- tarkistetaan kirjauksesta. Tavallisten investointien lukitus tulee
-- kirjauksista kuten ennen.
create or replace function sk_check_prior_asset_year_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.opening_year is not null then
    if tg_op = 'DELETE' or (old.description, old.acquired_on, old.acquisition_cost, old.method, old.declining_rate_pct, old.opening_book_value,
                            old.opening_year, old.opening_accumulated_depreciation, old.forest_property_id)
                           is distinct from
                           (new.description, new.acquired_on, new.acquisition_cost, new.method, new.declining_rate_pct, new.opening_book_value,
                            new.opening_year, new.opening_accumulated_depreciation, new.forest_property_id) then
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

create trigger sk_assets_prior_year_open before insert or update or delete on sk_assets
  for each row execute function sk_check_prior_asset_year_open();
