-- 0003 Anon-roolin oikeudet pois.
--
-- Supabase antaa oletuksena roolille anon (julkinen avain) kaikki oikeudet
-- public-skeeman uusiin tauluihin ja funktioihin. Skog ei käytä julkista
-- avainta lainkaan (DECISIONS 26.9.2026), joten oikeudet poistetaan. RLS
-- suojaa taulut jo nyt, mutta migraatiokirjanpidolla sk_schema_migrations ei
-- ole RLS:ää, joten julkisella avaimella olisi voinut muuttaa sitä.

alter table sk_schema_migrations enable row level security;

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'sk\_%' loop
    execute format('revoke all on table %I from anon', r.tablename);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sk\_%' loop
    execute format('revoke all on function %s from anon, public', r.f);
  end loop;
  -- Migraatiokirjanpito vain palvelun roolille.
  revoke all on table sk_schema_migrations from authenticated;
end $$;

-- RLS-apufunktiot on edelleen annettava kirjautuneelle käyttäjälle (0001, 0002).
grant execute on function sk_current_user_id() to authenticated, service_role;
grant execute on function sk_my_org_ids() to authenticated, service_role;
grant execute on function sk_has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function sk_can_access_client(uuid) to authenticated, service_role;
grant execute on function sk_year_is_closed(uuid, integer) to authenticated, service_role;
