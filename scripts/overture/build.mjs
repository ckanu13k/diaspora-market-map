// raw JSONL from extract.py → data/places/<ST>.enc.json (encrypted) + data/manifest.json (counts only).
// Contact details never land in the public repo in plain text: each state's file is encrypted with the
// public key held in Supabase (see supabase/migrations/20261125000000_ingest_keys.sql).
// Usage: node scripts/overture/build.mjs RAW.jsonl
//   env: PUBLIC_KEY_FILE=path.jwk.json to skip fetching the key (tests/local runs)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createOverture, STATES } from './core.mjs';
import { encryptJson } from './crypto.mjs';
import { checkWebsites } from '../web/check.mjs';

const raw = process.argv[2];
const root = new URL('../../', import.meta.url);
const taxonomy = JSON.parse(readFileSync(new URL('shared/taxonomy.json', root), 'utf8'));
const { toRow } = createOverture(taxonomy);
let release = 'unknown';
try { release = readFileSync(`${raw}.release`, 'utf8').trim(); } catch { /* local run */ }

async function publicKey() {
  if (process.env.PUBLIC_KEY_FILE) return JSON.parse(readFileSync(process.env.PUBLIC_KEY_FILE, 'utf8'));
  const envText = readFileSync(new URL('.env.production', root), 'utf8');
  const url = envText.match(/^VITE_SUPABASE_URL=(.*)$/m)[1].trim();
  const key = envText.match(/^VITE_SUPABASE_ANON_KEY=(.*)$/m)[1].trim();
  const res = await fetch(`${url}/rest/v1/rpc/ingest_public_key`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`Could not fetch the ingest public key: HTTP ${res.status} ${await res.text()}`);
  const jwk = await res.json();
  if (!jwk?.n) throw new Error('No ingest key yet: run the ingest-places function once so it generates its key pair');
  return jwk;
}

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

const sorted = Object.fromEntries(STATES.map((s) => [s, [...byState[s].values()].sort((a, b) => a.source_ref.localeCompare(b.source_ref))]));

// Weekly website check (GitHub Actions sets WEB_CHECK=1). WEB_STATES=TX,GA limits it for trial runs.
if (process.env.WEB_CHECK === '1') {
  const only = process.env.WEB_STATES ? new Set(process.env.WEB_STATES.split(',').map((x) => x.trim().toUpperCase())) : null;
  const rows = STATES.filter((s) => !only || only.has(s)).flatMap((s) => sorted[s]);
  console.log(`website check: ${rows.filter((r) => r.website).length} sites across ${rows.length} places`);
  const t0 = Date.now();
  const summary = await checkWebsites(rows, { concurrency: Number(process.env.WEB_CONCURRENCY ?? 24) });
  // Totals only: the repo (and its logs) are public, so no business names or addresses here
  console.log(`website check done in ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(summary, null, 1));
  if (process.env.WEB_REPORT_KEY) {
    // Per-site detail for tuning, readable only by whoever holds the matching private key
    const report = rows.filter((r) => r._check?.original).map((r) => ({ name: r.name, kind: r.kind, city: r.city, state: r.state, phone: r.phone,
      original: r._check.original, website: r.website, status: r.website_status, reason: r._check.reason, match: r._check.match,
      menu_url: r.menu_url, items: r.items?.length ?? 0, items_from: r._check.items_from, sample: (r.items ?? []).slice(0, 4), error: r._check.extract_error }));
    writeFileSync('/tmp/web-report.enc.json', JSON.stringify(await encryptJson(JSON.parse(process.env.WEB_REPORT_KEY), { summary, report })));
    console.log('encrypted report written to /tmp/web-report.enc.json');
  }
  for (const r of rows) delete r._check;
  if (process.env.DRY_RUN === '1') { console.log('dry run: not writing data files'); process.exit(0); }
}

// Version = Overture release + hash of the plaintext, so unchanged data doesn't trigger a re-import
const hash = createHash('sha256');
for (const s of STATES) hash.update(JSON.stringify(sorted[s]));
const version = `${release}+${hash.digest('hex').slice(0, 10)}`;

const manifestPath = new URL('data/manifest.json', root);
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
if (previous?.release === version && previous?.encrypted) {
  console.log(`release ${version} unchanged; leaving files as they are`);
  process.exit(0);
}

const pub = await publicKey();
const outDir = new URL('data/places/', root);
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(new URL(f, outDir));
const counts = {};
for (const s of STATES) {
  counts[s] = sorted[s].length;
  writeFileSync(new URL(`${s}.enc.json`, outDir), JSON.stringify(await encryptJson(pub, sorted[s])));
}
const kinds = { market: 0, restaurant: 0 };
for (const s of STATES) for (const r of sorted[s]) kinds[r.kind]++;
writeFileSync(manifestPath, JSON.stringify({ source: 'overture', release: version, overture_release: release, encrypted: true, total: kept, kinds, counts }, null, 1));
console.log(`release ${version}: ${kept} places kept of ${total} candidates, encrypted`, kinds);
