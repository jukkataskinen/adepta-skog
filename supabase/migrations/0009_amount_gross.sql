-- 0009: kirjauksen summa arvonlisäveron kanssa (DECISIONS 28.9.2026).
--
-- Käyttäjä syöttää kuitin summan eli brutton. Veroton summa (amount_net) säilyy,
-- koska verolaskenta käyttää sitä, mutta se lasketaan aina bruttosta triggerillä:
--   amount_net = round(amount_gross / (1 + vat_rate/100), 2)
-- Arvonlisävero on amount_gross - amount_net. Sama sääntö on ohjelmassa
-- (src/lib/tax/amounts.ts), jotta esikatselu ja kanta täsmäävät.
--
-- Jos lisäys tai päivitys antaa vain verottoman summan (vanhat skriptit ja
-- testit), brutto lasketaan siitä kuten vanha sovellus sen näytti:
--   amount_gross = amount_net + round(amount_net * vat_rate/100, 2)
-- Tästä saatu brutto antaa takaisin saman verottoman summan, koska ero on alle
-- puoli senttiä. Siksi olemassa olevat rivit eivät muutu.

alter table sk_transactions add column amount_gross numeric(14,2);

-- Suljettujen vuosien rivit saavat bruttosumman, vaikka lukitus muuten estää
-- muutokset. Veroton summa ei muutu, joten kirjanpito pysyy samana. Aikaleima
-- jätetään ennalleen, koska kukaan ei muuttanut kirjausta.
alter table sk_transactions disable trigger sk_transactions_year_open;
alter table sk_transactions disable trigger sk_transactions_touch;
update sk_transactions set amount_gross = amount_net + round(amount_net * vat_rate / 100, 2);
alter table sk_transactions enable trigger sk_transactions_year_open;
alter table sk_transactions enable trigger sk_transactions_touch;

alter table sk_transactions alter column amount_gross set not null;

create or replace function sk_transaction_amounts() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Päivitys, joka muuttaa vain verotonta summaa, laskee brutton siitä.
  if tg_op = 'UPDATE' and new.amount_gross is not distinct from old.amount_gross
     and new.amount_net is distinct from old.amount_net then
    new.amount_gross := null;
  end if;
  if new.amount_gross is null then
    if new.amount_net is null then
      raise exception 'Summa puuttuu' using errcode = '23502';
    end if;
    new.amount_gross := new.amount_net + round(new.amount_net * new.vat_rate / 100, 2);
  end if;
  new.amount_net := round(new.amount_gross * 100 / (100 + new.vat_rate), 2);
  return new;
end $$;

create trigger sk_transactions_amounts before insert or update on sk_transactions
  for each row execute function sk_transaction_amounts();

-- Varmistus: veroton summa vastaa aina bruttoa ja verokantaa.
alter table sk_transactions add constraint sk_transactions_net_matches_gross
  check (amount_net = round(amount_gross * 100 / (100 + vat_rate), 2));

-- Julkiselle roolille ei oikeuksia (kuten 0003).
revoke all on function sk_transaction_amounts() from anon, public;
