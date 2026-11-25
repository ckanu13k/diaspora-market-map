// Build-time snapshot of the public map layer → public/data/places.json (served by the GitHub Pages CDN).
// Visitors download this one compressed file instead of paging the database, then ask Supabase only for
// rows changed after `watermark`. Run by the deploy workflow (hourly + on every push).
// Usage: node scripts/snapshot.mjs   (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from env or .env.production)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { COLS, FILE, FORMAT, encodeRow } from '../src/lib/snapshot-format.js';

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync(new URL('../.env.production', import.meta.url), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m?.[1].trim();
  } catch { return undefined; }
}

const url = env('VITE_SUPABASE_URL');
const key = env('VITE_SUPABASE_ANON_KEY');
if (!url || !key) throw new Error('Missing Supabase URL/key');

const PAGE = 1000;
const rows = [];
let startedAt = null; // database clock at the start, from the first response's Date header
for (let from = 0; ; from += PAGE) {
  const res = await fetch(`${url}/rest/v1/places?select=${COLS.join(',')}&status=neq.removed&order=id`, {
    headers: { apikey: key, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  startedAt ??= Date.parse(res.headers.get('date') ?? new Date().toUTCString());
  const page = await res.json();
  for (const p of page) rows.push(encodeRow(p));
  if (page.length < PAGE) break;
}

// Clients fetch rows changed after `watermark`. Using the snapshot's start time (minus a minute for clock
// skew) means edits made while we were paging are re-sent in the delta, and nothing older is.
const watermark = new Date(startedAt - 60_000).toISOString();
const out = { v: FORMAT, generated_at: new Date().toISOString(), watermark, rows };
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
const body = JSON.stringify(out);
writeFileSync(new URL(`../public/data/${FILE}`, import.meta.url), body);
console.log(`snapshot: ${rows.length} places, ${(body.length / 1024).toFixed(0)} KB raw, watermark ${watermark}`);
