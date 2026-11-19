// Pure Overture place → app row mapping (unit-tested in tests/overture.test.mjs).
export const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX',
  'UT','VT','VA','WA','WV','WI','WY'];
const STATE_NAMES = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO', connecticut:'CT', delaware:'DE',
  'district of columbia':'DC', 'washington dc':'DC', 'washington, d.c.':'DC', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID',
  illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA',
  michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV', 'new hampshire':'NH',
  'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY', 'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK',
  oregon:'OR', pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD', tennessee:'TN', texas:'TX',
  utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', 'west virginia':'WV', wisconsin:'WI', wyoming:'WY',
};

const MARKET_CATS = /(grocery|supermarket|convenience|market|butcher|meat_shop|seafood|deli|bakery|food_store|specialty_food|international_food|spice)/;
const EATERY_CATS = /(restaurant|eat_and_drink|cafe|caterer|catering|food_truck|fast_food|takeout|diner|eatery|food_court)/;
const MARKET_NAME = /\b(market|mart|store|grocery|groceries|foods|supermarket|shop|imports?|international)\b/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function stateCode(region) {
  if (!region) return null;
  const r = String(region).trim();
  const up = r.toUpperCase().replace(/^US-/, '');
  if (up.length === 2 && STATES.includes(up)) return up;
  return STATE_NAMES[r.toLowerCase()] ?? null;
}

export function createOverture(taxonomy) {
  const enabled = new Set(taxonomy.regions.filter((r) => r.enabled).map((r) => r.key));
  const ORIGINS = taxonomy.origins.filter((o) => enabled.has(o.region));
  const BY_KEY = new Map(ORIGINS.map((o) => [o.key, o]));
  const ALIASES = new Map([['west_african', 'west_african'], ['east_african', 'east_african']]);
  const KEYWORD_RULES = ORIGINS.flatMap((o) => o.keywords.map((k) => ({ re: new RegExp(`\\b${esc(k)}\\b`, 'i'), origin: o.key })));

  const first = (xs) => (Array.isArray(xs) && xs.length ? xs[0] : null);
  const social = (xs, host) => (Array.isArray(xs) ? xs.find((u) => typeof u === 'string' && u.includes(host)) ?? null : null);

  function toRow(rec) {
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name) return null;
    if (rec.operating_status && rec.operating_status !== 'open') return null;
    const addr = rec.addr ?? {};
    if (addr.country && addr.country !== 'US') return null;
    const state = stateCode(addr.region);
    if (!state) return null;
    const lat = Number(rec.lat), lng = Number(rec.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const cats = (rec.cats ?? []).filter(Boolean).map((c) => String(c).toLowerCase());
    const catStr = cats.join(' ');

    const origins = new Set();
    for (const c of cats) {
      const m = /^(.+)_restaurant$/.exec(c);
      if (m && (BY_KEY.has(m[1]) || ALIASES.has(m[1]))) origins.add(ALIASES.get(m[1]) ?? m[1]);
    }
    for (const rule of KEYWORD_RULES) if (rule.re.test(name)) origins.add(rule.origin);
    for (const o of [...origins]) if (!BY_KEY.has(o)) origins.delete(o);
    const reg = (o) => BY_KEY.get(o).region;
    if ([...origins].some((o) => reg(o) !== 'africa_general' && reg(o).endsWith('africa'))) origins.delete('african');
    if ([...origins].some((o) => o !== 'caribbean' && reg(o) === 'caribbean')) origins.delete('caribbean');
    if (!origins.size) return null;

    const isMarket = MARKET_CATS.test(catStr);
    const isEatery = EATERY_CATS.test(catStr);
    let kind = null;
    if (isMarket && isEatery) kind = MARKET_NAME.test(name) ? 'market' : 'restaurant';
    else if (isMarket) kind = 'market';
    else if (isEatery) kind = 'restaurant';
    if (!kind) return null;

    const website = first(rec.websites);
    const postcode = addr.postcode ? String(addr.postcode).slice(0, 5) : null;
    const services = [];
    if (/caterer|catering/.test(catStr)) services.push('catering');
    if (/halal/.test(catStr)) services.push('halal');

    return {
      source_ref: `overture:${rec.id}`,
      name,
      kind,
      origins: [...origins],
      regions: [...new Set([...origins].map(reg))],
      city: addr.locality ?? null,
      state,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      street: addr.freeform ?? null,
      postcode,
      phone: first(rec.phones),
      website: website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null,
      opening_hours: null,
      instagram: social(rec.socials, 'instagram.com'),
      facebook: social(rec.socials, 'facebook.com'),
      services,
      confidence: rec.confidence ?? null,
    };
  }

  return { toRow };
}
