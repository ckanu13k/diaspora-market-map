-- Progress bookmark for the in-Supabase OpenStreetMap import (supabase/functions/ingest-osm).
create table public.ingest_state (
  id                 int primary key default 1 check (id = 1),
  next_index         int not null default 0,
  cycle_failures     int not null default 0,
  cycle_started_at   timestamptz,
  cycle_completed_at timestamptz,
  last_run_at        timestamptz,
  last_log           jsonb
);
insert into public.ingest_state (id) values (1);
alter table public.ingest_state enable row level security;
create policy ingest_state_admin on public.ingest_state for select using (public.is_admin());
revoke all on public.ingest_state from anon, authenticated;
grant select on public.ingest_state to authenticated;
