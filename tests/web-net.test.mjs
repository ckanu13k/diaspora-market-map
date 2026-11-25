// End-to-end check of scripts/web/check.mjs against local fake websites (no internet needed).
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkOne } from '../scripts/web/check.mjs';

const routes = {
  '/robots.txt': [200, 'text/plain', 'User-agent: *\nDisallow: /private\n'],
  '/': [200, 'text/html', `<html><head><title>Afri Mart Houston</title><link href="//cdn.shopify.com/x.css"></head><body>${'African groceries in Houston. '.repeat(80)}<a href="/shop">Shop</a></body></html>`],
  '/products.json': [200, 'application/json', JSON.stringify({ products: [{ title: 'Garri', product_type: 'Flours', variants: [{ title: 'Default Title', price: '9.99', available: true }] }] })],
};
const menuSite = {
  '/robots.txt': [404, 'text/plain', ''],
  '/': [200, 'text/html', `<html><head><title>Mama Ngozi Kitchen</title></head><body>${'Nigerian food. '.repeat(120)}<a href="/menu">Menu</a></body></html>`],
  '/menu': [200, 'text/html', `<html><head><title>Menu</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Menu', hasMenuSection: [{ name: 'Rice', hasMenuItem: [{ name: 'Jollof rice', offers: { price: '12.00' } }] }] })}</script></head><body>Menu</body></html>`],
};
const linkOnly = {
  '/robots.txt': [200, 'text/plain', 'User-agent: *\nAllow: /\n'],
  '/': [200, 'text/html', `<html><head><title>Island Spice Grill</title></head><body>${'Caribbean food. '.repeat(120)}<a href="/our-menu">Our Menu</a></body></html>`],
  '/our-menu': [200, 'text/html', '<html><body>Photos of our menu</body></html>'],
};
const parked = { '/robots.txt': [404, 'text/plain', ''], '/': [200, 'text/html', '<html><head><title>islandspice.com</title></head><body>This domain is for sale! Make an offer on this domain.</body></html>'] };
const blocked = { '/robots.txt': [200, 'text/plain', 'User-agent: *\nDisallow: /\n'], '/': [200, 'text/html', 'x'] };
const sites = [routes, menuSite, linkOnly, parked, blocked];
const servers = await Promise.all(sites.map((r) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    const [status, type, body] = r[req.url.split('?')[0]] ?? [404, 'text/plain', 'not found'];
    res.writeHead(status, { 'content-type': type }); res.end(body);
  }).listen(0, '127.0.0.1', () => ok(s));
})));
const url = (i) => `http://127.0.0.1:${servers[i].address().port}/`;

let r = await checkOne({ name: 'Afri Mart', kind: 'market', website: url(0) });
assert.equal(r.website_status, 'ok');
assert.deepEqual(r.items, [{ name: 'Garri', section: 'Flours', price_cents: 999, price_unit: null, available: true }]);
assert.equal(r.items_from, 'shopify');

r = await checkOne({ name: 'Mama Ngozi Kitchen', kind: 'restaurant', website: url(1) });
assert.equal(r.items_from, 'schema_org', 'follows the menu link and reads its menu data');
assert.equal(r.items[0].name, 'Jollof rice');
assert.equal(r.menu_url, `${url(1)}menu`);

r = await checkOne({ name: 'Island Spice Grill', kind: 'restaurant', website: url(2) });
assert.equal(r.items.length, 0);
assert.equal(r.menu_url, `${url(2)}our-menu`, 'no menu data: link to their menu page');

r = await checkOne({ name: 'Island Spice Grill', kind: 'restaurant', website: url(3) });
assert.equal(r.website, null);
assert.equal(r.website_status, 'parked');

r = await checkOne({ name: 'Somewhere', kind: 'restaurant', website: url(4) });
assert.equal(r.website_status, 'not_checked_robots');
assert.equal(r.website, url(4), 'kept, not fetched');

r = await checkOne({ name: 'Gone', kind: 'restaurant', website: 'http://127.0.0.1:1/' });
assert.equal(r.website, null);

servers.forEach((s) => s.close());
console.log('✓ website check network tests passed');
