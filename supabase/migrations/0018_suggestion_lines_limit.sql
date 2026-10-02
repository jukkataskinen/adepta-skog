-- 0018: tunnistuksen ehdotuksessa enintään 1000 riviä (DECISIONS 2.10.2026,
-- maatalouden tositteiden tunnistus).
--
-- Maatilan koko vuoden aineisto on 150–300 sivua, ja siitä tulee helposti yli
-- 400 kirjausehdotusta (kuukausittaiset meijerin ja teurastamon tilitykset
-- vähennyksineen, tukien maksut ja laskut). Raja 400 (0012) katkaisi
-- ylimenevät rivit ilman ilmoitusta. Vain tarkistusehto muuttuu: tauluun,
-- oikeuksiin ja lukitukseen ei tule muutoksia, ja olemassa olevat rivit
-- täyttävät uuden ehdon.

alter table sk_receipt_suggestions drop constraint sk_receipt_suggestions_lines_check;
alter table sk_receipt_suggestions add constraint sk_receipt_suggestions_lines_check
  check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between (case when status = 'processing' then 0 else 1 end) and 1000);
