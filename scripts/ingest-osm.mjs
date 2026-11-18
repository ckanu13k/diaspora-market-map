// Weekly ingestion: OpenStreetMap (Overpass API) → Supabase, for all 50 states + DC.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  [optional: STATES=TX,GA  DRY_RUN=1  OVERPASS_URL=...]
import { createClient } from '@supabase/supabase-js';
import { overpassQuery, STATES, toRow } from './osm-lib.mjs';

const OVERPASS = (process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
const DRY = process.env.DRY_RUN === '1';
const only = process.env.STATES?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const states = only?.length ? only : STATES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const supabase = DRY ? null : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function fetchState(state) {
  const body = new URLSearchParams({ data: overpassQuery(state) });
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, { method: 'POST', body, headers: { 'User-Agent': 'diaspora-market-map/1.0 (github.com/ckanu13k/diaspora-market-map)' } });
      if (res.ok) return (await res.json()).elements ?? [];
      console.warn(`  ${state}: ${url} → HTTP ${res.status}, retrying`);
    } catch (e) {
      console.warn(`  ${state}: ${url} → ${e.message}, retrying`);
    }
    await sleep(15000 * (attempt + 1));
  }
  throw new Error(`Overpass failed for ${state}`);
}

const runStarted = new Date();
const failed = [];
let total = 0;

for (const state of states) {
  try {
    const elements = await fetchState(state);
    const rows = [...new Map(elements.map((el) => toRow(el, state)).filter(Boolean).map((r) => [r.osm_id, r])).values()];
    total += rows.length;
    if (DRY) {
      console.log(`${state}: ${rows.length} places`, rows.slice(0, 3).map((r) => `${r.name} [${r.origins}]`).join(' | '));
    } else {
      for (let i = 0; i < rows.length; i += 200) {
        const { data, error } = await supabase.rpc('ingest_osm_places', { rows: rows.slice(i, i + 200) });
        if (error) throw error;
        console.log(`${state}: batch ${i / 200 + 1} → ${JSON.stringify(data)}`);
      }
      if (!rows.length) console.log(`${state}: 0 places`);
    }
  } catch (e) {
    console.error(`✗ ${state}: ${e.message}`);
    failed.push(state);
  }
  await sleep(3000); // be polite to the public Overpass servers
}

console.log(`\nTotal matched: ${total} across ${states.length - failed.length}/${states.length} states`);

// Only flag disappeared places after a complete, all-states run — a partial run would mis-flag.
if (!DRY && !only?.length && failed.length === 0) {
  const cutoff = new Date(runStarted.getTime() - 14 * 24 * 3600 * 1000); // missed two weekly runs
  const { data, error } = await supabase.rpc('mark_missing_osm', { cutoff: cutoff.toISOString() });
  if (error) throw error;
  console.log(`Flagged ${data} places as possibly closed (missing from OSM since ${cutoff.toISOString().slice(0, 10)})`);
}

if (failed.length) {
  console.error(`Failed states: ${failed.join(', ')}`);
  process.exit(1);
}
