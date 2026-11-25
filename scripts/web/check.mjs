// Weekly website check, run in GitHub Actions right before the listings files are encrypted.
// For every place with a website:
//   1. respect robots.txt, fetch the home page (one polite request per site, plus a few extras)
//   2. drop the link if the site is dead, parked, a placeholder, says it closed, bounces to a
//      hosting company's homepage, or is clearly a different business
//   3. add the menu / product list when the site publishes it in a free machine-readable form:
//      schema.org menu data, a Shopify store feed, or a WooCommerce store feed
//   4. otherwise remember a direct link to their menu page, so the app can send people there
// Adds to each row: website (kept or null), website_status, website_checked_at, menu_url, items, items_url.
import { allowed, BOT, parseRobots } from './robots.mjs';
import { classifyPage, findMenuLink, isShopify, isWoo, jsonLdMenu, shopifyItems, siteOf, wooItems } from './classify.mjs';

const UA = `Mozilla/5.0 (compatible; ${BOT}/1.0; +https://diaspora-market-map.pages.dev/)`;
const TIMEOUT = 15_000;
const MAX_HTML = 2_000_000;
const MAX_JSON = 6_000_000;
const TRANSIENT = new Set(['timeout', 'reset', 'server_error', 'rate_limited']);
// Node rejects some certificate chains that browsers repair on their own; don't punish those sites
const BROWSER_OK_TLS = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const BAD_TLS = new Set(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_NOT_YET_VALID']);

async function readCapped(res, cap) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > cap) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

const errKind = (e) => {
  const code = e?.cause?.code ?? e?.code ?? '';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return { kind: 'timeout', code };
  if (code === 'ENOTFOUND') return { kind: 'dns', code };
  if (code === 'EAI_AGAIN') return { kind: 'timeout', code };
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return { kind: 'refused', code };
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return { kind: 'reset', code };
  if (BROWSER_OK_TLS.has(code)) return { kind: 'tls_chain', code };
  if (BAD_TLS.has(code) || /CERT|TLS|SSL/i.test(code)) return { kind: 'bad_tls', code };
  if (/redirect/i.test(String(e?.message))) return { kind: 'redirect_loop', code };
  return { kind: 'error', code: code || String(e?.message ?? e).slice(0, 60) };
};

export async function get(url, { cap = MAX_HTML, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } = {}) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' } });
    const headers = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
    const ct = headers['content-type'] ?? '';
    const body = /pdf|image|octet-stream|video|audio/i.test(ct) ? '' : await readCapped(res, cap);
    return { ok: true, status: res.status, finalUrl: res.url || url, headers, contentType: ct, body };
  } catch (e) {
    return { ok: false, ...errKind(e) };
  }
}

const robotsCache = new Map();
async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const p = (async () => {
    const r = await get(`${origin}/robots.txt`, { cap: 200_000, accept: 'text/plain,*/*;q=0.5' });
    if (!r.ok) return r.kind === 'timeout' || r.kind === 'reset' ? 'unreachable' : [];
    if (r.status >= 500) return 'unreachable';
    if (r.status >= 400) return []; // no robots.txt: everything allowed
    return parseRobots(r.body);
  })();
  robotsCache.set(origin, p);
  return p;
}
async function mayFetch(url, why) {
  let u; try { u = new URL(url); } catch { return false; }
  const rules = await robotsFor(u.origin);
  if (rules === 'unreachable') { if (why) why.reason = 'robots_unreachable'; return false; }
  const ok = allowed(rules, u.pathname + u.search);
  if (!ok && why) why.reason = 'robots_disallow';
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

/** Check one place's website. Returns the fields to merge into its row. */
export async function checkOne(place) {
  const out = { website: null, website_status: 'none', website_checked_at: today(), menu_url: null, items: [], items_url: null };
  if (!place.website) return out;
  let url = place.website.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const why = {};
  if (!(await mayFetch(url, why))) {
    if (why.reason === 'robots_unreachable') {
      // robots.txt itself didn't answer: check the home page the same way to see if the site is there at all
      const probe = await get(url, { cap: 20_000 });
      if (!probe.ok) return { ...out, website_status: probe.kind === 'dns' ? 'dead_dns' : TRANSIENT.has(probe.kind) ? probe.kind : `error_${probe.kind}`, transient: true, reason: probe.code };
    }
    // The site asks bots to stay away (or won't say): we can't check it, so keep the link as listed.
    return { ...out, website: url, website_status: 'not_checked_robots', reason: why.reason };
  }

  let r = await get(url);
  if (!r.ok && (r.kind === 'bad_tls' || r.kind === 'refused') && url.startsWith('https://')) {
    const http = await get(url.replace(/^https:/, 'http:'));
    if (http.ok && !http.finalUrl.startsWith('https:')) { r = http; url = url.replace(/^https:/, 'http:'); }
    else if (http.ok && http.finalUrl.startsWith('https:')) r = { ok: false, kind: 'bad_tls', code: r.code };
  }
  if (!r.ok) {
    if (r.kind === 'tls_chain') return { ...out, website: url, website_status: 'not_checked_tls' };
    // DNS failures get one retry too: a busy resolver can fail a lookup that works a minute later
    return { ...out, website_status: r.kind === 'dns' ? 'dead_dns' : r.kind === 'refused' ? 'dead_refused' : r.kind === 'bad_tls' ? 'bad_certificate' : TRANSIENT.has(r.kind) ? r.kind : `error_${r.kind}`, transient: TRANSIENT.has(r.kind) || r.kind === 'dns', reason: r.code };
  }
  if (r.status === 429) return { ...out, website_status: 'rate_limited', transient: true };
  if (r.status >= 500) return { ...out, website_status: 'server_error', transient: true };
  if (r.status === 401 || r.status === 403) {
    // Bot protection (Cloudflare and the like): the site exists, but we can't read it
    return { ...out, website: url, website_status: 'not_checked_blocked' };
  }
  if (r.status >= 400) return { ...out, website_status: r.status === 404 || r.status === 410 ? 'not_found' : `http_${r.status}`, reason: `${r.headers.server ?? ''} ${r.finalUrl !== url ? `→ ${r.finalUrl}` : ''}`.trim() };

  const verdict = classifyPage(place, { url, finalUrl: r.finalUrl, status: r.status, html: r.body, contentType: r.contentType });
  if (!verdict.keep) return { ...out, website_status: verdict.status, reason: verdict.reason };
  // A different domain that is clearly theirs (they moved) replaces the old address
  const website = siteOf(r.finalUrl) !== siteOf(url) ? r.finalUrl : url;
  const res = { ...out, website, website_status: verdict.status, match: verdict.match };
  if (verdict.pdf) return { ...res, menu_url: r.finalUrl };
  if (verdict.status !== 'ok' && verdict.status !== 'thin') return res;

  // ── free, machine-readable menus and product lists
  const base = r.finalUrl;
  const origin = new URL(base).origin;
  try {
    if (isShopify(r.body, r.headers) && (await mayFetch(`${origin}/products.json`))) {
      await sleep(800);
      const j = await get(`${origin}/products.json?limit=250`, { cap: MAX_JSON, accept: 'application/json' });
      if (j.ok && j.status === 200 && /json/i.test(j.contentType)) {
        const items = shopifyItems(JSON.parse(j.body));
        if (items.length) return { ...res, items, items_url: base, menu_url: base, items_from: 'shopify' };
      }
    }
    if (isWoo(r.body) && (await mayFetch(`${origin}/wp-json/wc/store/v1/products`))) {
      const all = [];
      for (let page = 1; page <= 3; page++) {
        await sleep(800);
        const j = await get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { cap: MAX_JSON, accept: 'application/json' });
        if (!(j.ok && j.status === 200 && /json/i.test(j.contentType))) break;
        const list = JSON.parse(j.body);
        if (!Array.isArray(list) || !list.length) break;
        all.push(...list);
        if (list.length < 100) break;
      }
      const items = wooItems(all);
      if (items.length) return { ...res, items, items_url: base, menu_url: base, items_from: 'woocommerce' };
    }
    let ld = jsonLdMenu(r.body);
    let ldUrl = base;
    const menuLink = findMenuLink(r.body, base, place.kind);
    const follow = ld.menuUrl ?? (menuLink && siteOf(menuLink) === siteOf(base) && !/\.pdf(\?|$)/i.test(menuLink) ? menuLink : null);
    if (!ld.items.length && follow && siteOf(follow) === siteOf(base) && (await mayFetch(follow))) {
      await sleep(800);
      const m = await get(follow);
      if (m.ok && m.status === 200) {
        if (/pdf/i.test(m.contentType)) return { ...res, menu_url: m.finalUrl };
        ld = jsonLdMenu(m.body);
        ldUrl = m.finalUrl;
        if (!ld.items.length) return { ...res, menu_url: m.finalUrl };
      }
    }
    if (ld.items.length) return { ...res, items: ld.items, items_url: ldUrl, menu_url: ldUrl, items_from: 'schema_org' };
    if (menuLink) {
      // Only link to a menu page that actually loads
      if (siteOf(menuLink) !== siteOf(base) || !(await mayFetch(menuLink))) return { ...res, menu_url: menuLink };
      await sleep(500);
      const m = await get(menuLink, { cap: 50_000 });
      if (m.ok && (m.status < 400 || m.status === 403)) return { ...res, menu_url: m.finalUrl ?? menuLink };
    }
  } catch (e) {
    return { ...res, extract_error: String(e?.message ?? e).slice(0, 80) };
  }
  return res;
}

/** Check many places with bounded concurrency; one retry pass for temporary failures. */
export async function checkWebsites(rows, { concurrency = 24, log = console.log } = {}) {
  const todo = rows.filter((r) => r.website);
  const results = new Map();
  const run = async (list, conc = concurrency) => {
    let i = 0;
    let done = 0;
    const t0 = Date.now();
    await Promise.all(Array.from({ length: Math.min(conc, list.length) }, async () => {
      while (i < list.length) {
        const row = list[i++];
        results.set(row.source_ref, await checkOne(row));
        if (++done % 250 === 0) log(`  checked ${done}/${list.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
      }
    }));
  };
  await run(todo);
  const retry = todo.filter((r) => results.get(r.source_ref)?.transient);
  if (retry.length) {
    log(`  retrying ${retry.length} sites that timed out, errored or had no DNS answer`);
    await sleep(30_000);
    robotsCache.clear();
    await run(retry, 8);
  }
  // Still no answer after the retry: nothing says the site is gone (many small hosts block datacenter
  // traffic), so keep the link this week. Supabase drops it if it's unreachable two weeks running.
  for (const row of todo) {
    const res = results.get(row.source_ref);
    if (res?.transient) results.set(row.source_ref, { ...res, website: row.website, website_status: 'unreachable', reason: `${res.website_status} ${res.reason ?? ''}`.trim() });
  }
  for (const row of rows) {
    const res = row.website ? results.get(row.source_ref) : { website: null, website_status: 'none', website_checked_at: today(), menu_url: null, items: [], items_url: null };
    const { transient, reason, match, items_from, extract_error, ...fields } = res;
    row._check = { status: res.website_status, reason, match, items_from, extract_error, original: row.website };
    fields.website_dropped = row.website && !fields.website ? row.website : null;
    Object.assign(row, fields);
  }
  return summarize(rows);
}

export function summarize(rows) {
  const s = { places: rows.length, with_site: 0, kept: 0, dropped: 0, status: {}, with_menu_link: 0, with_items: 0, items: 0, items_from: {} };
  for (const r of rows) {
    if (!r._check?.original) continue;
    s.with_site++;
    s.status[r.website_status] = (s.status[r.website_status] ?? 0) + 1;
    if (r.website) s.kept++; else s.dropped++;
    if (r.menu_url) s.with_menu_link++;
    if (r.items?.length) { s.with_items++; s.items += r.items.length; s.items_from[r._check.items_from] = (s.items_from[r._check.items_from] ?? 0) + 1; }
  }
  return s;
}
