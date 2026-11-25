-- The map's public layer says whether a place has a menu / product list in the app (item_count,
-- items_updated_at, already kept by refresh_place_item_summary) and whether its own menu page is
-- linked (menu_link), so lists can show a sign beside the name before anyone opens the place.
alter table public.places add column if not exists menu_link boolean not null default false;

create or replace function public.sync_menu_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.places set menu_link = (new.menu_url is not null)
  where id = new.place_id and menu_link is distinct from (new.menu_url is not null);
  return null;
end $$;
drop trigger if exists place_details_menu_link on public.place_details;
create trigger place_details_menu_link after insert or update of menu_url, website on public.place_details
  for each row execute function public.sync_menu_link();
update public.places p set menu_link = true from public.place_details d where d.place_id = p.id and d.menu_url is not null and not p.menu_link;

-- These now show on the map's list, so a change to them counts as a change to the place
drop trigger if exists places_touch on public.places;
create trigger places_touch before update on public.places for each row
  when ((old.name, old.kind, old.origins, old.regions, old.city, old.state, old.lat, old.lng, old.status,
         old.verification, old.verified_at, old.featured, old.confirm_count, old.last_confirmed_at,
         old.accurate_votes, old.inaccurate_votes, old.item_count, old.items_updated_at, old.menu_link)
        is distinct from
        (new.name, new.kind, new.origins, new.regions, new.city, new.state, new.lat, new.lng, new.status,
         new.verification, new.verified_at, new.featured, new.confirm_count, new.last_confirmed_at,
         new.accurate_votes, new.inaccurate_votes, new.item_count, new.items_updated_at, new.menu_link))
  execute function public.touch_updated_at();
