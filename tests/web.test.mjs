// Website check: classification, business matching, menu links, free structured menus, robots.txt.
import assert from 'node:assert/strict';
import { classifyPage, findMenuLink, jsonLdMenu, matchBusiness, shopifyItems, wooItems, isShopify, siteOf } from '../scripts/web/classify.mjs';
import { allowed, parseRobots } from '../scripts/web/robots.mjs';

const place = { name: "Mama Ngozi's African Kitchen", kind: 'restaurant', phone: '+1 713-555-0142', street: '9810 Bissonnet St', postcode: '77036' };
const page = (title, body, extra = '') => `<html><head><title>${title}</title>${extra}</head><body>${body}</body></html>`;
const long = 'Fresh jollof, egusi and suya made daily. '.repeat(60);
const c = (html, o = {}) => classifyPage(place, { url: 'https://mamangozi.com/', finalUrl: 'https://mamangozi.com/', status: 200, html, ...o });

// ── keep: right business
assert.deepEqual(c(page("Mama Ngozi's | Houston", long)), { keep: true, status: 'ok', match: 'name' });
assert.equal(c(page('Home', `${long} Call us (713) 555-0142`)).match, 'phone');
assert.equal(matchBusiness(place, { html: page('Home', `${long} Visit 9810 Bissonnet St, Houston`), url: 'https://eatwell.net/' }), 'address');
assert.equal(matchBusiness(place, { html: page('Welcome', long), url: 'https://www.mamangozi.com' }), 'domain', 'domain spells the name');
assert.equal(matchBusiness({ name: 'Jamaican Grill', phone: null }, { html: page('Welcome', long), url: 'https://x.com' }), null, 'generic words alone are not evidence');
assert.equal(matchBusiness({ name: 'Island Spice Grill', phone: null }, { html: page('Island Spice Grill | Miami', long), url: 'https://x.com' }), 'name', 'all-common-word names match as a phrase');
assert.equal(c(page('', '<div id="root"></div>'), { url: 'https://eatwell.net/', finalUrl: 'https://eatwell.net/' }).status, 'unverifiable', 'empty page on an unrelated address');
assert.equal(classifyPage({ name: 'Island Spice Grill' }, { url: 'https://islandspicegrillnyc.com/', finalUrl: 'https://islandspicegrillnyc.com/', status: 200, html: page('', '<div id="root"></div>') }).status, 'thin', 'JavaScript-only pages are kept but marked');

// ── drop: obsolete
assert.equal(c(page('mamangozi.com is for sale', 'Buy this domain. Make an offer on this domain.')).status, 'parked');
assert.equal(c(page('mamangozi.com', 'Parked free, courtesy of GoDaddy.com. Related searches')).status, 'parked');
assert.equal(c(page('Coming Soon', 'Our website is coming soon!')).status, 'placeholder');
assert.equal(c(page('Account Suspended', 'This account has been suspended.')).status, 'placeholder');
assert.equal(c(page('Website Expired', 'This website has expired.')).status, 'placeholder');
assert.equal(c(page('Welcome to nginx!', 'If you see this page, the nginx web server is successfully installed.')).status, 'placeholder');
assert.equal(c(page('Mama Ngozi', `We have permanently closed. Thank you, Houston. ${long}`)).status, 'closed_notice');
assert.equal(c(page("Mama Ngozi's", `We are closed on Mondays. ${long}`)).status, 'ok', '"closed on Mondays" is not a closure');
assert.equal(c(page("Mama Ngozi's", `New dishes coming soon! ${long}`)).status, 'ok', '"coming soon" on a full page is fine');
assert.equal(c(page('x', ''), { status: 404 }).status, 'not_found');
assert.equal(c(page('GoDaddy', ''), { finalUrl: 'https://www.godaddy.com/forsale/mamangozi.com' }).status, 'parked');
assert.equal(classifyPage(place, { url: 'https://mama-ngozi.business.site/', finalUrl: 'https://www.google.com/maps?cid=123', status: 200, html: page('Google Maps', long) }).status, 'redirected_away', 'retired Google business sites');
assert.equal(c(page('Wix', long), { finalUrl: 'https://www.wix.com/' }).status, 'redirected_away');
assert.equal(c(page('Lagos Lounge | Atlanta Nightlife', 'Bottle service and DJs every weekend in Atlanta. '.repeat(40)), { url: 'https://lagoslounge.com/', finalUrl: 'https://lagoslounge.com/' }).status, 'mismatch', 'a different business');
// ── social / ordering links are kept without reading them
assert.equal(c('', { finalUrl: 'https://www.facebook.com/mamangozi' }).status, 'social');
assert.equal(c('', { finalUrl: 'https://www.doordash.com/store/mama-ngozi-123' }).status, 'ordering_platform');
assert.equal(c('', { contentType: 'application/pdf' }).pdf, true);
assert.equal(c(page('SLOT88: Situs Slot Gacor Terpercaya', 'Daftar slot online')).status, 'hijacked', 'expired domain taken over by spammers');

// ── menu links
const nav = `<nav><a href="/">Home</a><a href="/about">About</a><a href="/our-menu/">Our Menu</a><a href="https://order.toasttab.com/online/mama">Order Online</a></nav>`;
assert.equal(findMenuLink(nav, 'https://mamangozi.com/', 'restaurant'), 'https://mamangozi.com/our-menu/');
assert.equal(findMenuLink('<a href="https://order.toasttab.com/online/mama">Order Online</a>', 'https://mamangozi.com/', 'restaurant'), 'https://order.toasttab.com/online/mama');
assert.equal(findMenuLink('<a href="/files/Dinner-Menu-2026.pdf">Download</a>', 'https://mamangozi.com/', 'restaurant'), 'https://mamangozi.com/files/Dinner-Menu-2026.pdf');
assert.equal(findMenuLink('<a href="https://unrelated.com/menu">Menu</a><a href="mailto:x@y.z">Menu</a>', 'https://mamangozi.com/', 'restaurant'), null);
assert.equal(findMenuLink('<a href="/shop">Shop</a>', 'https://afrimart.com/', 'market'), 'https://afrimart.com/shop');

// ── schema.org menus
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
let m = jsonLdMenu(page('x', '', ld({ '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Mama', hasMenu: { '@type': 'Menu', hasMenuSection: [
  { '@type': 'MenuSection', name: 'Soups &amp; stews', hasMenuItem: [{ '@type': 'MenuItem', name: 'Egusi soup', offers: { '@type': 'Offer', price: '14.99', priceCurrency: 'USD' } }] },
  { '@type': 'MenuSection', name: 'Rice', hasMenuItem: [{ '@type': 'MenuItem', name: 'Jollof rice', offers: { price: 12 } }, { '@type': 'MenuItem', name: 'Gift card' }] },
] } })));
assert.deepEqual(m.items, [
  { name: 'Egusi soup', section: 'Soups & stews', price_cents: 1499, price_unit: null, available: true },
  { name: 'Jollof rice', section: 'Rice', price_cents: 1200, price_unit: null, available: true },
], 'gift cards skipped, entities decoded');
assert.equal(jsonLdMenu(page('x', '', ld({ '@graph': [{ '@type': 'Restaurant', hasMenu: 'https://mamangozi.com/menu' }] }))).menuUrl, 'https://mamangozi.com/menu');
assert.equal(jsonLdMenu(page('x', '', ld({ '@type': 'Product', name: 'One thing', offers: { price: 5 } }))).items.length, 0, 'a lone Product is not a list');
assert.equal(jsonLdMenu(page('x', '', '<script type="application/ld+json">{broken</script>')).items.length, 0);

// ── Shopify / WooCommerce feeds
assert.ok(isShopify('<link href="//cdn.shopify.com/s/files/theme.css">'));
assert.deepEqual(shopifyItems({ products: [
  { title: 'Garri (yellow)', product_type: 'Grains & flours', variants: [{ title: '4 lb', price: '12.99', available: true }] },
  { title: 'Palm oil', product_type: 'Oils', variants: [{ title: 'Default Title', price: '10.99', available: false }] },
  { title: 'Shea butter', product_type: '', variants: [{ title: 'Unrefined', price: '8.00', available: true }, { title: 'Refined', price: '7.00', available: false }] },
  { title: 'Shipping Protection', variants: [{ title: 'Default Title', price: '2.00', available: true }] },
] }), [
  { name: 'Garri (yellow)', section: 'Grains & flours', price_cents: 1299, price_unit: '4 lb', available: true },
  { name: 'Palm oil', section: 'Oils', price_cents: 1099, price_unit: null, available: false },
  { name: 'Shea butter (Unrefined)', section: '', price_cents: 800, price_unit: null, available: true },
]);
assert.deepEqual(wooItems([{ name: 'Ogbono &#8211; 1lb', prices: { price: '1199', currency_code: 'USD', currency_minor_unit: 2 }, is_in_stock: true, categories: [{ name: 'Soup ingredients' }] },
  { name: 'Euro thing', prices: { price: '500', currency_code: 'EUR', currency_minor_unit: 2 } }]),
  [{ name: 'Ogbono – 1lb', section: 'Soup ingredients', price_cents: 1199, price_unit: null, available: true }]);

assert.deepEqual(wooItems([
  { name: 'GK Beach Towel', prices: { price: '3500' } }, { name: 'Variable Placeholder Product 1', prices: { price: '11000' } },
  { name: 'Test', prices: { price: '1' } }, { name: 'Open Mic Night - Friday', prices: { price: '1500' } },
  { name: 'Beef patty', prices: { price: '0' } }], 'restaurant').map((x) => [x.name, x.price_cents]), [['Beef patty', null]], 'merch, placeholders, events dropped; $0 means no price');
assert.equal(wooItems([{ name: 'Black soap', prices: { price: '500' } }, { name: 'Coffee mug', prices: { price: '500' } }], 'market').length, 2, 'markets keep household goods');

// ── robots.txt
const rules = parseRobots(`User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nDisallow: /*.json$\nAllow: /products.json\n`);
assert.equal(allowed(rules, '/'), true);
assert.equal(allowed(rules, '/admin/x'), false);
assert.equal(allowed(rules, '/data.json'), false);
assert.equal(allowed(rules, '/products.json'), true, 'longest match wins');
assert.equal(allowed(parseRobots('User-agent: *\nDisallow: /'), '/'), false);
assert.equal(allowed(parseRobots('User-agent: DiasporaMarketMapBot\nDisallow: /\nUser-agent: *\nAllow: /'), '/'), false, 'rules for our bot win');
assert.equal(allowed(parseRobots('User-agent: *\nDisallow:'), '/menu'), true);
assert.equal(siteOf('https://www.shop.example.co.uk/x'), 'example.co.uk');

console.log('✓ website check tests passed');
