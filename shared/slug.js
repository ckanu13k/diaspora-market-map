// Web addresses shared by the app and the page builder (scripts/seo/build-pages.mjs).
//   /place/mama-ngozi-kitchen-houston-tx-46bcec46   one place (last part = start of its id)
//   /us/texas/  /us/texas/houston/  /us/texas/houston/nigerian/   state, city, city + cuisine
//   /cuisine/nigerian/                                            a cuisine nationwide
//   /groceries/egusi/  /dishes/jollof-rice/                       compare a product's prices
export const slugify = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

export const placeSlug = (p) => [slugify(p.name), slugify(p.city), String(p.state).toLowerCase(), String(p.id).slice(0, 8)].filter(Boolean).join('-');
export const placePath = (p) => `/place/${placeSlug(p)}`;

/** The place id, or the start of it, from a /place/… address. */
export function placeRef(param) {
  const s = String(param ?? '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { id: s.toLowerCase() };
  const m = s.match(/([0-9a-f]{8})$/i);
  return m ? { prefix: m[1].toLowerCase() } : null;
}
export const matchesRef = (id, ref) => Boolean(ref && (ref.id ? id === ref.id : id.startsWith(ref.prefix)));

export const statePath = (stateName) => `/us/${slugify(stateName)}/`;
export const cityPath = (stateName, city) => `/us/${slugify(stateName)}/${slugify(city)}/`;
export const cityCuisinePath = (stateName, city, origin) => `/us/${slugify(stateName)}/${slugify(city)}/${slugify(origin)}/`;
export const cuisinePath = (origin) => `/cuisine/${slugify(origin)}/`;
export const productPath = (kind, key) => `/${kind === 'market' ? 'groceries' : 'dishes'}/${key}/`;
