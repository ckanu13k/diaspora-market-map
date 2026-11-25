// Compact row format shared by scripts/snapshot.mjs (writer) and src/lib/data.ts (reader).
// Plain JS so Node can import it without a build step. Bump FORMAT (and the file name) on any change,
// so a browser holding an older cached file never decodes it with the wrong layout.
export const FORMAT = 2;
export const FILE = `places.v${FORMAT}.json`;

/** Columns requested from the database to build the snapshot. */
export const COLS = ['id', 'name', 'kind', 'origins', 'city', 'state', 'lat', 'lng', 'status', 'verification',
  'verified_at', 'featured', 'confirm_count', 'accurate_votes', 'inaccurate_votes', 'last_confirmed_at', 'source', 'updated_at'];

const KIND = ['market', 'restaurant'];
const STATUS = ['active', 'possibly_closed', 'closed', 'removed'];
const VERIF = ['listed', 'community', 'verified'];
const SOURCE = ['osm', 'overture', 'community', 'owner', 'admin'];
const code = (list, v) => Math.max(0, list.indexOf(v));
const secs = (iso) => (iso ? Math.round(Date.parse(iso) / 1000) : 0);
const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);

/** @param {Record<string, any>} p */
export function encodeRow(p) {
  return [
    p.id, p.name, code(KIND, p.kind), Array.isArray(p.origins) ? p.origins.join(',') : '', p.city ?? '', p.state,
    Math.round(Number(p.lat) * 1e5) / 1e5, Math.round(Number(p.lng) * 1e5) / 1e5,
    code(STATUS, p.status), code(VERIF, p.verification), secs(p.verified_at), p.featured ? 1 : 0,
    p.confirm_count ?? 0, p.accurate_votes ?? 0, p.inaccurate_votes ?? 0, secs(p.last_confirmed_at),
    code(SOURCE, p.source), secs(p.updated_at),
  ];
}

/**
 * @param {any[]} r
 * @param {(origin: string) => string | undefined} regionOf  maps an origin key to its region
 */
export function decodeRow(r, regionOf) {
  const origins = r[3] ? String(r[3]).split(',') : [];
  return {
    id: r[0], name: r[1], kind: KIND[r[2]], origins,
    regions: [...new Set(origins.map(regionOf).filter(Boolean))],
    city: r[4] || null, state: r[5], lat: r[6], lng: r[7], status: STATUS[r[8]], verification: VERIF[r[9]],
    verified_at: iso(r[10]), featured: r[11] === 1, confirm_count: r[12], accurate_votes: r[13], inaccurate_votes: r[14],
    last_confirmed_at: iso(r[15]), source: SOURCE[r[16]], updated_at: iso(r[17]), osm_id: null,
  };
}
