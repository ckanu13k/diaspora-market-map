// Pure helpers for the weekly website check: page classification, "is this the right business?",
// and free structured menu / product extraction (schema.org JSON-LD, Shopify, WooCommerce).
// No network here, so everything is unit-tested with fixtures (tests/web.test.mjs).

// ── text helpers ─────────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è' };
export const decode = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
export const norm = (s) => decode(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

export function pageText(html) {
  return decode(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
const meta = (html, re) => decode((html.match(re) ?? [])[1] ?? '').trim();
export const titleOf = (html) => meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, ' ');
const metaContent = (html, name) => meta(html, new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
  || meta(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'));

export function siteOf(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\d?\./, '');
    const parts = h.split('.');
    const sld = parts.length > 2 && /^(co|com|org|net|gov|edu)$/.test(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-sld).join('.');
  } catch { return null; }
}
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\d?\./, ''); } catch { return ''; } };

// ── what kind of site is it ──────────────────────────────
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linktr\.ee|tiktok\.com|twitter\.com|x\.com)$/;
const ORDERING = /(^|\.)(doordash\.com|ubereats\.com|grubhub\.com|seamless\.com|postmates\.com|chownow\.com|toasttab\.com|order\.online|clover\.com|menufy\.com|slicelife\.com|beyondmenu\.com|yelp\.com|ezcater\.com|square\.site|squareup\.com|order\.toasttab\.com|orderonlinemenu\.com|allmenus\.com|menupages\.com)$/;
// Hosts a dead or parked domain gets bounced to
const PARKING_HOST = /(^|\.)(sedo\.com|sedoparking\.com|bodis\.com|parkingcrew\.net|above\.com|dan\.com|afternic\.com|hugedomains\.com|godaddy\.com|domainmarket\.com|undeveloped\.com|buydomains\.com|uniregistry\.com|epik\.com|squadhelp\.com|brandbucket\.com|perfectdomain\.com|domainnamesales\.com|atom\.com|spaceship\.com|porkbun\.com|namebright\.com|parklogic\.com|smartname\.com|domainsponsor\.com|searchvity\.com)$/;
// A redirect to one of these sites' own homepages means the business site is gone
const PLATFORM_HOME = /(^|\.)(wix\.com|wixsite\.com|squarespace\.com|weebly\.com|wordpress\.com|shopify\.com|google\.com|business\.site|godaddysites\.com|jimdo\.com|strikingly\.com|webflow\.io|webs\.com|yola\.com|bluehost\.com|hostgator\.com|namecheap\.com|ionos\.com|1and1\.com|networksolutions\.com|web\.com|hostinger\.com)$/;

const PARKED_TEXT = [
  /this domain (name )?(may be|is) for sale/i, /\bbuy this domain\b/i, /\bdomain (is )?for sale\b/i, /the domain [\w.-]+ is for sale/i,
  /parked free,? courtesy of/i, /this domain (has been|is) (registered|parked)/i, /domain (name )?(has )?expired/i,
  /this domain name has expired/i, /renew (this|your) domain/i, /\bsedoparking\b/i, /\bparkingcrew\b/i, /\bbodis\.com\b/i,
  /hugedomains\.com/i, /inquire about this domain/i, /make an offer on this domain/i, /domain parking/i, /related searches/i,
];
const PLACEHOLDER_TEXT = [
  /looks like this domain isn.t connected to a website yet/i, /this site (is|was) (currently )?unavailable/i, /website (is )?expired/i,
  /this website has expired/i, /this store is unavailable/i, /store unavailable/i, /(account|website|site) (has been )?suspended/i,
  /this account has been suspended/i, /there isn.t a github pages site here/i, /\bno such app\b/i, /welcome to nginx/i,
  /apache2 (ubuntu|debian) default page/i, /^\s*it works!?\s*$/i, /\bindex of \//i, /default web site page/i, /future home of/i,
  /this site can.t be reached/i, /web ?site coming soon/i, /\bcoming soon\b/i, /\bunder construction\b/i, /site not found/i,
  /domain (is )?not configured/i, /this page isn.t available/i, /hosting provided by/i, /the site you were looking for couldn.t be found/i,
  /your (new )?website is (almost )?ready/i, /404 not found/i, /page not found/i,
];
// Only meaningful on short pages (a real site may mention "coming soon" for a new dish)
const SHORT_ONLY = new Set([/\bcoming soon\b/i, /\bunder construction\b/i, /site not found/i, /404 not found/i, /page not found/i, /hosting provided by/i, /web ?site coming soon/i].map(String));
const CLOSED_TEXT = [/\b(permanently|forever) closed\b/i, /\bclosed permanently\b/i, /\bhas (permanently )?closed (its|our) doors\b/i, /\bwe (have|are) (now )?(permanently )?closed\b(?! (on|for|today|tomorrow|mondays?|tuesdays?|sundays?|thanksgiving|christmas|the holiday))/i, /\bclosed for good\b/i, /\bwe('| a)re closing our doors\b/i, /\bthank you for (\d+ )?(wonderful )?years\b.*\bclosed\b/i];

const STOP = new Set(`the and of at by on in for a an la le les de del el los las da do du di
restaurant restaurants resto market markets marketplace grocery groceries store stores shop shoppe supermarket mart minimart food foods kitchen
kitchens cafe cafes grill grille bar lounge cuisine cuisines international intl african africa caribbean carib west east south north central island
islands tropical express llc inc co corp company bistro eatery deli bakery takeout take out place spot house home hut plus best new authentic original
ethnic world global products product meat meats fish seafood halal beauty supply supplies imports import export variety mini super center centre
dining jerk bbq barbecue chicken pizza wings catering services service hair braiding salon boutique fashion fashions taste tastes flavor flavors
spice spices sweet treats truck trucks llc nigerian naija ghanaian jamaican haitian ethiopian eritrean somali kenyan senegalese trinidadian
guyanese liberian cameroonian congolese ivorian sierra leone indian west indies latin american grocers grocer wholesale retail family mama
mamas mom moms auntie aunty uncle papa`.split(/\s+/));

export function nameEvidence(name) {
  const words = norm(name).split(' ').filter(Boolean);
  const distinctive = words.filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  return { distinctive, joined: words.join('') };
}

/**
 * Does the page belong to this business? Evidence, strongest first: phone number, a distinctive
 * word of the name, the domain spelling out the name, the street address or ZIP.
 */
export function matchBusiness(place, { html, url }) {
  const ev = nameEvidence(place.name);
  const text = norm(`${titleOf(html)} ${metaContent(html, 'og:site_name')} ${metaContent(html, 'og:title')} ${metaContent(html, 'description')} ${clip(pageText(html), 200_000)}`);
  const padded = ` ${text} `;
  const digits = String(html).replace(/[^\d]/g, '');
  const phone = String(place.phone ?? '').replace(/[^\d]/g, '').replace(/^1(?=\d{10}$)/, '');
  if (phone.length === 10 && (digits.includes(phone) || digits.includes(`1${phone}`))) return 'phone';
  const stem = norm(hostOf(url).replace(/\.[a-z.]+$/, '').replace(/^(order|shop|menu|www)\./, '')).replace(/ /g, '');
  for (const w of ev.distinctive) if (padded.includes(` ${w} `)) return 'name';
  // Names made only of common words ("Island Spice Grill") must appear as a whole phrase
  const phrase = norm(place.name).replace(/^the /, '').replace(/ (llc|inc)$/, '');
  if (phrase.split(' ').length >= 2 && padded.includes(` ${phrase} `)) return 'name';
  if (ev.distinctive.length && stem.length >= 4 && ev.distinctive.some((w) => w.length >= 4 && stem.includes(w))) return 'domain';
  if (stem.length >= 5 && ev.joined.includes(stem)) return 'domain';
  const street = norm(place.street ?? '').split(' ');
  if (street.length >= 2 && /^\d+$/.test(street[0]) && padded.includes(` ${street[0]} ${street[1]} `)) return 'address';
  if (place.postcode && padded.includes(` ${place.postcode} `) && ev.distinctive.length === 0) return 'postcode';
  return null;
}

/**
 * Classify a fetched home page.
 * → { keep: boolean, status, reason? }
 *   status: ok | social | ordering_platform | parked | placeholder | closed_notice | redirected_away | mismatch | thin
 */
export function classifyPage(place, { url, finalUrl, status, html, contentType = 'text/html' }) {
  const host = hostOf(finalUrl);
  if (status === 404 || status === 410) return { keep: false, status: 'not_found' };
  if (PARKING_HOST.test(host)) return { keep: false, status: 'parked', reason: host };
  if (SOCIAL.test(host)) return { keep: true, status: 'social' };
  if (ORDERING.test(host)) return { keep: true, status: 'ordering_platform' };
  if (siteOf(url) !== siteOf(finalUrl) && PLATFORM_HOME.test(host)) {
    // e.g. a retired *.business.site bouncing to Google, or a lapsed Wix site bouncing to wix.com
    const path = (() => { try { return new URL(finalUrl).pathname; } catch { return '/'; } })();
    if (path.length <= 1 || /^\/(maps|search|\?|website-expired|domain|websites?)\b/i.test(path) || /business\.site$/.test(hostOf(url))) {
      return { keep: false, status: 'redirected_away', reason: host };
    }
  }
  if (/\/(website-expired|account-suspended|suspendedpage|cgi-sys\/suspendedpage)/i.test(finalUrl)) return { keep: false, status: 'placeholder', reason: 'suspended' };
  if (/pdf/i.test(contentType)) return { keep: true, status: 'ok', pdf: true };

  const text = pageText(html);
  const title = titleOf(html);
  const head = `${title} ${text.slice(0, 4000)}`;
  const short = text.length < 1500;
  for (const re of PARKED_TEXT) if (re.test(head)) return { keep: false, status: 'parked', reason: String(re) };
  for (const re of PLACEHOLDER_TEXT) {
    if (SHORT_ONLY.has(String(re)) && !short) continue;
    if (re.test(short ? `${title} ${text}` : title)) return { keep: false, status: 'placeholder', reason: String(re) };
  }
  if (CLOSED_TEXT.some((re) => re.test(title) || re.test(text.slice(0, 3000)))) return { keep: false, status: 'closed_notice' };

  const how = matchBusiness(place, { html, url: finalUrl });
  if (how) return { keep: true, status: 'ok', match: how };
  // JavaScript-only pages ship almost no text, so there's nothing to compare yet: keep, but say so
  if (text.length < 120) return { keep: true, status: 'thin' };
  return { keep: false, status: 'mismatch', reason: title.slice(0, 80) };
}

// ── links to the vendor's own menu ───────────────────────
const MENU_TEXT = /^\s*(our\s+|view\s+(our\s+)?|see\s+(our\s+)?|full\s+|food\s+|dinner\s+|lunch\s+|breakfast\s+|catering\s+|takeout\s+|take-out\s+)?menus?\s*$/i;
const ORDER_TEXT = /^\s*(order\s+(online|now|here|pickup|delivery|ahead)|online\s+order(ing)?|shop\s+(online|now)|shop)\s*$/i;
export function findMenuLink(html, baseUrl, kind) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = (m[1].match(/href\s*=\s*["']([^"'#][^"']*)["']/i) ?? [])[1];
    if (!href || /^(javascript|mailto|tel|sms):/i.test(href)) continue;
    let abs; try { abs = new URL(decode(href), baseUrl).href; } catch { continue; }
    if (!/^https?:/i.test(abs)) continue;
    const label = pageText(m[2]).slice(0, 60) || (m[1].match(/aria-label\s*=\s*["']([^"']+)["']/i) ?? [])[1] || '';
    const same = siteOf(abs) === siteOf(baseUrl);
    const h = hostOf(abs);
    let score = 0;
    if (MENU_TEXT.test(label)) score = same ? 10 : ORDERING.test(h) ? 7 : 0;
    else if (same && /\/(our-)?menus?(\/|\.|$|\?|-)|menu[^/]*\.pdf/i.test(abs)) score = 8;
    else if (kind === 'market' && ORDER_TEXT.test(label) && same) score = 6;
    else if (ORDER_TEXT.test(label) && ORDERING.test(h)) score = 5;
    if (score && abs !== baseUrl && abs.replace(/\/$/, '') !== baseUrl.replace(/\/$/, '')) out.push({ url: abs, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out[0]?.url ?? null;
}

// ── items ────────────────────────────────────────────────
const SKIP_ITEM = /gift ?card|shipping|delivery fee|donation|\btip\b|test product|sample product|e-?gift|membership|subscription|catering deposit/i;
const toCents = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) : null;
};
export function cleanItems(items, cap = 300) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const name = clip(decode(it.name ?? '').replace(/\s+/g, ' ').trim(), 80);
    if (!name || SKIP_ITEM.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, section: clip(decode(it.section ?? '').replace(/\s+/g, ' ').trim(), 40), price_cents: it.price_cents ?? null, price_unit: it.price_unit ?? null, available: it.available !== false });
    if (out.length >= cap) break;
  }
  return out;
}

export function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1].trim())); } catch { /* invalid JSON-LD is common */ } }
  return out;
}
const types = (n) => [].concat(n?.['@type'] ?? []).map(String);
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
function offerPrice(offers) {
  for (const o of arr(offers)) {
    if (o?.priceCurrency && o.priceCurrency !== 'USD') continue;
    const c = toCents(o?.price ?? o?.lowPrice ?? o?.priceSpecification?.price);
    if (c != null) return { cents: c, available: !/OutOfStock|SoldOut|Discontinued/i.test(String(o?.availability ?? '')) };
  }
  return { cents: null, available: true };
}

/** schema.org Menu / MenuSection / MenuItem, or a list of Products. Also returns a hasMenu URL to follow. */
export function jsonLdMenu(html) {
  const items = [];
  const products = [];
  let menuUrl = null;
  const walkMenu = (node, section) => {
    for (const s of arr(node?.hasMenuSection)) walkMenu(s, decode(s?.name ?? section ?? ''));
    for (const it of arr(node?.hasMenuItem)) {
      const { cents, available } = offerPrice(it?.offers);
      items.push({ name: it?.name, section: section ?? '', price_cents: cents, available });
    }
  };
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = types(n);
    if (t.includes('Menu') || t.includes('MenuSection')) walkMenu(n, t.includes('MenuSection') ? n.name : '');
    else if (n.hasMenu) {
      if (typeof n.hasMenu === 'string') menuUrl = n.hasMenu;
      else if (n.hasMenu?.url && !n.hasMenu.hasMenuSection && !n.hasMenu.hasMenuItem) menuUrl = n.hasMenu.url;
      else walkMenu(n.hasMenu, '');
    }
    if (t.includes('Product') && n.name) {
      const { cents, available } = offerPrice(n.offers);
      products.push({ name: n.name, section: n.category ?? '', price_cents: cents, available });
    }
    for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity']) if (n[k]) visit(n[k]);
  };
  jsonLdBlocks(html).forEach(visit);
  const list = items.length ? items : products.length >= 3 ? products : [];
  return { items: cleanItems(list), menuUrl };
}

export const isShopify = (html, headers = {}) =>
  Boolean(headers['x-shopid'] || headers['x-shopify-stage'] || /shopify/i.test(headers['powered-by'] ?? '')) || /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(html);
export const isWoo = (html) => /woocommerce|wc-block|\/wp-content\/plugins\/woocommerce/i.test(html);

const UNIT_RE = /^(\d+(\.\d+)?)\s*(lb|lbs|pound|pounds|oz|kg|g|gram|grams|l|liter|litre|ml|pack|pk|ct|count)s?$/i;
export function shopifyItems(json) {
  const list = [];
  for (const p of arr(json?.products)) {
    const variants = arr(p.variants);
    const v = variants.find((x) => x.available) ?? variants[0];
    if (!v) continue;
    const vt = String(v.title ?? '').trim();
    const name = vt && vt !== 'Default Title' && vt.length <= 20 && !UNIT_RE.test(vt) ? `${p.title} (${vt})` : p.title;
    list.push({ name, section: p.product_type ?? '', price_cents: toCents(v.price), price_unit: UNIT_RE.test(vt) ? vt.toLowerCase() : null, available: variants.some((x) => x.available) });
  }
  return cleanItems(list);
}

export function wooItems(products) {
  const list = [];
  for (const p of arr(products)) {
    const minor = Number(p?.prices?.currency_minor_unit ?? 2);
    if (p?.prices?.currency_code && p.prices.currency_code !== 'USD') continue;
    const raw = p?.prices?.price;
    const cents = raw == null || raw === '' ? null : Math.round((Number(raw) * 100) / 10 ** minor);
    list.push({ name: p?.name, section: p?.categories?.[0]?.name ?? '', price_cents: Number.isFinite(cents) && cents <= 100000 ? cents : null, available: p?.is_in_stock !== false });
  }
  return cleanItems(list);
}
