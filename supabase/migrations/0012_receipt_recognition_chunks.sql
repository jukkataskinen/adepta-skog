-- 0012: tositteiden tunnistus osissa (DECISIONS 28.9.2026, tunnistus osissa).
--
-- Koko vuoden tositeaineisto skannataan yhdeksi pitkäksi PDF:ksi, ja se luetaan
-- paloina (8 sivua, 1 sivun limitys). Jokainen pala on oma palvelinkutsunsa, ja
-- selain ohjaa etenemistä. Keskeytyksen jälkeen (sivu suljettu, virhe) tunnistus
-- jatkuu siitä palasta, johon jäätiin, joten palojen tulokset tallennetaan
-- väliaikaisesti ehdotuksen riviin tilalla 'processing'.
--
-- Uutta taulua ei tarvita: kesken oleva tunnistus on tulevan ehdotuksen
-- esivaihe, ja sillä on samat oikeudet, saman asiakkaan tarkistus ja suljetun
-- vuoden lukitus kuin ehdotuksella (0010). Kun kaikki palat on luettu, rivit
-- yhdistetään, tila muuttuu 'pending' ja palojen tulokset tyhjennetään.
--
-- chunks: [{ "first": 1, "last": 8, "status": "waiting|done|failed", "attempts": 0, "lines": [...] }]
-- Rivit ovat tarkistettuja ehdotusrivejä (src/lib/ai/receipts/schema.ts), ei
-- tekoälyn raakavastausta.

alter table sk_receipt_suggestions drop constraint sk_receipt_suggestions_status_check;
alter table sk_receipt_suggestions add constraint sk_receipt_suggestions_status_check
  check (status in ('processing', 'pending', 'accepted', 'dismissed'));

-- Rivejä voi olla satoja (100 sivun skannaus). Kesken olevalla tunnistuksella rivejä ei vielä ole.
alter table sk_receipt_suggestions drop constraint sk_receipt_suggestions_lines_check;
alter table sk_receipt_suggestions add constraint sk_receipt_suggestions_lines_check
  check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between (case when status = 'processing' then 0 else 1 end) and 400);
alter table sk_receipt_suggestions alter column lines set default '[]'::jsonb;

alter table sk_receipt_suggestions
  add column page_count smallint check (page_count is null or page_count between 0 and 2000),
  add column chunks jsonb check (chunks is null or (jsonb_typeof(chunks) = 'array' and jsonb_array_length(chunks) between 1 and 400));

-- Palojen tulokset ovat vain kesken olevalla tunnistuksella.
alter table sk_receipt_suggestions add constraint sk_receipt_suggestions_chunks_processing
  check ((status = 'processing') = (chunks is not null));

-- Tositteella on kerrallaan yksi kesken oleva tunnistus.
create unique index sk_receipt_suggestions_one_processing on sk_receipt_suggestions (document_id) where status = 'processing';
