-- Show the typical price range (middle 80% of prices) so one 25-litre drum or catering order doesn't stretch it.
create or replace function public.product_overview(p_state text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'label', c.label, 'places', s.places,
           'min_cents', s.min_cents, 'max_cents', s.max_cents) order by s.places desc, c.label), '[]'::jsonb)
  from public.product_catalog c
  join lateral (
    select count(distinct i.place_id) places, percentile_disc(0.1) within group (order by i.price_cents) filter (where i.price_cents > 0) min_cents,
           percentile_disc(0.9) within group (order by i.price_cents) filter (where i.price_cents > 0) max_cents
    from public.place_items i join public.places p on p.id = i.place_id
    where i.product_key = c.key and p.kind = c.kind and not i.hidden and p.status in ('active', 'possibly_closed')
      and (p_state is null or p.state = upper(p_state))
  ) s on s.places > 0
$$;

create or replace function public.compare_prices(p_kind public.place_kind, p_key text, p_lat float8 default null,
  p_lng float8 default null, p_state text default null, lim int default 150) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  prem boolean := public.is_premium() or public.is_admin();
  c    public.product_catalog;
  rows jsonb;
  rng  record;
begin
  select * into c from public.product_catalog where kind = p_kind and key = p_key;
  if c.key is null then return jsonb_build_object('error', 'not_found'); end if;
  select count(distinct i.place_id) places, percentile_disc(0.1) within group (order by i.price_cents) filter (where i.price_cents > 0) min_cents,
         percentile_disc(0.9) within group (order by i.price_cents) filter (where i.price_cents > 0) max_cents
    into rng
  from public.place_items i join public.places p on p.id = i.place_id
  where i.product_key = p_key and p.kind = p_kind and not i.hidden and p.status in ('active', 'possibly_closed')
    and (p_state is null or p.state = upper(p_state));

  select coalesce(jsonb_agg(x order by (x->>'sort_key')::numeric nulls last, (x->>'miles')::numeric nulls last), '[]'::jsonb) into rows
  from (
    select jsonb_build_object(
      'place_id', p.id, 'name', p.name, 'city', p.city, 'state', p.state, 'lat', p.lat, 'lng', p.lng,
      'item', i.name, 'available', i.available, 'checked', i.last_confirmed_at, 'source', i.source,
      'price_cents', case when prem then i.price_cents end,
      'price_unit',  case when prem then i.price_unit end,
      'per_lb_cents', case when prem and i.price_cents > 0 and public.item_pounds(i.name, i.price_unit) > 0
                           then round(i.price_cents / public.item_pounds(i.name, i.price_unit)) end,
      'miles', case when p_lat is not null then round((3958.8 * 2 * asin(sqrt(power(sin(radians(p.lat - p_lat) / 2), 2)
                 + cos(radians(p_lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - p_lng) / 2), 2))))::numeric, 1) end,
      -- Premium: cheapest first (per pound when known); everyone else: nearest first
      'sort_key', case when prem then coalesce(
                    case when i.price_cents > 0 and public.item_pounds(i.name, i.price_unit) > 0 then i.price_cents / public.item_pounds(i.name, i.price_unit) end,
                    i.price_cents::numeric) end
    ) x
    from (
      select distinct on (i.place_id) i.* from public.place_items i
      where i.product_key = p_key and not i.hidden
      -- each place's best deal: in stock first, then cheapest per pound (or per item when no weight)
      order by i.place_id, i.available desc,
        coalesce(case when i.price_cents > 0 and public.item_pounds(i.name, i.price_unit) > 0 then i.price_cents / public.item_pounds(i.name, i.price_unit) end,
                 i.price_cents::numeric) nulls last
    ) i
    join public.places p on p.id = i.place_id
    where p.kind = p_kind and p.status in ('active', 'possibly_closed') and (p_state is null or p.state = upper(p_state))
    order by case when p_lat is not null then power(p.lat - p_lat, 2) + power((p.lng - p_lng) * cos(radians(p_lat)), 2) end nulls last
    limit least(greatest(lim, 1), 500)
  ) q;

  return jsonb_build_object('product', jsonb_build_object('key', c.key, 'kind', c.kind, 'label', c.label),
    'places', rng.places, 'min_cents', rng.min_cents, 'max_cents', rng.max_cents, 'premium', prem, 'rows', rows);
end $$;
