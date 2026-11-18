// Pure helpers for OpenStreetMap ingestion (no network) — unit-tested in tests/ingest.test.mjs
import { readFileSync } from 'node:fs';

const taxonomy = JSON.parse(readFileSync(new URL('../shared/taxonomy.json', import.meta.url), 'utf8'));
const enabledRegions = new Set(taxonomy.regions.filter((r) => r.enabled).map((r) => r.key));
export const ORIGINS = taxonomy.origins.filter((o) => enabledRegions.has(o.region));
const ORIGIN_BY_KEY = new Map(ORIGINS.map((o) => [o.key, o]));

export const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
  'UT','VT','VA','WA','WV','WI','WY'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cuisineAlt = ORIGINS.map((o) => o.key).join('|');
const keywordList = [...new Set(ORIGINS.flatMap((o) => o.keywords))];
const nameAlt = keywordList.map(esc).join('|');

// Precise (word-boundary) keyword → origin matcher used after Overpass's coarse regex
const KEYWORD_RULES = ORIGINS.flatMap((o) => o.keywords.map((k) => ({ re: new RegExp(`\\b${esc(k)}\\b`, 'i'), origin: o.key })));

const FOOD_SHOPS = 'supermarket|convenience|grocery|greengrocer|deli|butcher|seafood|food|general|variety_store|spices|frozen_food|international|bakery';
const EATERIES = 'restaurant|fast_food|cafe|food_court';

export function overpassQuery(state) {
  const cu = `"cuisine"~"(^|;) *(${cuisineAlt}) *(;|$)",i`;
  const nm = `"name"~"${nameAlt}",i`;
  return `[out:json][timeout:240];
area["ISO3166-2"="US-${state}"]->.s;
(
  nwr["amenity"~"^(${EATERIES})$"][${cu}](area.s);
  nwr["amenity"~"^(${EATERIES})$"][${nm}](area.s);
  nwr["shop"~"^(${FOOD_SHOPS})$"][${nm}](area.s);
  nwr["shop"][${cu}](area.s);
  nwr["shop"]["origin"~"(${cuisineAlt})",i](area.s);
);
out center tags;`;
}

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function normUrl(u) {
  u = clean(u);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { return null; }
}

function social(v, host) {
  v = clean(v);
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${host}/${v.replace(/^@/, '')}`;
}

/** Turn one Overpass element into a row for ingest_osm_places(), or null if it isn't a match. */
export function toRow(el, state) {
  const t = el.tags ?? {};
  const name = clean(t.name);
  if (!name) return null;
  if (t['disused:shop'] || t['disused:amenity'] || t['was:shop'] || t['was:amenity']) return null;

  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;

  const foodShop = t.shop && (FOOD_SHOPS.split('|').includes(t.shop) || t.cuisine || t.origin);
  const kind = t.amenity && EATERIES.split('|').includes(t.amenity) ? 'restaurant' : foodShop ? 'market' : null;
  if (!kind) return null;

  const origins = new Set();
  for (const tok of `${t.cuisine ?? ''};${t.origin ?? ''}`.toLowerCase().split(/[;,]/).map((s) => s.trim())) {
    if (ORIGIN_BY_KEY.has(tok)) origins.add(tok);
  }
  for (const rule of KEYWORD_RULES) if (rule.re.test(name)) origins.add(rule.origin);
  // Specific origin beats the general bucket of the same family
  if ([...origins].some((o) => ORIGIN_BY_KEY.get(o).region !== 'africa_general' && ORIGIN_BY_KEY.get(o).region.endsWith('africa'))) origins.delete('african');
  if ([...origins].some((o) => o !== 'caribbean' && ORIGIN_BY_KEY.get(o).region === 'caribbean')) origins.delete('caribbean');
  if (!origins.size) return null; // coarse Overpass hit that fails the precise word-boundary check (e.g. "Pizza ToGo")

  const services = ['delivery', 'takeaway', 'outdoor_seating', 'drive_through']
    .filter((s) => t[s] === 'yes' || t[s] === 'only')
    .concat(t['diet:halal'] === 'yes' || t['diet:halal'] === 'only' ? ['halal'] : [])
    .concat(t['diet:vegetarian'] === 'yes' || t['diet:vegan'] === 'yes' ? ['vegetarian_options'] : []);

  const street = [clean(t['addr:housenumber']), clean(t['addr:street'])].filter(Boolean).join(' ') || null;
  const addrState = clean(t['addr:state'])?.toUpperCase();

  return {
    osm_id: `${el.type}/${el.id}`,
    name,
    kind,
    origins: [...origins],
    regions: [...new Set([...origins].map((o) => ORIGIN_BY_KEY.get(o).region))],
    city: clean(t['addr:city']),
    state: addrState && addrState.length === 2 && STATES.includes(addrState) ? addrState : state,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    street,
    postcode: clean(t['addr:postcode']),
    phone: clean(t.phone ?? t['contact:phone']),
    website: normUrl(t.website ?? t['contact:website'] ?? t.url),
    opening_hours: clean(t.opening_hours),
    instagram: social(t['contact:instagram'] ?? t.instagram, 'instagram.com'),
    facebook: social(t['contact:facebook'] ?? t.facebook, 'facebook.com'),
    services,
  };
}
