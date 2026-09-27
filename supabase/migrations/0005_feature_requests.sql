-- 0005 Kehitystoiveet (Mittarilukemasta, sen 0025).
--
-- Käyttäjä jättää kehitystoiveen ja valitsee toiminnon, jota toive koskee
-- (ohjesivuston aiheet, src/lib/help/topics.ts), jotta toiveet ryhmittyvät
-- samoin kuin ohjeet ja sivut. Toiveen voi jättää suoraan sivun yläkulmasta,
-- jolloin toiminto ja sivu täyttyvät valmiiksi.
--
-- Kaikki toimiston käyttäjät näkevät toimiston toiveet ja voivat jättää omia.
-- Tilaa ja vastausta muuttaa vain pääkäyttäjä: kirjanpitäjä ei merkitse
-- toisen toivetta tehdyksi (DECISIONS 27.9.2026).
--
-- sk_check_same_org-triggeriä ei tarvita: taulu viittaa vain käyttäjiin
-- (sk_users), joilla ei ole organisaatiota. Jättäjän jäsenyyden varmistaa
-- lisäyssääntö (created_by = kirjautunut käyttäjä ja oma organisaatio).
create table sk_feature_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  created_by uuid not null references sk_users(id) on delete restrict,
  -- Toiminnon tunnus ohjesivustolta (esim. "kirjanpito") tai "muu".
  feature text not null,
  -- Sivu, jolta toive jätettiin (esim. /asiakkaat/<id>/kirjanpito); osoitteissa on vain tunnisteita, ei henkilötietoja.
  page_path text,
  title text not null check (length(title) between 1 and 200),
  description text not null check (length(description) between 1 and 5000),
  importance text not null default 'nice' check (importance in ('nice', 'important', 'blocking')),
  status text not null default 'new' check (status in ('new', 'planned', 'in_progress', 'done', 'declined')),
  response text check (length(response) <= 5000),
  handled_by uuid references sk_users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sk_feature_requests_org on sk_feature_requests (organization_id, status, created_at desc);

alter table sk_feature_requests enable row level security;
create policy members_read on sk_feature_requests for select to authenticated
  using (organization_id in (select sk_my_org_ids()));
-- Jäsen jättää toiveen omissa nimissään.
create policy members_insert on sk_feature_requests for insert to authenticated
  with check (organization_id in (select sk_my_org_ids()) and created_by = sk_current_user_id());
create policy owner_update on sk_feature_requests for update to authenticated
  using (sk_has_org_role(organization_id, array['owner']))
  with check (sk_has_org_role(organization_id, array['owner']));
create policy owner_delete on sk_feature_requests for delete to authenticated
  using (sk_has_org_role(organization_id, array['owner']));

-- 0003 poisti anon-oikeudet vain silloin olemassa olleilta tauluilta.
revoke all on sk_feature_requests from anon;
grant select, insert, update, delete on sk_feature_requests to authenticated;
grant all on sk_feature_requests to service_role;

create trigger sk_feature_requests_touch before update on sk_feature_requests
  for each row execute function sk_touch_updated_at();
