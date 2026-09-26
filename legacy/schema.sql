-- Vanhan Skog-kannan rakenne (vain sarakkeet), luettu 2026-09-26.
-- Lähde: scripts/dump-legacy-schema.mts. Ei tietoja.

create table organisaatiot (
  id uuid not null default extensions.uuid_generate_v4(),
  nimi text not null,
  y_tunnus text,
  osoite text,
  postinumero text,
  postitoimipaikka text,
  puhelin text,
  sahkoposti text,
  luotu_at timestamp with time zone not null default now(),
  muokattu_at timestamp with time zone not null default now(),
  aktiivinen boolean not null default true,
  avoin_vuosi smallint default 2025
);

create table kayttajat (
  id uuid not null default extensions.uuid_generate_v4(),
  organisaatio_id uuid not null,
  etunimi text,
  sukunimi text,
  sahkoposti text not null,
  auth_sub text,
  rooli USER-DEFINED not null default 'kirjanpitaja'::kayttaja_rooli,
  viimeksi_kirjautunut timestamp with time zone,
  luotu_at timestamp with time zone not null default now(),
  muokattu_at timestamp with time zone not null default now(),
  aktiivinen boolean not null default true
);

create table asiakkaat (
  id uuid not null default extensions.uuid_generate_v4(),
  organisaatio_id uuid not null,
  etunimi text not null,
  sukunimi text not null,
  henkilotunnus_hash text,
  osoite text,
  postinumero text,
  postitoimipaikka text,
  puhelin text,
  sahkoposti text,
  alv_rekisterissa boolean not null default true,
  alv_numero text,
  luotu_at timestamp with time zone not null default now(),
  muokattu_at timestamp with time zone not null default now(),
  poistettu_at timestamp with time zone,
  luonut_kayttaja_id uuid,
  kotikunta text,
  nimi text,
  y_tunnus text,
  verotiliviite text,
  avoin_vuosi smallint default 2025,
  vastuukirjanpitaja_id uuid
);

create table metsatilat (
  id uuid not null default extensions.uuid_generate_v4(),
  asiakas_id uuid not null,
  nimi text not null,
  kiinteistotunnus text,
  pinta_ala_ha numeric,
  metsämaa_ha numeric,
  hankintahinta numeric,
  hankintapvm date,
  metsämaan_osuus_prosentti numeric default 60.0,
  vahennyspohjaa_kaytetty numeric default 0,
  luotu_at timestamp with time zone not null default now(),
  muokattu_at timestamp with time zone not null default now()
);

create table metsavahennykset (
  id uuid not null default extensions.uuid_generate_v4(),
  asiakas_id uuid not null,
  metsatila_id uuid not null,
  verovuosi smallint not null,
  kaytettava_vahennys numeric not null,
  vahennyksen_jalkeen_kaytetty_yhteensa numeric,
  luonut_kayttaja_id uuid,
  luotu_at timestamp with time zone not null default now()
);

create table investoinnit (
  id uuid not null default extensions.uuid_generate_v4(),
  asiakas_id uuid not null,
  metsatila_id uuid,
  kuvaus text not null,
  hankintapvm date not null,
  hankintahinta numeric not null,
  jaannosarvo numeric not null default 0,
  poistoaika_vuotta smallint not null,
  poistotapa USER-DEFINED not null default 'tasa'::poistotapa,
  aktiivinen boolean not null default true,
  luonut_kayttaja_id uuid,
  luotu_at timestamp with time zone not null default now(),
  muokattu_at timestamp with time zone not null default now()
);

create table poistot (
  id uuid not null default extensions.uuid_generate_v4(),
  investointi_id uuid not null,
  verovuosi smallint not null,
  poistomaara numeric not null,
  jaannosarvo_vuoden_lopussa numeric not null,
  luotu_at timestamp with time zone not null default now()
);

create table tapahtumat (
  id uuid not null default extensions.uuid_generate_v4(),
  asiakas_id uuid not null,
  metsatila_id uuid,
  tyyppi USER-DEFINED not null,
  kuvaus text not null,
  paivamaara date not null,
  summa_alv0 numeric not null,
  alv_prosentti numeric not null default 0,
  alv_euro numeric,
  bruttosumma numeric,
  verovuosi smallint not null,
  kvartaali smallint not null,
  viite text,
  luonut_kayttaja_id uuid,
  luotu_at timestamp with time zone not null default now(),
  muokattu_at timestamp with time zone not null default now(),
  kategoria text,
  ennakko numeric default 0
);

create table arkisto (
  id uuid not null default extensions.uuid_generate_v4(),
  asiakas_id uuid not null,
  verovuosi smallint not null,
  tiedostonimi text not null,
  pdf_data text not null,
  luotu_at timestamp with time zone not null default now(),
  liite_nimi text,
  liite_data text,
  liite_koko integer
);
