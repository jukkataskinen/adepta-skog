-- 0016: tositteiden tunnistuksen ehdotus toiminnoittain (DECISIONS 2.10.2026, maatalouden kirjanpito).
--
-- Kirjanpito näytetään toiminnoittain (metsätalous, maatalous), ja kumpikin
-- näkymä käsittelee vain oman toimintonsa ehdotukset. Kesken olevalla
-- tunnistuksella activity on näkymä, josta tunnistus aloitettiin (oletus
-- epäselville tositteille). Valmis ehdotus jaetaan rivien luokan mukaan:
-- tositteella voi olla yksi odottava ehdotus kummallekin toiminnolle.
--
-- Vanhat ehdotukset ovat metsätaloutta, koska tunnistus ehdotti vain
-- metsätalouden luokkia. Oletusarvo ei kirjoita rivejä uudelleen, joten
-- suljettujen vuosien lukitus ei laukea.

alter table sk_receipt_suggestions
  add column activity text not null default 'forestry' check (activity in ('forestry', 'agriculture'));

drop index sk_receipt_suggestions_one_pending;
create unique index sk_receipt_suggestions_one_pending on sk_receipt_suggestions (document_id, activity) where status = 'pending';
