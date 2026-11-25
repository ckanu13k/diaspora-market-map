-- places.updated_at now changes only when something the map shows changes. The weekly listings import
-- refreshes last_seen_in_source_at on every row; without this guard every import would make all
-- 8,000+ rows look "changed" and defeat the cached snapshot + delta loading in the app.
drop trigger if exists places_touch on public.places;
create trigger places_touch before update on public.places for each row
  when ((old.name, old.kind, old.origins, old.regions, old.city, old.state, old.lat, old.lng, old.status,
         old.verification, old.verified_at, old.featured, old.confirm_count, old.last_confirmed_at,
         old.accurate_votes, old.inaccurate_votes)
        is distinct from
        (new.name, new.kind, new.origins, new.regions, new.city, new.state, new.lat, new.lng, new.status,
         new.verification, new.verified_at, new.featured, new.confirm_count, new.last_confirmed_at,
         new.accurate_votes, new.inaccurate_votes))
  execute function public.touch_updated_at();

create index if not exists places_updated_at_idx on public.places (updated_at);
