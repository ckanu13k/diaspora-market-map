-- Switch listings source to Overture Maps (permissive licence) — generic source-keyed ingestion.
alter table public.places drop constraint if exists places_source_check;
alter table public.places add constraint places_source_check
  check (source in ('osm', 'overture', 'community', 'owner', 'admin'));
alter table public.places add column if not exists source_ref text unique;   -- e.g. overture:08f2...
alter table public.places add column if not exists source_confidence real;
alter table public.ingest_state add column if not exists source_release text;

-- rows: [{source_ref,name,kind,origins,regions,city,state,lat,lng,street,postcode,phone,website,
--         opening_hours,instagram,facebook,services,confidence}]
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
      insert into public.place_details as d (place_id, street, postcode, phone, website, opening_hours, instagram, facebook, services)
      values (pid, r->>'street', r->>'postcode', r->>'phone', r->>'website', r->>'opening_hours', r->>'instagram', r->>'facebook',
              coalesce(array(select jsonb_array_elements_text(r->'services')), '{}'))
      on conflict (place_id) do update set
        street = excluded.street, postcode = excluded.postcode, phone = excluded.phone, website = excluded.website,
        opening_hours = coalesce(excluded.opening_hours, d.opening_hours), instagram = excluded.instagram,
        facebook = excluded.facebook, services = excluded.services
      where not d.locked;
    end if;
  end loop;
  return jsonb_build_object('inserted', inserted, 'updated', updated);
end $$;

-- After a full import of a new release: anything from this source not seen since `cutoff` is flagged (never deleted).
create or replace function public.mark_missing_source(src text, cutoff timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.places
  set status = 'possibly_closed', status_reason = 'missing_from_source'
  where source = src and status = 'active' and verification <> 'verified'
    and last_seen_in_source_at < cutoff;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.ingest_places(jsonb, text)            from public, anon, authenticated;
revoke execute on function public.mark_missing_source(text, timestamptz) from public, anon, authenticated;
grant  execute on function public.ingest_places(jsonb, text)            to service_role;
grant  execute on function public.mark_missing_source(text, timestamptz) to service_role;
