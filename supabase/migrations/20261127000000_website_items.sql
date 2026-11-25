-- Weekly website check results + menus / product lists imported from vendors' own websites.
-- See scripts/web/check.mjs. Only free, machine-readable sources are imported (schema.org menu data,
-- Shopify and WooCommerce store feeds). Everything else gets a link to the vendor's menu page.
-- People's edits always win: website items are only ever added, refreshed or removed when nobody
-- has touched them, and editing one turns it into a community item.

alter table public.place_details add column if not exists website_status     text;  -- ok | social | thin | not_checked_* | parked | placeholder | closed_notice | mismatch | dead_dns | …
alter table public.place_details add column if not exists website_checked_at date;
alter table public.place_details add column if not exists website_dropped    text;  -- the address we stopped showing, for admin review
alter table public.place_details add column if not exists menu_url           text;  -- direct link to their menu / shop page
alter table public.place_details add column if not exists items_source_url   text;  -- where imported items came from

alter table public.place_items drop constraint if exists place_items_source_check;
alter table public.place_items add constraint place_items_source_check check (source in ('community', 'owner', 'admin', 'website'));

create or replace function public.ingest_website_items(p_place uuid, p_items jsonb, p_checked timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  it    jsonb;
  nm    text;
  unit  text;
  sec   text;
  cents int;
  avail boolean;
  cur   public.place_items;
  keep  text[] := '{}';
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    nm := btrim(regexp_replace(coalesce(it->>'name', ''), '\s+', ' ', 'g'));
    continue when char_length(nm) < 1 or char_length(nm) > 80;
    unit  := nullif(lower(btrim(coalesce(it->>'price_unit', ''))), '');
    unit  := case when char_length(unit) <= 20 then unit end;
    sec   := left(btrim(coalesce(it->>'section', '')), 40);
    cents := case when (it->>'price_cents') ~ '^\d{1,6}$' and (it->>'price_cents')::int <= 100000 then (it->>'price_cents')::int end;
    avail := coalesce((it->>'available')::boolean, true);
    cur := null;
    select * into cur from public.place_items
    where place_id = p_place and lower(btrim(name)) = lower(nm) and coalesce(lower(price_unit), '') = coalesce(unit, '');
    continue when cur.id is not null and cur.source <> 'website';   -- someone edited it: theirs wins
    keep := keep || (lower(nm) || '|' || coalesce(unit, ''));
    if cur.id is null then
      insert into public.place_items (place_id, section, name, price_cents, price_unit, available, source, created_at, updated_at, last_confirmed_at)
      values (p_place, sec, nm, cents, unit, avail, 'website', p_checked, p_checked, p_checked);
    elsif cur.price_cents is distinct from cents or cur.available is distinct from avail or cur.section is distinct from sec then
      -- the website changed: new details, fresh votes
      update public.place_items set section = sec, price_cents = cents, available = avail, updated_at = p_checked,
        last_confirmed_at = p_checked, confirm_count = 0, changed_count = 0,
        hidden = case when hidden_reason = 'admin' then hidden else false end,
        hidden_reason = case when hidden_reason = 'admin' then hidden_reason end
      where id = cur.id;
    else
      update public.place_items set last_confirmed_at = greatest(last_confirmed_at, p_checked) where id = cur.id;
    end if;
  end loop;
  -- gone from their website → gone from ours (only items that came from the website)
  delete from public.place_items
  where place_id = p_place and source = 'website'
    and not ((lower(btrim(name)) || '|' || coalesce(lower(price_unit), '')) = any (keep));
  perform public.refresh_place_item_summary(p_place);
end $$;

create or replace function public.ingest_places(rows jsonb, src text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; pid uuid; was_insert boolean; is_locked boolean;
  inserted int := 0; updated int := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    select p.id, coalesce(d.locked, false) into pid, is_locked
    from public.places p left join public.place_details d on d.place_id = p.id
    where p.source_ref = r->>'source_ref';

    if pid is null then
      insert into public.places (source_ref, source, name, kind, origins, regions, city, state, lat, lng, source_confidence, last_seen_in_source_at)
      values (r->>'source_ref', src, r->>'name', (r->>'kind')::public.place_kind,
        coalesce(array(select jsonb_array_elements_text(r->'origins')), '{}'),
        coalesce(array(select jsonb_array_elements_text(r->'regions')), '{}'),
        r->>'city', r->>'state', (r->>'lat')::float8, (r->>'lng')::float8, (r->>'confidence')::real, now())
      returning id into pid;
      inserted := inserted + 1;
      is_locked := false;
    else
      update public.places p set
        name    = case when is_locked then p.name    else r->>'name' end,
        kind    = case when is_locked then p.kind    else (r->>'kind')::public.place_kind end,
        origins = case when is_locked then p.origins else coalesce(array(select jsonb_array_elements_text(r->'origins')), '{}') end,
        regions = case when is_locked then p.regions else coalesce(array(select jsonb_array_elements_text(r->'regions')), '{}') end,
        city    = case when is_locked then p.city    else coalesce(r->>'city', p.city) end,
        lat     = case when is_locked then p.lat     else (r->>'lat')::float8 end,
        lng     = case when is_locked then p.lng     else (r->>'lng')::float8 end,
        source_confidence = (r->>'confidence')::real,
        last_seen_in_source_at = now(),
        status        = case when p.status = 'possibly_closed' and p.status_reason = 'missing_from_source' then 'active'::public.place_status else p.status end,
        status_reason = case when p.status = 'possibly_closed' and p.status_reason = 'missing_from_source' then null else p.status_reason end
      where p.id = pid;
      updated := updated + 1;
    end if;

    if not is_locked then
      insert into public.place_details as d (place_id, street, postcode, phone, website, opening_hours, instagram, facebook, services,
                                             website_status, website_checked_at, website_dropped, menu_url, items_source_url)
      values (pid, r->>'street', r->>'postcode', r->>'phone', r->>'website', r->>'opening_hours', r->>'instagram', r->>'facebook',
              coalesce(array(select jsonb_array_elements_text(r->'services')), '{}'),
              r->>'website_status', (r->>'website_checked_at')::date, r->>'website_dropped', r->>'menu_url', r->>'items_url')
      on conflict (place_id) do update set
        street = excluded.street, postcode = excluded.postcode, phone = excluded.phone, website = excluded.website,
        opening_hours = coalesce(excluded.opening_hours, d.opening_hours), instagram = excluded.instagram,
        facebook = excluded.facebook, services = excluded.services,
        -- rows from a run without the website check leave the earlier results alone
        website_status     = case when r ? 'website_status' then excluded.website_status     else d.website_status end,
        website_checked_at = case when r ? 'website_status' then excluded.website_checked_at else d.website_checked_at end,
        website_dropped    = case when r ? 'website_status' then excluded.website_dropped    else d.website_dropped end,
        menu_url           = case when r ? 'website_status' then excluded.menu_url           else d.menu_url end,
        items_source_url   = case when r ? 'website_status' then excluded.items_source_url   else d.items_source_url end
      where not d.locked;
      if r ? 'items' then
        perform public.ingest_website_items(pid, r->'items', coalesce((r->>'website_checked_at')::date, current_date)::timestamptz);
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', inserted, 'updated', updated);
end $$;


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
      source = case when adm then 'admin' else 'community' end   -- a person's edit takes it over from the website copy
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


-- Admin: what the website check found that needs a human
create or replace function public.admin_website_report() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(s, n) from (
        select coalesce(website_status, 'not_checked_yet') s, count(*) n from public.place_details
        where website is not null or website_dropped is not null group by 1) q), '{}'::jsonb),
    'closed_notice', coalesce((select jsonb_agg(jsonb_build_object('place_id', p.id, 'name', p.name, 'city', p.city, 'state', p.state,
        'status', p.status, 'url', d.website_dropped, 'checked', d.website_checked_at) order by p.state, p.name)
      from public.place_details d join public.places p on p.id = d.place_id
      where d.website_status = 'closed_notice' and p.status in ('active', 'possibly_closed')), '[]'::jsonb),
    'items', (select jsonb_build_object('places', count(distinct place_id), 'items', count(*)) from public.place_items where source = 'website')
  );
end $$;

revoke execute on function public.ingest_website_items(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant  execute on function public.ingest_website_items(uuid, jsonb, timestamptz) to service_role;
revoke execute on function public.ingest_places(jsonb, text) from public, anon, authenticated;
grant  execute on function public.ingest_places(jsonb, text) to service_role;
revoke execute on function public.upsert_place_item(uuid, text, text, text, int, text, boolean, uuid) from public, anon;
grant  execute on function public.upsert_place_item(uuid, text, text, text, int, text, boolean, uuid) to authenticated;
revoke execute on function public.admin_website_report() from public, anon;
grant  execute on function public.admin_website_report() to authenticated;
