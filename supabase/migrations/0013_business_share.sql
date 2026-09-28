-- 0013: metsätalouden osuus kirjauksesta (DECISIONS 28.9.2026, osittain vähennettävä kulu).
--
-- Osa tositteesta voi kuulua muulle toiminnalle, esimerkiksi tiemaksusta vain
-- 50 % metsätaloudelle. Kirjauksen amount_gross ja amount_net ovat edelleen koko
-- tositteen summat (trigger 0009 ei muutu), ja verolaskenta ottaa niistä
-- metsätalouden osuuden yhdellä säännöllä (src/lib/tax/share.ts).
--
-- Oletusarvo 100 ei kirjoita olemassa olevia rivejä uudelleen (Postgres 11+
-- tallentaa oletuksen taulun tietoihin), joten suljettujen vuosien lukitus- ja
-- aikaleimatriggerit eivät laukea, eikä migraatio kaadu suljettuun vuoteen.

alter table sk_transactions
  add column business_share_pct numeric(5,2) not null default 100
    check (business_share_pct > 0 and business_share_pct <= 100);
