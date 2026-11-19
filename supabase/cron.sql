-- Run once in the Supabase SQL Editor (not a migration: pg_cron/pg_net exist only on Supabase).
-- Calls the ingest-places Edge Function (JWT verification on) every 10 minutes; the function does nothing until
-- the GitHub Action publishes a new Overture release in data/manifest.json.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobname) from cron.job where jobname in ('ingest-osm', 'ingest-places');
select cron.schedule(
  'ingest-places',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://isvunzeeanjvczcowses.supabase.co/functions/v1/ingest-places',
       -- public anon key (safe to expose; satisfies the function's JWT check)
       headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdnVuemVlYW5qdmN6Y293c2VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNDc2ODcsImV4cCI6MjExMDYyMzY4N30.vBDyXpYTELamV9weTRviLcOIlkX3npO2dh_ndmDeD88"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 150000
     ) $$
);
