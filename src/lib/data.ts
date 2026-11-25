// Loads the map layer: one CDN-cached snapshot file, then only the rows changed since it was built.
// Falls back to paging the database directly if the snapshot is missing or unreadable.
import { supabase } from './supabase';
import { PLACE_COLUMNS, type Place } from './types';
// @ts-expect-error plain JS module shared with the Node snapshot script
import { decodeRow, FILE, FORMAT } from './snapshot-format.js';
import { ORIGIN } from './taxonomy';

const PAGE = 1000;

interface Snapshot { v: number; generated_at: string; watermark: string; rows: unknown[][] }
const regionOf = (o: string) => ORIGIN.get(o)?.region;

async function pageAll(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const out: Place[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Place[]));
    if (!data || data.length < PAGE) return out;
  }
}

const fullLoad = () =>
  pageAll((a, b) => supabase.from('places').select(PLACE_COLUMNS).neq('status', 'removed').order('id').range(a, b));

export async function loadPlaces(): Promise<{ places: Place[]; via: 'snapshot' | 'database'; changed: number }> {
  let snap: Snapshot | null = null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${FILE}`);
    if (res.ok) snap = await res.json();
    if (snap?.v !== FORMAT) snap = null;
  } catch { /* offline or missing: fall through */ }

  if (!snap?.rows?.length) return { places: await fullLoad(), via: 'database', changed: 0 };

  const byId = new Map<string, Place>();
  for (const r of snap.rows) {
    const p = decodeRow(r, regionOf) as unknown as Place;
    byId.set(p.id, p);
  }

  // Delta: anything edited, verified, voted on, added or removed since the snapshot
  let changed = 0;
  try {
    const delta = await pageAll((a, b) =>
      supabase.from('places').select(PLACE_COLUMNS).gt('updated_at', snap!.watermark).order('updated_at').range(a, b));
    for (const p of delta) {
      changed++;
      if (p.status === 'removed') byId.delete(p.id);
      else byId.set(p.id, p);
    }
  } catch { /* snapshot alone is still a usable map */ }

  return { places: [...byId.values()], via: 'snapshot', changed };
}
