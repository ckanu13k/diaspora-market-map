-- Run once in the Supabase SQL Editor (not a migration: pg_cron/pg_net exist only on Supabase).
-- Calls the ingest-osm Edge Function every 10 minutes; the function itself throttles and
-- idles between weekly cycles, so most calls return immediately.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('ingest-osm') where exists (select 1 from cron.job where jobname = 'ingest-osm');
select cron.schedule(
  'ingest-osm',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://isvunzeeanjvczcowses.supabase.co/functions/v1/ingest-osm',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 150000
     ) $$
);
