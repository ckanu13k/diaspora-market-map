-- Catering trays, party packs and wholesale cases aren't comparable with a plate or a bag: leave them out of
-- price comparison (they stay on the place's menu).
create or replace function public.match_product(p_kind public.place_kind, p_name text) returns text
language sql stable set search_path = public as $$
  select case when p_name ~* '\m(trays?|(half|full) pans?|pans? of|party|catering|platters?|feeds|serves \d+|wholesale|bulk|case of|cases?|box of|carton|gallons?|\d+ ?(pcs|pieces|pack|pk|count|ct)\M|dozen)\M' then null
    else (select c.key from public.product_catalog c where c.kind = p_kind and p_name ~* c.pattern order by c.sort limit 1) end
$$;
update public.place_items i set product_key = public.match_product(p.kind, i.name)
from public.places p where p.id = i.place_id and i.product_key is distinct from public.match_product(p.kind, i.name);
