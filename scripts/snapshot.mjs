// Build-time snapshot of the public map layer → public/data/places.json (served by the GitHub Pages CDN).
// Visitors download this one compressed file instead of paging the database, then ask Supabase only for
// rows changed after `watermark`. Run by the deploy workflow (hourly + on every push).
// Usage: node scripts/snapshot.mjs   (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from env or .env.production)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { COLS, encodeRow } from '../src/lib/snapshot-format.js';

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
let maxUpdated = '1970-01-01T00:00:00Z';
for (let from = 0; ; from += PAGE) {
  const res = await fetch(`${url}/rest/v1/places?select=${COLS.join(',')}&status=neq.removed&order=id`, {
    headers: { apikey: key, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const page = await res.json();
  for (const p of page) {
    rows.push(encodeRow(p));
    if (p.updated_at > maxUpdated) maxUpdated = p.updated_at;
  }
  if (page.length < PAGE) break;
}

// 2-minute safety margin: rows committed while we were paging get re-sent in the delta (harmless)
const watermark = new Date(Date.parse(maxUpdated) - 120_000).toISOString();
const out = { v: 1, generated_at: new Date().toISOString(), watermark, cols: COLS, rows };
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
const body = JSON.stringify(out);
writeFileSync(new URL('../public/data/places.json', import.meta.url), body);
console.log(`snapshot: ${rows.length} places, ${(body.length / 1024).toFixed(0)} KB raw, watermark ${watermark}`);
