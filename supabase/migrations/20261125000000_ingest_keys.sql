-- Key pair that protects the weekly listings files in the public GitHub repo.
-- The ingest-places Edge Function generates it on first run and keeps the private key here
-- (no policies: only the service role can read it). The GitHub Action fetches the public key
-- through ingest_public_key() and encrypts each state's file before committing it.
create table if not exists public.ingest_keys (
  id          int primary key default 1 check (id = 1),
  public_jwk  jsonb not null,
  private_jwk jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.ingest_keys enable row level security;
revoke all on public.ingest_keys from anon, authenticated;

create or replace function public.ingest_public_key() returns jsonb
language sql stable security definer set search_path = public as $$
  select public_jwk from public.ingest_keys where id = 1
$$;
grant execute on function public.ingest_public_key() to anon, authenticated;
