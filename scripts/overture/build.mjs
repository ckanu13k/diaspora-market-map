// raw JSONL from extract.py → data/places/<ST>.json + data/manifest.json (what Supabase imports)
// Usage: node scripts/overture/build.mjs RAW.jsonl
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createOverture, STATES } from './core.mjs';

const raw = process.argv[2];
const taxonomy = JSON.parse(readFileSync(new URL('../../shared/taxonomy.json', import.meta.url), 'utf8'));
const { toRow } = createOverture(taxonomy);
let release = 'unknown';
try { release = readFileSync(`${raw}.release`, 'utf8').trim(); } catch { /* local run */ }

const byState = Object.fromEntries(STATES.map((s) => [s, new Map()]));
let total = 0, kept = 0;
for (const line of readFileSync(raw, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  total++;
  const row = toRow(JSON.parse(line));
  if (!row) continue;
  byState[row.state].set(row.source_ref, row);
  kept++;
}

const outDir = new URL('../../data/places/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(new URL(f, outDir));
const counts = {};
const hash = createHash('sha256');
for (const s of STATES) {
  const rows = [...byState[s].values()].sort((a, b) => a.source_ref.localeCompare(b.source_ref));
  counts[s] = rows.length;
  const body = JSON.stringify(rows);
  hash.update(body);
  writeFileSync(new URL(`${s}.json`, outDir), body);
}
// `release` changes when either Overture publishes or our filtering changes, so Supabase re-imports.
const version = `${release}+${hash.digest('hex').slice(0, 10)}`;
const kinds = { market: 0, restaurant: 0 };
for (const s of STATES) for (const r of byState[s].values()) kinds[r.kind]++;
writeFileSync(new URL('../../data/manifest.json', import.meta.url),
  JSON.stringify({ source: 'overture', release: version, overture_release: release, total: kept, kinds, counts }, null, 1));
console.log(`release ${version}: ${kept} places kept of ${total} candidates`, kinds);
