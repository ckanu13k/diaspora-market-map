-- A site that doesn't answer is kept the first week (small hosts often block datacenter traffic)
-- and dropped if it is still unreachable the following week.
create or replace function public.website_two_strikes() returns trigger
language plpgsql as $$
begin
  if new.website_status = 'unreachable' and old.website_status in ('unreachable', 'unreachable_twice') then
    new.website_dropped := coalesce(new.website, old.website, old.website_dropped);
    new.website := null;
    new.menu_url := null;
    new.website_status := 'unreachable_twice';
  end if;
  return new;
end $$;
drop trigger if exists place_details_two_strikes on public.place_details;
create trigger place_details_two_strikes before update of website_status on public.place_details
  for each row execute function public.website_two_strikes();
