-- 0007: metsätilan luovutus (PLAN vaihe 5, DECISIONS 27.9.2026).
--
-- Kun metsätila myydään, luovutusvoittoon lisätään käytetty metsävähennys,
-- enintään myydystä metsästä saatu vähennysoikeus (TVL 46 § 8 mom.). Lisäys
-- lasketaan ohjelmassa näistä tiedoista, eikä sitä tallenneta, jotta se pysyy
-- oikeana, vaikka aiempia vähennyksiä korjattaisiin avoimella vuodella.
--
-- no_deduction_addition: vastikkeeton tai verovapaa luovutus (esimerkiksi lahja
-- tai sukupolvenvaihdos), jossa lisäystä ei tehdä.

alter table sk_forest_properties
  add column disposed_on date,
  add column sale_price numeric(14,2) check (sale_price >= 0),
  add column no_deduction_addition boolean not null default false,
  add constraint sk_forest_properties_disposal_after_acquisition check (disposed_on is null or acquired_on is null or disposed_on >= acquired_on);
