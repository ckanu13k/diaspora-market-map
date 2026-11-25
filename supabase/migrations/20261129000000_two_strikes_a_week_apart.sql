-- Two strikes means two weekly checks, not two runs on the same day.
create or replace function public.website_two_strikes() returns trigger
language plpgsql as $$
begin
  if new.website_status = 'unreachable' and old.website_status in ('unreachable', 'unreachable_twice')
     and (old.website_status = 'unreachable_twice' or new.website_checked_at >= old.website_checked_at + 6) then
    new.website_dropped := coalesce(new.website, old.website, old.website_dropped);
    new.website := null;
    new.menu_url := null;
    new.website_status := 'unreachable_twice';
  end if;
  return new;
end $$;

-- Put back links dropped by two checks on the same day (Nov 25, 2026)
alter table public.place_details disable trigger place_details_two_strikes;
update public.place_details
set website = website_dropped, website_dropped = null, website_status = 'unreachable'
where website_status = 'unreachable_twice' and website is null and website_dropped is not null and not locked;
alter table public.place_details enable trigger place_details_two_strikes;
