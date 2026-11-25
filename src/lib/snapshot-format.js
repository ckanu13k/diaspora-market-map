// Compact row format shared by scripts/snapshot.mjs (writer) and src/lib/data.ts (reader).
// Plain JS so Node can import it without a build step.
export const COLS = ['id', 'name', 'kind', 'origins', 'regions', 'city', 'state', 'lat', 'lng', 'status', 'verification',
  'verified_at', 'featured', 'confirm_count', 'accurate_votes', 'inaccurate_votes', 'last_confirmed_at', 'source', 'updated_at'];

/** @param {Record<string, unknown>} p */
export function encodeRow(p) {
  return COLS.map((c) => {
    const v = p[c];
    if (c === 'origins' || c === 'regions') return Array.isArray(v) ? v.join(',') : '';
    if (c === 'featured') return v ? 1 : 0;
    if (c === 'lat' || c === 'lng') return Math.round(Number(v) * 1e5) / 1e5;
    return v ?? null;
  });
}

/** @param {unknown[]} r */
export function decodeRow(r) {
  /** @type {Record<string, unknown>} */
  const o = {};
  COLS.forEach((c, i) => {
    const v = r[i];
    if (c === 'origins' || c === 'regions') o[c] = v ? String(v).split(',') : [];
    else if (c === 'featured') o[c] = v === 1;
    else o[c] = v;
  });
  o.osm_id = null;
  return o;
}
