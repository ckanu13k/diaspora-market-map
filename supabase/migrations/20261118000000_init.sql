-- Diaspora Market Map — initial schema
-- Public map data lives in `places`. Full details (address, phone, hours, website)
-- live in `place_details`, which nobody can SELECT directly: they are served only
-- through get_place_details(), which enforces the free daily quota / premium plan.

-- ───────────────────────── Types ─────────────────────────
create type public.place_kind as enum ('market', 'restaurant');
create type public.place_status as enum ('active', 'possibly_closed', 'closed', 'removed');
create type public.verification_level as enum ('listed', 'community', 'verified');

-- ───────────────────────── Tables ─────────────────────────
create table public.places (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  kind                   public.place_kind not null,
  origins                text[] not null default '{}',
  regions                text[] not null default '{}',
  city                   text,
  state                  text not null check (char_length(state) = 2),
  lat                    double precision not null check (lat between -90 and 90),
  lng                    double precision not null check (lng between -180 and 180),
  status                 public.place_status not null default 'active',
  status_reason          text,                       -- missing_from_source | user_reports | admin
  verification           public.verification_level not null default 'listed',
  verified_at            timestamptz,
  featured               boolean not null default false,
  confirm_count          int not null default 0,     -- "still open" confirmations, last 90 days
  last_confirmed_at      timestamptz,
  source                 text not null default 'osm' check (source in ('osm', 'community', 'owner', 'admin')),
  osm_id                 text unique,                -- e.g. node/123456
  last_seen_in_source_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index places_state_idx   on public.places (state);
create index places_status_idx  on public.places (status);
create index places_origins_idx on public.places using gin (origins);

create table public.place_details (
  place_id          uuid primary key references public.places (id) on delete cascade,
  street            text,
  postcode          text,
  phone             text,
  website           text,
  opening_hours     text,
  instagram         text,
  facebook          text,
  description       text,
  services          text[] not null default '{}',   -- delivery, takeaway, catering, halal …
  verification_note text,
  locked            boolean not null default false, -- true once an admin edits/verifies: ingestion won't overwrite
  updated_at        timestamptz not null default now()
);

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text,
  plan               text not null default 'free' check (plan in ('free', 'premium')),
  plan_interval      text,
  plan_expires_at    timestamptz,
  stripe_customer_id text unique,
  is_admin           boolean not null default false,
  created_at         timestamptz not null default now()
);

create table public.detail_views (
  user_id  uuid not null references auth.users (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete cascade,
  day      date not null default ((now() at time zone 'utc')::date),
  primary key (user_id, place_id, day)
);

create table public.favorites (
  user_id    uuid not null references auth.users (id) on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table public.confirmations (
  user_id      uuid not null references auth.users (id) on delete cascade,
  place_id     uuid not null references public.places (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid references public.places (id) on delete cascade,  -- null for new-place suggestions
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('closed', 'moved', 'wrong_info', 'new_place', 'other')),
  message     text check (char_length(message) <= 2000),
  payload     jsonb not null default '{}',
  status      text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index reports_status_idx on public.reports (status, created_at desc);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.free_daily_quota() returns int
language sql immutable as $$ select 5 $$;

create or replace function public.utc_today() returns date
language sql stable as $$ select (now() at time zone 'utc')::date $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_premium() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and plan = 'premium'
      and (plan_expires_at is null or plan_expires_at > now())
  )
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create trigger places_touch  before update on public.places        for each row execute function public.touch_updated_at();
create trigger details_touch before update on public.place_details for each row execute function public.touch_updated_at();

-- New auth user → profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- "Still open" confirmations → community verification, and revive possibly-closed places
create or replace function public.recompute_confirmations() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := coalesce(new.place_id, old.place_id);
  n   int;
  last_at timestamptz;
begin
  select count(*), max(confirmed_at) into n, last_at
  from public.confirmations
  where place_id = pid and confirmed_at > now() - interval '90 days';

  update public.places p set
    confirm_count     = n,
    last_confirmed_at = last_at,
    verification      = case when p.verification = 'listed' and n >= 3 then 'community'::public.verification_level else p.verification end,
    status            = case when p.status = 'possibly_closed' and n > 0 and last_at > now() - interval '1 day' then 'active'::public.place_status else p.status end,
    status_reason     = case when p.status = 'possibly_closed' and n > 0 and last_at > now() - interval '1 day' then null else p.status_reason end
  where p.id = pid;
  return null;
end $$;

create trigger confirmations_recompute
  after insert or update or delete on public.confirmations
  for each row execute function public.recompute_confirmations();

-- Two distinct users reporting "closed" → flag as possibly closed
create or replace function public.apply_closed_reports() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'closed' and new.place_id is not null then
    if (select count(distinct user_id) from public.reports
        where place_id = new.place_id and kind = 'closed' and status = 'open') >= 2 then
      update public.places set status = 'possibly_closed', status_reason = 'user_reports'
      where id = new.place_id and status = 'active';
    end if;
  end if;
  return null;
end $$;

create trigger reports_closed_flag
  after insert on public.reports for each row execute function public.apply_closed_reports();

-- ───────────────────────── Metered details (the paywall) ─────────────────────────
create or replace function public.get_place_details(p_place uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  prem  boolean;
  used  int;
  quota int := public.free_daily_quota();
  d     jsonb;
begin
  if uid is null then
    return jsonb_build_object('error', 'auth_required');
  end if;

  prem := public.is_premium() or public.is_admin();

  if not prem then
    if not exists (select 1 from public.detail_views
                   where user_id = uid and place_id = p_place and day = public.utc_today()) then
      select count(*) into used from public.detail_views where user_id = uid and day = public.utc_today();
      if used >= quota then
        return jsonb_build_object('error', 'quota_exceeded', 'used', used, 'quota', quota);
      end if;
      insert into public.detail_views (user_id, place_id) values (uid, p_place) on conflict do nothing;
    end if;
  end if;

  select to_jsonb(pd) - 'locked' into d from public.place_details pd where pd.place_id = p_place;
  select count(*) into used from public.detail_views where user_id = uid and day = public.utc_today();

  return jsonb_build_object(
    'details', coalesce(d, '{}'::jsonb),
    'premium', prem,
    'used', used,
    'quota', case when prem then null else quota end
  );
end $$;

create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plan',            case when public.is_premium() then 'premium' else 'free' end,
    'plan_interval',   p.plan_interval,
    'plan_expires_at', p.plan_expires_at,
    'is_admin',        p.is_admin,
    'has_billing',     p.stripe_customer_id is not null,
    'used_today',      (select count(*) from public.detail_views v where v.user_id = p.id and v.day = public.utc_today()),
    'quota',           public.free_daily_quota()
  )
  from public.profiles p where p.id = auth.uid()
$$;

-- ───────────────────────── Ingestion (service role only) ─────────────────────────
-- rows: [{osm_id,name,kind,origins,regions,city,state,lat,lng,street,postcode,phone,website,
--         opening_hours,instagram,facebook,services}]
create or replace function public.ingest_osm_places(rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  pid uuid;
  inserted int := 0;
  updated  int := 0;
  was_insert boolean;
begin
  for r in select * from jsonb_array_elements(rows) loop
    insert into public.places as p (osm_id, name, kind, origins, regions, city, state, lat, lng, source, last_seen_in_source_at)
    values (
      r->>'osm_id', r->>'name', (r->>'kind')::public.place_kind,
      coalesce(array(select jsonb_array_elements_text(r->'origins')), '{}'),
      coalesce(array(select jsonb_array_elements_text(r->'regions')), '{}'),
      r->>'city', r->>'state', (r->>'lat')::float8, (r->>'lng')::float8, 'osm', now()
    )
    on conflict (osm_id) do update set
      -- admin-locked places keep their curated name/location; everything gets last_seen refreshed
      name     = case when exists (select 1 from public.place_details d where d.place_id = p.id and d.locked) then p.name else excluded.name end,
      kind     = case when exists (select 1 from public.place_details d where d.place_id = p.id and d.locked) then p.kind else excluded.kind end,
      origins  = case when exists (select 1 from public.place_details d where d.place_id = p.id and d.locked) then p.origins else excluded.origins end,
      regions  = case when exists (select 1 from public.place_details d where d.place_id = p.id and d.locked) then p.regions else excluded.regions end,
      city     = coalesce(excluded.city, p.city),
      lat      = case when exists (select 1 from public.place_details d where d.place_id = p.id and d.locked) then p.lat else excluded.lat end,
      lng      = case when exists (select 1 from public.place_details d where d.place_id = p.id and d.locked) then p.lng else excluded.lng end,
      last_seen_in_source_at = now(),
      status        = case when p.status = 'possibly_closed' and p.status_reason = 'missing_from_source' then 'active'::public.place_status else p.status end,
      status_reason = case when p.status = 'possibly_closed' and p.status_reason = 'missing_from_source' then null else p.status_reason end
    returning id, (xmax = 0) into pid, was_insert;

    if was_insert then inserted := inserted + 1; else updated := updated + 1; end if;

    insert into public.place_details as d (place_id, street, postcode, phone, website, opening_hours, instagram, facebook, services)
    values (
      pid, r->>'street', r->>'postcode', r->>'phone', r->>'website', r->>'opening_hours',
      r->>'instagram', r->>'facebook',
      coalesce(array(select jsonb_array_elements_text(r->'services')), '{}')
    )
    on conflict (place_id) do update set
      street        = excluded.street,
      postcode      = excluded.postcode,
      phone         = excluded.phone,
      website       = excluded.website,
      opening_hours = excluded.opening_hours,
      instagram     = excluded.instagram,
      facebook      = excluded.facebook,
      services      = excluded.services
    where not d.locked;
  end loop;

  return jsonb_build_object('inserted', inserted, 'updated', updated);
end $$;

-- Places that vanished from OpenStreetMap since `cutoff` are flagged (never deleted).
-- Admin-verified places are left alone; a human vouched for them.
create or replace function public.mark_missing_osm(cutoff timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.places
  set status = 'possibly_closed', status_reason = 'missing_from_source'
  where source = 'osm' and status = 'active' and verification <> 'verified'
    and last_seen_in_source_at < cutoff;
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────── Admin actions ─────────────────────────
create or replace function public.admin_verify_place(p_place uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.places set verification = 'verified', verified_at = now(),
    status = 'active', status_reason = null where id = p_place;
  insert into public.place_details (place_id, verification_note, locked) values (p_place, p_note, true)
  on conflict (place_id) do update set verification_note = coalesce(p_note, public.place_details.verification_note), locked = true;
end $$;

create or replace function public.admin_set_status(p_place uuid, p_status public.place_status) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.places set status = p_status, status_reason = 'admin' where id = p_place;
end $$;

-- Approve a "new_place" suggestion → creates a community place
create or replace function public.admin_approve_new_place(p_report uuid, p_lat float8, p_lng float8) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rep public.reports;
  pl  jsonb;
  pid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into rep from public.reports where id = p_report and kind = 'new_place' and status = 'open';
  if not found then raise exception 'report not found or not open'; end if;
  pl := rep.payload;

  insert into public.places (name, kind, origins, regions, city, state, lat, lng, source, verification, verified_at)
  values (
    pl->>'name', coalesce(pl->>'kind', 'restaurant')::public.place_kind,
    coalesce(array(select jsonb_array_elements_text(pl->'origins')), '{}'),
    coalesce(array(select jsonb_array_elements_text(pl->'regions')), '{}'),
    pl->>'city', upper(pl->>'state'), p_lat, p_lng, 'community', 'verified', now()
  ) returning id into pid;

  insert into public.place_details (place_id, street, postcode, phone, website, opening_hours, instagram, description, locked)
  values (pid, pl->>'street', pl->>'postcode', pl->>'phone', pl->>'website', pl->>'opening_hours',
          pl->>'instagram', pl->>'description', true);

  update public.reports set status = 'resolved', resolved_at = now(), place_id = pid where id = p_report;
  return pid;
end $$;

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.places        enable row level security;
alter table public.place_details enable row level security;
alter table public.profiles      enable row level security;
alter table public.detail_views  enable row level security;
alter table public.favorites     enable row level security;
alter table public.confirmations enable row level security;
alter table public.reports       enable row level security;

-- places: everyone can read the map layer; only admins write
create policy places_read  on public.places for select using (status <> 'removed' or public.is_admin());
create policy places_admin on public.places for all    using (public.is_admin()) with check (public.is_admin());

-- place_details: admins only (everyone else goes through get_place_details)
create policy details_admin on public.place_details for all using (public.is_admin()) with check (public.is_admin());

-- profiles: read your own; nobody can self-upgrade (writes come from the Stripe webhook via service role)
create policy profiles_self  on public.profiles for select using (id = auth.uid() or public.is_admin());

-- detail_views: read your own usage
create policy views_self on public.detail_views for select using (user_id = auth.uid());

-- favorites: premium feature
create policy fav_read   on public.favorites for select using (user_id = auth.uid());
create policy fav_insert on public.favorites for insert with check (user_id = auth.uid() and (public.is_premium() or public.is_admin()));
create policy fav_delete on public.favorites for delete using (user_id = auth.uid());

-- confirmations: any signed-in user, one row per user/place (upsert to refresh)
create policy conf_read   on public.confirmations for select using (user_id = auth.uid());
create policy conf_insert on public.confirmations for insert with check (user_id = auth.uid());
create policy conf_update on public.confirmations for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reports: signed-in users file; admins triage
create policy reports_insert on public.reports for insert with check (user_id = auth.uid() and status = 'open');
create policy reports_read   on public.reports for select using (user_id = auth.uid() or public.is_admin());
create policy reports_admin  on public.reports for update using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── Privileges ─────────────────────────
-- Explicit grants (newer Supabase projects can be created with auto-grant off). RLS above still decides row access.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

revoke execute on function public.ingest_osm_places(jsonb)      from public, anon, authenticated;
revoke execute on function public.mark_missing_osm(timestamptz) from public, anon, authenticated;
grant  execute on function public.ingest_osm_places(jsonb)      to service_role;
grant  execute on function public.mark_missing_osm(timestamptz) to service_role;
