// Scheduled OpenStreetMap import, run inside Supabase (pg_cron → this function every 10 min).
// Each call imports a few states within the time budget and remembers where it stopped.
// After all 50 states + DC are done, it flags places that vanished from OSM and idles
// until a week after the cycle started, so the map refreshes weekly without hammering Overpass.
// JWT verification stays on (the cron sends the public anon key); a server-side throttle stops callers from forcing extra runs.
import { createClient } from 'npm:@supabase/supabase-js@2';

declare const createOsm: (t: unknown) => {
  STATES: string[];
  overpassQuery: (s: string) => string;
  toRow: (el: unknown, s: string) => Record<string, unknown> | null;
};
declare const TAXONOMY: unknown;

const osm = createOsm(TAXONOMY);
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const START_NEW_STATE_BEFORE_MS = 75_000; // edge functions get ~150 s wall clock
const MIN_GAP_MS = 8 * 60_000;
const CYCLE_EVERY_MS = 7 * 24 * 3600_000;
const STALE_AFTER_MS = 14 * 24 * 3600_000;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function overpass(state: string, attempt: number) {
  const res = await fetch(OVERPASS[attempt % OVERPASS.length], {
    method: 'POST',
    body: new URLSearchParams({ data: osm.overpassQuery(state) }),
    headers: { 'User-Agent': 'diaspora-market-map/1.0 (github.com/ckanu13k/diaspora-market-map)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return ((await res.json()).elements ?? []) as unknown[];
}

Deno.serve(async () => {
  const t0 = Date.now();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: st, error } = await db.from('ingest_state').select('*').eq('id', 1).single();
  if (error) return json({ error: error.message }, 500);
  const now = Date.now();
  if (st.last_run_at && now - Date.parse(st.last_run_at) < MIN_GAP_MS) return json({ skipped: 'ran recently' }, 429);
  if (st.next_index === 0 && st.cycle_started_at && now - Date.parse(st.cycle_started_at) < CYCLE_EVERY_MS && st.cycle_completed_at)
    return json({ skipped: 'weekly cycle complete', next_cycle_at: new Date(Date.parse(st.cycle_started_at) + CYCLE_EVERY_MS) });

  await db.from('ingest_state').update({ last_run_at: new Date().toISOString() }).eq('id', 1);

  let idx: number = st.next_index;
  let failures: number = st.cycle_failures;
  let cycleStart: string = idx === 0 ? new Date().toISOString() : st.cycle_started_at;
  let completedAt: string | null = idx === 0 ? null : st.cycle_completed_at;
  const log: unknown[] = [];

  while (Date.now() - t0 < START_NEW_STATE_BEFORE_MS) {
    const state = osm.STATES[idx];
    try {
      let els: unknown[] | null = null;
      for (let a = 0; a < 2 && !els; a++) {
        try { els = await overpass(state, a); } catch (e) { if (a === 1) throw e; }
      }
      const rows = [...new Map(els!.map((e) => osm.toRow(e, state)).filter(Boolean).map((r) => [r!.osm_id, r])).values()];
      for (let i = 0; i < rows.length; i += 200) {
        const { error: e } = await db.rpc('ingest_osm_places', { rows: rows.slice(i, i + 200) });
        if (e) throw new Error(e.message);
      }
      log.push({ state, places: rows.length });
    } catch (e) {
      failures++;
      log.push({ state, error: (e as Error).message });
    }
    idx++;
    if (idx >= osm.STATES.length) {
      let flagged = null;
      if (failures === 0) {
        const { data } = await db.rpc('mark_missing_osm', { cutoff: new Date(Date.now() - STALE_AFTER_MS).toISOString() });
        flagged = data;
      }
      log.push({ cycle_complete: true, failures, flagged_possibly_closed: flagged });
      idx = 0;
      failures = 0;
      completedAt = new Date().toISOString();
      break;
    }
  }

  await db.from('ingest_state').update({
    next_index: idx, cycle_failures: failures, cycle_started_at: cycleStart, cycle_completed_at: completedAt,
    last_log: log,
  }).eq('id', 1);
  return json({ log, next_state: idx === 0 ? null : osm.STATES[idx] });
});
