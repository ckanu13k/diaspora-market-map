// Cloudflare Pages Function: serves the map snapshot (data/places.v3.json) from Cloudflare's edge cache,
// rebuilding it from Supabase at most every 10 minutes per data center. Visitors never wait on the
// database, and the map is never more than ~10 minutes behind (the in-app delta closes the rest).
// If Supabase is unreachable it falls through to the static copy made at build time.
import { COLS, FILE, FORMAT, encodeRow } from '../../src/lib/snapshot-format.js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../src/lib/public-config.js';

const PAGE = 1000;
const TTL = 600;

async function buildSnapshot() {
  const rows = [];
  let startedAt = null;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/places?select=${COLS.join(',')}&status=neq.removed&order=id`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    startedAt ??= Date.parse(res.headers.get('date') ?? new Date().toUTCString());
    const page = await res.json();
    for (const p of page) rows.push(encodeRow(p));
    if (page.length < PAGE) break;
  }
  return { v: FORMAT, generated_at: new Date().toISOString(), watermark: new Date(startedAt - 60_000).toISOString(), rows };
}

export async function onRequestGet(context) {
  if (context.params.file !== FILE) return context.next();
  const cache = caches.default;
  const cacheKey = new Request(new URL(`/data/${FILE}`, context.request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    const body = JSON.stringify(await buildSnapshot());
    const res = new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=300, s-maxage=${TTL}`,
        'Access-Control-Allow-Origin': '*',
      },
    });
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch {
    return context.next(); // static snapshot from the last build
  }
}
