-- 0001 Perusta: organisaatiot (kirjanpitotoimistot), käyttäjät, jäsenyydet,
-- tapahtumaloki ja RLS-apufunktiot.
--
-- Sama malli kuin eRapussa ja Mittarilukemassa: sovellus kutsuu kantaa aina
-- roolilla `authenticated` ja käyttäjän JWT-väitteellä `sub`, joten RLS on
-- todellinen suojaus. Selaimeen ei anneta Supabasen avaimia lainkaan
-- (DECISIONS 26.9.2026).

create or replace function sk_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Organisaatiot ja käyttäjät
-- ---------------------------------------------------------------------------
create table sk_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_id text unique,
  contact_email text,
  contact_phone text,
  postal_street text,
  postal_code text,
  postal_city text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sk_users (
  id uuid primary key default gen_random_uuid(),
  auth_sub text not null unique,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sk_users_email_lower on sk_users (lower(email));

-- owner = pääkäyttäjä (kaikki asiakkaat, käyttäjät, verovuoden sulkeminen),
-- staff = kirjanpitäjä (asiakkaat, joiden vastuukirjanpitäjä hän on).
create table sk_org_members (
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  user_id uuid not null references sk_users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Tapahtumaloki
-- ---------------------------------------------------------------------------
create table sk_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index sk_audit_log_org_created on sk_audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS-apufunktiot
-- ---------------------------------------------------------------------------
create or replace function sk_current_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from sk_users where auth_sub = (auth.jwt() ->> 'sub')
$$;

create or replace function sk_my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organization_id from sk_org_members where user_id = sk_current_user_id()
$$;

create or replace function sk_has_org_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sk_org_members
    where organization_id = org and user_id = sk_current_user_id() and role = any(roles)
  )
$$;

grant execute on function sk_current_user_id() to authenticated, service_role;
grant execute on function sk_my_org_ids() to authenticated, service_role;
grant execute on function sk_has_org_role(uuid, text[]) to authenticated, service_role;

-- Viittauksen on osoitettava saman organisaation riviin. RLS rajaa rivit
-- organisaatioittain, mutta viiteavain ei estä toisen organisaation
-- tunnisteen käyttöä; tämä estää. Käyttö myöhemmissä migraatioissa:
--   create trigger ... before insert or update on sk_x
--     for each row execute function sk_check_same_org('sk_parent', 'parent_id');
create or replace function sk_check_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_org uuid;
begin
  -- Sarake luetaan jsonb:n kautta, koska sama funktio palvelee eri tauluja.
  execute format('select organization_id from %I where id = $1', tg_argv[0]) into parent_org
    using (to_jsonb(new) ->> tg_argv[1])::uuid;
  if parent_org is not null and parent_org <> new.organization_id then
    raise exception 'Viittaus toisen organisaation riviin' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table sk_organizations enable row level security;
alter table sk_users enable row level security;
alter table sk_org_members enable row level security;
alter table sk_audit_log enable row level security;

create policy org_members_read on sk_organizations for select to authenticated
  using (id in (select sk_my_org_ids()));
create policy org_owner_update on sk_organizations for update to authenticated
  using (sk_has_org_role(id, array['owner'])) with check (sk_has_org_role(id, array['owner']));

create policy user_self on sk_users for select to authenticated
  using (id = sk_current_user_id());
create policy user_self_update on sk_users for update to authenticated
  using (id = sk_current_user_id()) with check (id = sk_current_user_id());
create policy user_same_org on sk_users for select to authenticated
  using (id in (select user_id from sk_org_members where organization_id in (select sk_my_org_ids())));

create policy members_read on sk_org_members for select to authenticated
  using (organization_id in (select sk_my_org_ids()));
create policy members_owner_write on sk_org_members for all to authenticated
  using (sk_has_org_role(organization_id, array['owner']))
  with check (sk_has_org_role(organization_id, array['owner']));

create policy audit_read on sk_audit_log for select to authenticated
  using (sk_has_org_role(organization_id, array['owner']));
create policy audit_insert on sk_audit_log for insert to authenticated
  with check (user_id = sk_current_user_id() and organization_id in (select sk_my_org_ids()));

grant select, update on sk_organizations to authenticated;
grant select, update on sk_users to authenticated;
grant select, insert, update, delete on sk_org_members to authenticated;
grant select, insert on sk_audit_log to authenticated;
grant all on sk_organizations, sk_users, sk_org_members, sk_audit_log to service_role;

create trigger sk_organizations_touch before update on sk_organizations for each row execute function sk_touch_updated_at();
create trigger sk_users_touch before update on sk_users for each row execute function sk_touch_updated_at();
