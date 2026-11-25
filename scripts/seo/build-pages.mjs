// Builds one plain-HTML page per place, state, city, city + cuisine, cuisine and product into dist/,
// plus sitemap.xml and robots.txt, so search engines can find and index every listing.
// Each page is the app's own index.html with that page's title, description, structured data and
// a readable copy of its content; the app takes over as soon as its script runs (src/main.tsx).
// Runs after `vite build` on Cloudflare Pages (npm run build:cloudflare). Never fails the build:
// if the database can't be reached, the site ships without these pages.
// Usage: node scripts/seo/build-pages.mjs [distDir]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../src/lib/public-config.js';
import { cityCuisinePath, cityPath, cuisinePath, placePath, productPath, slugify, statePath } from '../../shared/slug.js';

const SITE = (process.env.SITE_URL ?? 'https://diaspora-market-map.pages.dev').replace(/\/$/, '');
const DIST = process.argv[2] ?? 'dist';
const root = new URL('../../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const US_STATES = read('shared/us-states.json');
const taxonomy = read('shared/taxonomy.json');
const enabledRegions = new Set(taxonomy.regions.filter((r) => r.enabled).map((r) => r.key));
const ORIGIN = new Map(taxonomy.origins.filter((o) => enabledRegions.has(o.region)).map((o) => [o.key, o]));
const PRODUCT_LABEL = new Map(read('shared/products.json').products.map(([k, , key, label]) => [`${k}:${key}`, label]));

// ── data ────────────────────────────────────────────────
const FIXTURE = process.env.SEO_FIXTURE ? JSON.parse(readFileSync(process.env.SEO_FIXTURE, 'utf8')) : null;   // tests
async function rpc(fn, body) {
  if (FIXTURE) return fn === 'export_public_places' ? (body.p_after ? [] : FIXTURE.places) : fn === 'compare_prices' ? FIXTURE.compare[`${body.p_kind}:${body.p_key}`] : FIXTURE[fn];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function loadPlaces() {
  const out = [];
  let after = null;
  for (;;) {
    const page = await rpc('export_public_places', { p_after: after, p_limit: 1000 });
    out.push(...page);
    if (page.length < 1000) return out;
    after = page[page.length - 1].id;
  }
}

// ── text helpers ────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c == null ? '' : c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
const priceText = (c, unit) => (c == null ? '' : unit && !['each', 'plate', 'bowl'].includes(unit) ? `${money(c)}/${unit}` : money(c));
const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
const cuisineName = (key) => ORIGIN.get(key)?.label.replace(' (general)', '') ?? titleCase(key.replace(/_/g, ' '));
const cuisinesOf = (p) => p.origins.filter((o) => ORIGIN.has(o)).map(cuisineName);
const kindWord = (p) => (p.kind === 'market' ? 'market' : 'restaurant');
const DAYS = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun', PH: 'Holidays' };
const hoursLines = (h) => String(h ?? '').split(';').map((x) => x.trim().replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d]).replace(/\boff\b/i, 'Closed')).filter(Boolean);
const describe = (p) => {
  const c = cuisinesOf(p);
  return `${c.length ? `${c.slice(0, 2).join(' and ')} ` : 'African or Caribbean '}${kindWord(p)}`;
};

// ── page template ───────────────────────────────────────
const template = readFileSync(join(DIST, 'index.html'), 'utf8');
const SEO_CSS = `<style>#seo{max-width:760px;margin:0 auto;padding:1.5rem 1.25rem 3rem;font:16px/1.55 'Schibsted Grotesk',system-ui,sans-serif;color:#171a26}
#seo a{color:#3a4793}#seo h1{font-size:1.6rem;line-height:1.2;margin:.4rem 0 .6rem}#seo h2{font-size:1.1rem;margin:1.6rem 0 .5rem}
#seo ul{padding-left:1.2rem}#seo li{margin:.2rem 0}#seo .crumbs{font-size:.9rem}#seo .muted{color:#6b7083}</style>`;

function page({ path, title, description, body, jsonld = [] }) {
  const url = `${SITE}${path}`;
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(description)}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${esc(url)}" />`);
  const ld = jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('');
  html = html.replace('</head>', `<link rel="canonical" href="${esc(url)}" />${SEO_CSS}${ld}</head>`);
  html = html.replace('<div id="root"></div>', `<div id="seo">${body}<p class="muted"><a href="/">Diaspora Market Map</a>: African and Caribbean markets and restaurants across the US.</p></div><div id="root"></div>`);
  const file = join(DIST, path.replace(/^\//, ''), 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  return path;
}

const crumbs = (list) => `<p class="crumbs">${list.map(([href, label]) => (href ? `<a href="${href}">${esc(label)}</a>` : esc(label))).join(' › ')}</p>`;
const breadcrumbLd = (list) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: list.map(([href, label], i) => ({ '@type': 'ListItem', position: i + 1, name: label, ...(href ? { item: `${SITE}${href}` } : {}) })) });
const placeLine = (p) => `<li><a href="${placePath(p)}/">${esc(p.name)}</a>, ${esc(describe(p))}${p.street ? `, ${esc(p.street)}` : ''}${p.city ? `, ${esc(p.city)}` : ''}${p.status === 'possibly_closed' ? ' <span class="muted">(may be closed)</span>' : ''}</li>`;

// ── build ───────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  let places;
  try { places = await loadPlaces(); } catch (e) { console.log(`seo pages skipped: ${e.message}`); return; }
  let products = [];
  try { products = await rpc('product_overview', { p_state: null }); } catch (e) { console.log(`product pages skipped: ${e.message}`); }

  // City display names: the most common spelling in each state
  const cityName = new Map();
  for (const p of places) {
    if (!p.city) continue;
    const k = `${p.state}|${slugify(p.city)}`;
    const m = cityName.get(k) ?? new Map();
    const t = titleCase(p.city.trim());
    m.set(t, (m.get(t) ?? 0) + 1);
    cityName.set(k, m);
  }
  const cityOf = (p) => (p.city ? [...cityName.get(`${p.state}|${slugify(p.city)}`).entries()].sort((a, b) => b[1] - a[1])[0][0] : null);
  for (const p of places) p.cityName = cityOf(p);

  const byState = new Map();
  const byCity = new Map();
  const byCuisine = new Map();
  for (const p of places) {
    (byState.get(p.state) ?? byState.set(p.state, []).get(p.state)).push(p);
    if (p.cityName) { const k = `${p.state}|${slugify(p.cityName)}`; (byCity.get(k) ?? byCity.set(k, []).get(k)).push(p); }
    for (const o of p.origins) if (ORIGIN.has(o)) (byCuisine.get(o) ?? byCuisine.set(o, []).get(o)).push(p);
  }
  const cityPageOk = (list) => list.length >= 2;
  const cityCuisineOk = (list) => list.length >= 3;
  const paths = [];
  const lastmod = new Map();

  // Places
  for (const p of places) {
    const st = US_STATES[p.state] ?? p.state;
    const trail = [['/', 'Home'], [statePath(st), st]];
    const cityList = p.cityName ? byCity.get(`${p.state}|${slugify(p.cityName)}`) : null;
    if (p.cityName && cityPageOk(cityList)) trail.push([cityPath(st, p.cityName), p.cityName]);
    trail.push([null, p.name]);
    const where = p.cityName ? `${p.cityName}, ${p.state}` : st;
    const what = describe(p);
    const items = p.items ?? [];
    const keys = [...new Set(items.map((i) => i.product_key).filter(Boolean))];
    const nearby = (cityList ?? []).filter((x) => x.id !== p.id).slice(0, 10);
    const hours = hoursLines(p.opening_hours);
    const address = [p.street, p.cityName, p.state, p.postcode].filter(Boolean).join(', ');
    const body = [
      crumbs(trail),
      `<h1>${esc(p.name)}</h1>`,
      `<p>${esc(what[0].toUpperCase() + what.slice(1))} in ${esc(where)}.${p.status === 'possibly_closed' ? ' It may have closed: call before you go.' : ''}${p.claimed ? ' Run by the owner.' : ''}</p>`,
      p.description ? `<p>${esc(p.description)}</p>` : '',
      '<ul>',
      address ? `<li>Address: ${esc(address)}</li>` : '',
      p.phone ? `<li>Phone: <a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a></li>` : '',
      hours.length ? `<li>Hours: ${hours.map(esc).join('; ')}</li>` : '',
      p.website ? `<li>Website: <a href="${esc(p.website)}" rel="nofollow">${esc(p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></li>` : '',
      p.menu_url ? `<li><a href="${esc(p.menu_url)}" rel="nofollow">${p.kind === 'market' ? 'Shop online' : 'See their menu'}</a></li>` : '',
      `<li><a href="https://www.google.com/maps/dir/?api=1&amp;destination=${p.lat},${p.lng}" rel="nofollow">Directions</a></li>`,
      '</ul>',
      items.length ? `<h2>${p.kind === 'market' ? 'Products and prices' : 'Menu and prices'}</h2><ul>${items.slice(0, 60).map((i) => `<li>${esc(i.name)}${i.price_cents != null ? `: ${priceText(i.price_cents, i.price_unit)}` : ''}${i.available === false ? ' (out of stock)' : ''}</li>`).join('')}</ul>` : '',
      keys.length ? `<p>Compare prices: ${keys.map((k) => `<a href="${productPath(p.kind, k)}">${esc(PRODUCT_LABEL.get(`${p.kind}:${k}`) ?? k)}</a>`).join(', ')}</p>` : '',
      nearby.length ? `<h2>More in ${esc(where)}</h2><ul>${nearby.map(placeLine).join('')}</ul>` : '',
    ].join('');
    const ld = {
      '@context': 'https://schema.org', '@type': p.kind === 'market' ? 'GroceryStore' : 'Restaurant', name: p.name, url: `${SITE}${placePath(p)}/`,
      geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng },
      address: { '@type': 'PostalAddress', streetAddress: p.street ?? undefined, addressLocality: p.cityName ?? undefined, addressRegion: p.state, postalCode: p.postcode ?? undefined, addressCountry: 'US' },
      ...(p.phone ? { telephone: p.phone } : {}),
      ...(p.website ? { sameAs: [p.website] } : {}),
      ...(p.kind === 'restaurant' && cuisinesOf(p).length ? { servesCuisine: cuisinesOf(p) } : {}),
      ...(p.menu_url ? { hasMenu: p.menu_url } : {}),
      ...(/^[A-Z][a-z]/.test(p.opening_hours ?? '') ? { openingHours: p.opening_hours.split(';').map((x) => x.trim()).filter((x) => !/off/i.test(x)) } : {}),
    };
    const title = `${p.name}: ${what} in ${where} | Diaspora Market Map`;
    const description = `${p.name}, ${what} in ${where}.${address ? ` ${address}.` : ''}${p.phone ? ` Phone ${p.phone}.` : ''} Hours, directions${items.length ? `, ${p.kind === 'market' ? 'products' : 'menu'} and prices` : ''}.`;
    paths.push(page({ path: `${placePath(p)}/`, title, description, body, jsonld: [ld, breadcrumbLd(trail)] }));
    lastmod.set(`${placePath(p)}/`, p.updated_at);
  }

  // States
  for (const [code, list] of byState) {
    const st = US_STATES[code] ?? code;
    const cities = [...new Set(list.map((p) => p.cityName).filter(Boolean))]
      .map((c) => [c, byCity.get(`${code}|${slugify(c)}`)]).filter(([, l]) => cityPageOk(l)).sort((a, b) => b[1].length - a[1].length);
    const cuisines = [...new Map(list.flatMap((p) => p.origins.filter((o) => ORIGIN.has(o)).map((o) => [o, 0]))).keys()]
      .map((o) => [o, list.filter((p) => p.origins.includes(o)).length]).sort((a, b) => b[1] - a[1]);
    const trail = [['/', 'Home'], [null, st]];
    const markets = list.filter((p) => p.kind === 'market').length;
    const body = [
      crumbs(trail),
      `<h1>African and Caribbean markets and restaurants in ${esc(st)}</h1>`,
      `<p>${list.length} places in ${esc(st)}: ${markets} markets and ${list.length - markets} restaurants.</p>`,
      cities.length ? `<h2>Cities</h2><ul>${cities.map(([c, l]) => `<li><a href="${cityPath(st, c)}">${esc(c)}</a> (${l.length})</li>`).join('')}</ul>` : '',
      cuisines.length ? `<h2>Cuisines</h2><ul>${cuisines.slice(0, 30).map(([o, n]) => `<li><a href="${cuisinePath(o)}">${esc(cuisineName(o))}</a> (${n} in ${esc(st)})</li>`).join('')}</ul>` : '',
      `<h2>Places</h2><ul>${list.slice().sort((a, b) => (a.cityName ?? '').localeCompare(b.cityName ?? '') || a.name.localeCompare(b.name)).slice(0, 300).map(placeLine).join('')}</ul>`,
    ].join('');
    paths.push(page({ path: statePath(st), title: `African and Caribbean markets and restaurants in ${st} | Diaspora Market Map`,
      description: `${list.length} African and Caribbean markets and restaurants in ${st}, with addresses, phone numbers, hours, menus and prices.`, body, jsonld: [breadcrumbLd(trail)] }));
  }

  // Cities, and cuisines within a city
  for (const [k, list] of byCity) {
    if (!cityPageOk(list)) continue;
    const code = k.split('|')[0];
    const st = US_STATES[code] ?? code;
    const c = list[0].cityName;
    const trail = [['/', 'Home'], [statePath(st), st], [null, c]];
    const cuisines = [...new Set(list.flatMap((p) => p.origins.filter((o) => ORIGIN.has(o))))]
      .map((o) => [o, list.filter((p) => p.origins.includes(o))]).sort((a, b) => b[1].length - a[1].length);
    const markets = list.filter((p) => p.kind === 'market');
    const restaurants = list.filter((p) => p.kind === 'restaurant');
    const body = [
      crumbs(trail),
      `<h1>African and Caribbean markets and restaurants in ${esc(c)}, ${esc(code)}</h1>`,
      `<p>${list.length} places in ${esc(c)}: ${markets.length} markets and ${restaurants.length} restaurants.</p>`,
      cuisines.length ? `<h2>By cuisine</h2><ul>${cuisines.map(([o, l]) => `<li>${cityCuisineOk(l) ? `<a href="${cityCuisinePath(st, c, o)}">${esc(cuisineName(o))}</a>` : esc(cuisineName(o))} (${l.length})</li>`).join('')}</ul>` : '',
      markets.length ? `<h2>Markets</h2><ul>${markets.map(placeLine).join('')}</ul>` : '',
      restaurants.length ? `<h2>Restaurants</h2><ul>${restaurants.map(placeLine).join('')}</ul>` : '',
    ].join('');
    paths.push(page({ path: cityPath(st, c), title: `African and Caribbean markets and restaurants in ${c}, ${code} | Diaspora Market Map`,
      description: `${list.length} African and Caribbean markets and restaurants in ${c}, ${code}: addresses, phone numbers, hours, menus and prices.`, body, jsonld: [breadcrumbLd(trail)] }));
    for (const [o, l] of cuisines) {
      if (!cityCuisineOk(l)) continue;
      const cn = cuisineName(o);
      const t2 = [['/', 'Home'], [statePath(st), st], [cityPath(st, c), c], [null, cn]];
      const b2 = [crumbs(t2), `<h1>${esc(cn)} markets and restaurants in ${esc(c)}, ${esc(code)}</h1>`,
        `<p>${l.length} places in ${esc(c)} serve or sell ${esc(cn)} food.</p>`, `<ul>${l.map(placeLine).join('')}</ul>`,
        `<p>See <a href="${cuisinePath(o)}">${esc(cn)} places across the US</a> or <a href="${cityPath(st, c)}">everything in ${esc(c)}</a>.</p>`].join('');
      paths.push(page({ path: cityCuisinePath(st, c, o), title: `${cn} markets and restaurants in ${c}, ${code} | Diaspora Market Map`,
        description: `${l.length} ${cn} markets and restaurants in ${c}, ${code}, with addresses, phone numbers, hours and menus.`, body: b2, jsonld: [breadcrumbLd(t2)] }));
    }
  }

  // Cuisines nationwide
  for (const [o, list] of byCuisine) {
    const cn = cuisineName(o);
    const trail = [['/', 'Home'], [null, cn]];
    const cities = [...new Map(list.filter((p) => p.cityName).map((p) => [`${p.state}|${slugify(p.cityName)}`, p])).entries()]
      .map(([k, p]) => [p, list.filter((x) => x.cityName && `${x.state}|${slugify(x.cityName)}` === k)]).sort((a, b) => b[1].length - a[1].length);
    const body = [crumbs(trail), `<h1>${esc(cn)} markets and restaurants in the US</h1>`, `<p>${list.length} places across the US.</p>`,
      `<h2>Top cities</h2><ul>${cities.slice(0, 40).map(([p, l]) => { const st = US_STATES[p.state]; return `<li>${cityCuisineOk(l) ? `<a href="${cityCuisinePath(st, p.cityName, o)}">${esc(p.cityName)}, ${p.state}</a>` : `${esc(p.cityName)}, ${p.state}`} (${l.length})</li>`; }).join('')}</ul>`,
      `<h2>Places</h2><ul>${list.slice(0, 200).map(placeLine).join('')}</ul>`].join('');
    paths.push(page({ path: cuisinePath(o), title: `${cn} markets and restaurants in the US | Diaspora Market Map`,
      description: `Find ${list.length} ${cn} markets and restaurants across the US, with addresses, hours, menus and prices.`, body, jsonld: [breadcrumbLd(trail)] }));
  }

  // Products
  const productLinks = [];
  for (const pr of products) {
    let cmp;
    try { cmp = await rpc('compare_prices', { p_kind: pr.kind, p_key: pr.key, lim: 500 }); } catch { continue; }
    const label = pr.label;
    const range = pr.min_cents == null ? '' : pr.min_cents === pr.max_cents ? money(pr.min_cents) : `${money(pr.min_cents)} to ${money(pr.max_cents)}`;
    const where = pr.kind === 'market' ? 'stores' : 'restaurants';
    const trail = [['/', 'Home'], ['/prices/', 'Compare prices'], [null, label]];
    const rows = (cmp.rows ?? []).map((r) => ({ ...r, id: r.place_id, cityName: r.city ? titleCase(r.city) : null }));
    const body = [crumbs(trail), `<h1>${esc(label)} prices: where to ${pr.kind === 'market' ? 'buy' : 'eat'} it</h1>`,
      `<p>${pr.places} ${where} list ${esc(label.toLowerCase())}${range ? `, typically ${range}` : ''}. <a href="${productPath(pr.kind, pr.key)}">Open the price comparison</a> to see each ${pr.kind === 'market' ? 'store' : 'restaurant'}'s price, cheapest first.</p>`,
      `<ul>${rows.map((r) => `<li><a href="${placePath({ id: r.place_id, name: r.name, city: r.city, state: r.state })}/">${esc(r.name)}</a>, ${esc(r.cityName ?? '')}${r.cityName ? ', ' : ''}${r.state}: ${esc(r.item)}</li>`).join('')}</ul>`].join('');
    paths.push(page({ path: productPath(pr.kind, pr.key), title: `${label} prices near you: compare ${pr.places} ${where} | Diaspora Market Map`,
      description: `Where to ${pr.kind === 'market' ? 'buy' : 'eat'} ${label.toLowerCase()} in the US: ${pr.places} ${where}${range ? `, ${range}` : ''}. Compare prices before you go.`, body, jsonld: [breadcrumbLd(trail)] }));
    productLinks.push(`<li><a href="${productPath(pr.kind, pr.key)}">${esc(label)}</a> (${pr.places} ${where}${range ? `, ${range}` : ''})</li>`);
  }
  if (productLinks.length) {
    paths.push(page({ path: '/prices/', title: 'Compare prices of African and Caribbean groceries and dishes | Diaspora Market Map',
      description: 'What egusi, garri, palm oil, oxtail, jollof rice and more cost at African and Caribbean stores and restaurants across the US.',
      body: `${crumbs([['/', 'Home'], [null, 'Compare prices']])}<h1>Compare prices</h1><ul>${productLinks.join('')}</ul>` }));
  }

  // Sitemap and robots
  const urls = ['/', '/prices/', ...paths.filter((p) => p !== '/prices/')];
  const sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((p) =>
    `<url><loc>${esc(`${SITE}${p}`)}</loc>${lastmod.get(p) ? `<lastmod>${String(lastmod.get(p)).slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  writeFileSync(join(DIST, 'sitemap.xml'), sm);
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /admin\nDisallow: /owner/\nDisallow: /claim/\nDisallow: /data/\n\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`seo pages: ${paths.length} pages (${places.length} places, ${byState.size} states, ${products.length} products) in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((e) => { console.log(`seo pages failed, site ships without them: ${e.stack ?? e}`); });
