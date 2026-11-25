// Imports the Overture-derived listings that the GitHub Action publishes in this repo
// (data/manifest.json + data/places/<ST>.enc.json, encrypted to this project's key) into the database. Called every 10 minutes by pg_cron;
// does nothing until the manifest names a new release, then imports a batch of states per call,
// saving progress after each state. When a release is fully imported, places that dropped out of it
// are flagged "possibly closed". JWT verification stays on (cron sends the public anon key).
import { createClient } from 'npm:@supabase/supabase-js@2';

const RAW = 'https://raw.githubusercontent.com/ckanu13k/diaspora-market-map/main/data';
const BUDGET_MS = 90_000;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

// ── encryption (mirror of scripts/overture/crypto.mjs) ──
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decryptJson(privateJwk: JsonWebKey, env: { ek: string; iv: string; ct: string }) {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, RSA, false, ['unwrapKey']);
  const aes = await crypto.subtle.unwrapKey('raw', unb64(env.ek), priv, RSA, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, aes, unb64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
// The key pair is generated here on first run; the private half never leaves the database.
// deno-lint-ignore no-explicit-any
async function privateKey(db: any): Promise<JsonWebKey> {
  const { data } = await db.from('ingest_keys').select('private_jwk').eq('id', 1).maybeSingle();
  if (data?.private_jwk) return data.private_jwk;
  const kp = await crypto.subtle.generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['wrapKey', 'unwrapKey']) as CryptoKeyPair;
  const row = { id: 1, public_jwk: await crypto.subtle.exportKey('jwk', kp.publicKey), private_jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  await db.from('ingest_keys').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  const again = await db.from('ingest_keys').select('private_jwk').eq('id', 1).single();
  return again.data.private_jwk;
}

Deno.serve(async () => {
  const t0 = Date.now();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const priv = await privateKey(db); // also creates the key pair on the very first run

  const manifest = await fetch(`${RAW}/manifest.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!manifest?.release) return json({ skipped: 'no manifest yet' });
  const states = Object.entries(manifest.counts as Record<string, number>).filter(([, n]) => n > 0).map(([s]) => s).sort();

  const { data: st, error } = await db.from('ingest_state').select('*').eq('id', 1).single();
  if (error) return json({ error: error.message }, 500);

  const done = st.source_release === manifest.release && st.next_index === 0 && st.cycle_completed_at;
  if (done) return json({ skipped: `release ${manifest.release} already imported` });
  // New release (or first run): start a fresh cycle
  let idx: number = st.source_release === manifest.release ? st.next_index : 0;
  let cycleStart: string = idx === 0 ? new Date().toISOString() : st.cycle_started_at;
  let failures: number = idx === 0 ? 0 : st.cycle_failures;
  const log: Record<string, unknown>[] = [];
  const save = (extra: Record<string, unknown> = {}) => db.from('ingest_state').update({
    next_index: idx, cycle_failures: failures, cycle_started_at: cycleStart, source_release: manifest.release,
    last_run_at: new Date().toISOString(), last_log: { release: manifest.release, running: true, log }, ...extra,
  }).eq('id', 1);
  await save({ cycle_completed_at: null });

  while (idx < states.length && Date.now() - t0 < BUDGET_MS) {
    const s = states[idx];
    try {
      const file = await fetch(`${RAW}/places/${s}${manifest.encrypted ? '.enc' : ''}.json`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      const rows = manifest.encrypted ? await decryptJson(priv, file) : file;
      for (let i = 0; i < rows.length; i += 250) {
        const { error: e } = await db.rpc('ingest_places', { rows: rows.slice(i, i + 250), src: 'overture' });
        if (e) throw new Error(e.message);
      }
      log.push({ state: s, places: rows.length });
    } catch (e) {
      failures++;
      log.push({ state: s, error: (e as Error).message });
    }
    idx++;
    await save();
  }

  if (idx >= states.length) {
    let flagged = null;
    if (failures === 0) {
      const { data } = await db.rpc('mark_missing_source', { src: 'overture', cutoff: cycleStart });
      flagged = data;
    }
    idx = 0;
    await db.from('ingest_state').update({
      next_index: 0, cycle_failures: failures, cycle_completed_at: new Date().toISOString(), last_run_at: new Date().toISOString(),
      // a failed state leaves source_release unset so the next call retries the whole release
      source_release: failures === 0 ? manifest.release : null,
      last_log: { release: manifest.release, running: false, log, flagged_possibly_closed: flagged },
    }).eq('id', 1);
    return json({ release: manifest.release, complete: true, failures, flagged, log });
  }
  await db.from('ingest_state').update({ last_log: { release: manifest.release, running: false, log } }).eq('id', 1);
  return json({ release: manifest.release, next_state: states[idx], log });
});
