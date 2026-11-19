-- "Are these details correct?" thumbs up / down, one vote per signed-in user per place.
-- Tallies live on places so the map can show them without a join. Votes cast before an admin
-- last verified the place don't count: the admin's check supersedes them.
create table public.detail_votes (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete cascade,
  vote     smallint not null check (vote in (-1, 1)),
  voted_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index detail_votes_place_idx on public.detail_votes (place_id);

alter table public.places add column if not exists accurate_votes   int not null default 0;
alter table public.places add column if not exists inaccurate_votes int not null default 0;

create or replace function public.recompute_detail_votes() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.place_id, old.place_id);
begin
  update public.places p set
    accurate_votes   = (select count(*) from public.detail_votes v where v.place_id = pid and v.vote = 1
                        and v.voted_at >= coalesce(p.verified_at, '-infinity'::timestamptz)),
    inaccurate_votes = (select count(*) from public.detail_votes v where v.place_id = pid and v.vote = -1
                        and v.voted_at >= coalesce(p.verified_at, '-infinity'::timestamptz))
  where p.id = pid;
  return null;
end $$;

create trigger detail_votes_recompute
  after insert or update or delete on public.detail_votes
  for each row execute function public.recompute_detail_votes();

-- Keep the vote time honest: a changed vote counts as a new vote
create or replace function public.touch_vote() returns trigger
language plpgsql as $$ begin new.voted_at := now(); return new; end $$;
create trigger detail_votes_touch before update on public.detail_votes for each row execute function public.touch_vote();

alter table public.detail_votes enable row level security;
create policy votes_read   on public.detail_votes for select using (user_id = auth.uid() or public.is_admin());
create policy votes_insert on public.detail_votes for insert with check (user_id = auth.uid());
create policy votes_update on public.detail_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy votes_delete on public.detail_votes for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.detail_votes to authenticated;
grant all on public.detail_votes to service_role;

-- An admin verification resets the tallies (earlier votes no longer count)
create or replace function public.admin_verify_place(p_place uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.places set verification = 'verified', verified_at = now(),
    status = 'active', status_reason = null, accurate_votes = 0, inaccurate_votes = 0 where id = p_place;
  insert into public.place_details (place_id, verification_note, locked) values (p_place, p_note, true)
  on conflict (place_id) do update set verification_note = coalesce(p_note, public.place_details.verification_note), locked = true;
end $$;
