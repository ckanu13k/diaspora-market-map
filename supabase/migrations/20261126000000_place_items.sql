-- Menus (restaurants) and product lists (markets), kept current by the community.
--
-- • Items are written only through upsert_place_item / remove_place_item, which stamp who
--   changed what (place_item_edits) and rate-limit edits per user.
-- • Prices, stock and descriptions come back with get_place_details, so they follow the same
--   free-daily-view / Premium rules as the rest of a place's details.
-- • Item names are searchable by anyone (search_items) so "where can I buy egusi?" works on the
--   map, but prices stay behind the details gate.
-- • "Still right / Changed" votes count only since the item was last edited: an edit supersedes
--   older votes. Items with more "changed" than "still right" votes (and at least 3) hide
--   themselves until someone updates them or an admin restores them.

create table public.place_items (
  id                uuid primary key default gen_random_uuid(),
  place_id          uuid not null references public.places (id) on delete cascade,
  section           text not null default '' check (char_length(section) <= 40),
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  description       text check (char_length(description) <= 200),
  price_cents       int check (price_cents between 0 and 100000),
  price_unit        text check (char_length(price_unit) <= 20),     -- each, lb, bag, plate…
  available         boolean not null default true,                  -- false = out of stock / off the menu for now
  source            text not null default 'community' check (source in ('community', 'owner', 'admin')),
  created_by        uuid references auth.users (id) on delete set null,
  updated_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  confirm_count     int not null default 0,
  changed_count     int not null default 0,
  hidden            boolean not null default false,
  hidden_reason     text                                            -- votes | admin
);
create unique index place_items_unique_name on public.place_items (place_id, lower(btrim(name)), coalesce(lower(price_unit), ''));
create index place_items_place_idx on public.place_items (place_id) where not hidden;
create index place_items_name_idx  on public.place_items (lower(name)) where not hidden;

create table public.place_item_votes (
  item_id  uuid not null references public.place_items (id) on delete cascade,
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vote     smallint not null check (vote in (-1, 1)),
  voted_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table public.place_item_edits (
  id         bigint generated always as identity primary key,
  item_id    uuid not null,
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null check (action in ('add', 'update', 'remove', 'hide', 'restore')),
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index place_item_edits_user_day on public.place_item_edits (user_id, created_at desc);
create index place_item_edits_recent   on public.place_item_edits (created_at desc);

-- Per-place summary for list rows and badges (not part of the map snapshot)
alter table public.places add column if not exists item_count       int not null default 0;
alter table public.places add column if not exists items_updated_at timestamptz;

create or replace function public.item_edit_limit() returns int language sql immutable as $$ select 60 $$;

create or replace function public.refresh_place_item_summary(p_place uuid) returns void
language sql security definer set search_path = public as $$
  update public.places p set
    item_count       = (select count(*) from public.place_items i where i.place_id = p_place and not i.hidden),
    items_updated_at = (select max(greatest(i.updated_at, i.last_confirmed_at)) from public.place_items i
                        where i.place_id = p_place and not i.hidden)
  where p.id = p_place
$$;

-- Votes → counts, freshness, auto-hide
create or replace function public.recompute_item_votes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  iid uuid := coalesce(new.item_id, old.item_id);
  pid uuid;
begin
  update public.place_items i set
    confirm_count = (select count(*) from public.place_item_votes v where v.item_id = iid and v.vote = 1  and v.voted_at >= i.updated_at),
    changed_count = (select count(*) from public.place_item_votes v where v.item_id = iid and v.vote = -1 and v.voted_at >= i.updated_at),
    last_confirmed_at = greatest(i.updated_at, coalesce((select max(v.voted_at) from public.place_item_votes v
                                                          where v.item_id = iid and v.vote = 1 and v.voted_at >= i.updated_at), i.updated_at))
  where i.id = iid
  returning place_id into pid;

  update public.place_items i set hidden = true, hidden_reason = 'votes'
  where i.id = iid and not i.hidden and i.changed_count >= 3 and i.changed_count > i.confirm_count;

  if pid is not null then perform public.refresh_place_item_summary(pid); end if;
  return null;
end $$;
create trigger place_item_votes_recompute after insert or update or delete on public.place_item_votes
  for each row execute function public.recompute_item_votes();
create trigger place_item_votes_touch before update on public.place_item_votes
  for each row execute function public.touch_vote();

-- Add or edit an item. p_id null = add (or update the same-named item if it already exists).
create or replace function public.upsert_place_item(
  p_place uuid, p_name text, p_section text default '', p_description text default null,
  p_price_cents int default null, p_price_unit text default null, p_available boolean default true,
  p_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  adm    boolean := public.is_admin();
  edits  int;
  cur    public.place_items;
  res    public.place_items;
  nm     text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  sec    text := btrim(coalesce(p_section, ''));
  unit   text := nullif(lower(btrim(coalesce(p_price_unit, ''))), '');
  descr  text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  if not exists (select 1 from public.places where id = p_place and status <> 'removed') then
    return jsonb_build_object('error', 'not_found');
  end if;
  if char_length(nm) < 1 or char_length(nm) > 80 then return jsonb_build_object('error', 'bad_name'); end if;
  if not adm then
    select count(*) into edits from public.place_item_edits where user_id = uid and created_at > now() - interval '1 day';
    if edits >= public.item_edit_limit() then return jsonb_build_object('error', 'rate_limited'); end if;
  end if;

  if p_id is not null then
    select * into cur from public.place_items where id = p_id and place_id = p_place;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
  else
    select * into cur from public.place_items
    where place_id = p_place and lower(btrim(name)) = lower(nm) and coalesce(lower(price_unit), '') = coalesce(unit, '');
  end if;

  if cur.id is null then
    insert into public.place_items (place_id, section, name, description, price_cents, price_unit, available,
                                    source, created_by, updated_by)
    values (p_place, sec, nm, descr, p_price_cents, unit, coalesce(p_available, true),
            case when adm then 'admin' else 'community' end, uid, uid)
    returning * into res;
    insert into public.place_item_edits (item_id, place_id, user_id, action, after)
    values (res.id, p_place, uid, 'add', to_jsonb(res));
  else
    update public.place_items set
      section = sec, name = nm, description = descr, price_cents = p_price_cents, price_unit = unit,
      available = coalesce(p_available, true), updated_by = uid, updated_at = now(), last_confirmed_at = now(),
      confirm_count = 0, changed_count = 0, hidden = false, hidden_reason = null,
      source = case when adm then 'admin' else source end
    where id = cur.id
    returning * into res;
    insert into public.place_item_edits (item_id, place_id, user_id, action, before, after)
    values (res.id, p_place, uid, 'update', to_jsonb(cur), to_jsonb(res));
  end if;

  perform public.refresh_place_item_summary(p_place);
  return jsonb_build_object('item', to_jsonb(res) - 'created_by' - 'updated_by');
exception when unique_violation then
  return jsonb_build_object('error', 'duplicate');
end $$;

-- Remove an item: the person who added it (within a day) or an admin. Everyone else votes "Changed".
create or replace function public.remove_place_item(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur public.place_items;
begin
  if uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  select * into cur from public.place_items where id = p_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not (public.is_admin() or (cur.created_by = uid and cur.created_at > now() - interval '1 day')) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  delete from public.place_items where id = p_id;
  insert into public.place_item_edits (item_id, place_id, user_id, action, before)
  values (p_id, cur.place_id, uid, 'remove', to_jsonb(cur));
  perform public.refresh_place_item_summary(cur.place_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_item_hidden(p_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cur public.place_items;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.place_items set hidden = p_hidden, hidden_reason = case when p_hidden then 'admin' end,
    -- restoring clears the votes that hid it
    updated_at = case when p_hidden then updated_at else now() end,
    confirm_count = case when p_hidden then confirm_count else 0 end,
    changed_count = case when p_hidden then changed_count else 0 end
  where id = p_id returning * into cur;
  if cur.id is null then return; end if;
  insert into public.place_item_edits (item_id, place_id, user_id, action, after)
  values (p_id, cur.place_id, auth.uid(), case when p_hidden then 'hide' else 'restore' end, to_jsonb(cur));
  perform public.refresh_place_item_summary(cur.place_id);
end $$;

-- Admin review queue: items people say have changed, and recent edits
create or replace function public.admin_item_queue() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'flagged', coalesce((select jsonb_agg(x order by x->>'updated_at' desc) from (
        select to_jsonb(i) || jsonb_build_object('place_name', p.name, 'city', p.city, 'state', p.state) x
        from public.place_items i join public.places p on p.id = i.place_id
        where i.changed_count > 0 or i.hidden
        order by i.updated_at desc limit 200) q), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', e.id, 'action', e.action, 'created_at', e.created_at, 'place_id', e.place_id,
               'place_name', p.name, 'user_email', pr.email,
               'name', coalesce(e.after->>'name', e.before->>'name'),
               'before_price', e.before->'price_cents', 'after_price', e.after->'price_cents',
               'item_id', e.item_id) x
        from public.place_item_edits e
        join public.places p on p.id = e.place_id
        left join public.profiles pr on pr.id = e.user_id
        order by e.created_at desc limit 100) q), '[]'::jsonb)
  );
end $$;

-- Public product search: names and places only (prices stay behind the details gate)
create or replace function public.search_items(q text, p_state text default null, lim int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('place_id', place_id, 'items', items)), '[]'::jsonb)
  from (
    select i.place_id, jsonb_agg(i.name order by i.name) items
    from public.place_items i join public.places p on p.id = i.place_id
    where not i.hidden and i.available and p.status <> 'removed'
      and char_length(btrim(q)) >= 2
      and lower(i.name) like '%' || lower(replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_')) || '%'
      and (p_state is null or p.state = upper(p_state))
    group by i.place_id
    limit least(greatest(lim, 1), 200)
  ) s
$$;

-- Details now include the menu / product list
create or replace function public.get_place_details(p_place uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  prem  boolean;
  used  int;
  quota int := public.free_daily_quota();
  d     jsonb;
  items jsonb;
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
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'section', i.section, 'name', i.name, 'description', i.description,
           'price_cents', i.price_cents, 'price_unit', i.price_unit, 'available', i.available,
           'source', i.source, 'updated_at', i.updated_at, 'last_confirmed_at', i.last_confirmed_at,
           'confirm_count', i.confirm_count, 'changed_count', i.changed_count,
           'mine', i.created_by = uid and i.created_at > now() - interval '1 day')
         order by i.section, lower(i.name)), '[]'::jsonb)
    into items
  from public.place_items i where i.place_id = p_place and not i.hidden;
  select count(*) into used from public.detail_views where user_id = uid and day = public.utc_today();

  return jsonb_build_object(
    'details', coalesce(d, '{}'::jsonb),
    'items', items,
    'premium', prem,
    'used', used,
    'quota', case when prem then null else quota end
  );
end $$;

-- ── Access
alter table public.place_items      enable row level security;
alter table public.place_item_votes enable row level security;
alter table public.place_item_edits enable row level security;
-- place_items / place_item_edits: no direct reads or writes (RPCs above only); admins can read edits
create policy item_edits_admin on public.place_item_edits for select using (public.is_admin());
create policy item_votes_read   on public.place_item_votes for select using (user_id = auth.uid() or public.is_admin());
create policy item_votes_insert on public.place_item_votes for insert with check (user_id = auth.uid());
create policy item_votes_update on public.place_item_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy item_votes_delete on public.place_item_votes for delete using (user_id = auth.uid());

revoke all on public.place_items, public.place_item_edits from anon, authenticated;
grant select on public.place_item_edits to authenticated;
revoke all on public.place_item_votes from anon;
grant select, insert, update, delete on public.place_item_votes to authenticated;
grant all on public.place_items, public.place_item_votes, public.place_item_edits to service_role;

revoke execute on function public.upsert_place_item(uuid, text, text, text, int, text, boolean, uuid) from public, anon;
revoke execute on function public.remove_place_item(uuid) from public, anon;
grant  execute on function public.upsert_place_item(uuid, text, text, text, int, text, boolean, uuid) to authenticated;
grant  execute on function public.remove_place_item(uuid) to authenticated;
revoke execute on function public.refresh_place_item_summary(uuid) from public, anon, authenticated;
grant  execute on function public.search_items(text, text, int) to anon, authenticated;
