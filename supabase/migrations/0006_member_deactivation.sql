-- 0006 Käyttäjien kutsu ja käytöstä poisto.
--
-- Jäsenyyttä ei poisteta, vaan se poistetaan käytöstä (deactivated_at), jotta
-- loki, verovuoden sulkijat ja muut viittaukset säilyvät ja jäsenen voi ottaa
-- takaisin käyttöön (DECISIONS 27.9.2026). invited_at kertoo, milloin
-- kutsusähköposti viimeksi lähti.

alter table sk_org_members
  add column invited_at timestamptz,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references sk_users(id) on delete set null;

-- Käytöstä poistettu jäsen ei ole minkään RLS-säännön silmissä jäsen. Kaikki
-- säännöt kulkevat näiden kahden funktion kautta, joten rajaus tehdään tässä
-- yhdessä paikassa eikä jokaisessa säännössä erikseen.
create or replace function sk_my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organization_id from sk_org_members where user_id = sk_current_user_id() and deactivated_at is null
$$;

create or replace function sk_has_org_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sk_org_members
    where organization_id = org and user_id = sk_current_user_id() and role = any(roles) and deactivated_at is null
  )
$$;

-- Vastuukirjanpitäjäksi voi valita vain käytössä olevan jäsenen. Tarkistus
-- tehdään vain, kun vastuukirjanpitäjä vaihtuu: muuten asiakkaan muu muokkaus
-- kaatuisi, jos vanha vastuu on jäänyt käytöstä poistetulle.
create or replace function sk_check_responsible_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.responsible_user_id is not null
     and (tg_op = 'INSERT' or new.responsible_user_id is distinct from old.responsible_user_id)
     and not exists (
       select 1 from sk_org_members
        where organization_id = new.organization_id and user_id = new.responsible_user_id and deactivated_at is null
     ) then
    raise exception 'Vastuukirjanpitäjä ei ole toimiston jäsen tai hänet on poistettu käytöstä' using errcode = '42501';
  end if;
  return new;
end $$;
