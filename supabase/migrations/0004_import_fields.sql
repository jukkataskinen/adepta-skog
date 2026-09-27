-- 0004: tiedonsiirrosta pois jääneet kentät (PLAN vaihe 2, DECISIONS 26.9.2026).
--
-- - Asiakkaan arvonlisäveronumero. Metsänomistajalla voi olla ALV-numero ilman
--   Y-tunnusta, joten se on oma kenttänsä.
-- - Metsätilan metsämaan pinta-ala hehtaareina. Metsämaan osuus prosentteina
--   (forest_land_share_pct) on metsävähennyksen pohja; hehtaarit ovat tieto
--   kirjanpitäjälle, eivätkä ne vaikuta laskentaan.
-- - Kirjauksen ja investoinnin metsätila. Vapaaehtoinen, koska kaikki menot
--   eivät kohdistu yhdelle tilalle. Tilan poisto jättää kirjauksen ilman tilaa.

alter table sk_clients add column vat_number text;

alter table sk_forest_properties add column forest_land_ha numeric(12,2) check (forest_land_ha >= 0);

alter table sk_transactions add column forest_property_id uuid references sk_forest_properties(id) on delete set null;
create index sk_transactions_property on sk_transactions (forest_property_id) where forest_property_id is not null;

alter table sk_assets add column forest_property_id uuid references sk_forest_properties(id) on delete set null;
create index sk_assets_property on sk_assets (forest_property_id) where forest_property_id is not null;

-- Tila kuuluu samalle asiakkaalle kuin kirjaus tai investointi. Organisaatio
-- tulee asiakkaan kautta samaan tarkistukseen.
create trigger sk_transactions_same_client_property before insert or update on sk_transactions
  for each row execute function sk_check_same_client('sk_forest_properties', 'forest_property_id');
create trigger sk_assets_same_client_property before insert or update on sk_assets
  for each row execute function sk_check_same_client('sk_forest_properties', 'forest_property_id');
