// Runs the real migration on an in-process Postgres (PGlite) with a stub of
// Supabase's auth schema/roles, then exercises RLS, quota, ingestion and admin flows.
// Usage: node tests/db.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
await db.exec(SUPABASE_STUB);
for (const f of readdirSync('supabase/migrations').sort()) {
  await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
}

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const asUser = async (uid, sql, params) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const asService = async (sql, params) => {
  await db.exec(`set role service_role`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const one = (r) => r.rows[0];

for (let i = 1; i <= 5; i++) await db.query(`insert into auth.users values ($1, $2)`, [U(i), `u${i}@x.test`]);
assert.equal(one(await db.query('select count(*)::int c from profiles')).c, 5, 'profiles auto-created');

// ── ingestion
const mk = (i, extra = {}) => ({ osm_id: `node/${i}`, name: `Test Place ${i}`, kind: i % 2 ? 'market' : 'restaurant',
  origins: ['nigerian'], regions: ['west_africa'], city: 'Houston', state: 'TX', lat: 29.7 + i / 100, lng: -95.4,
  phone: `+1 713 555 01${i}`, website: null, opening_hours: 'Mo-Sa 10:00-20:00', services: ['takeaway'], ...extra });
let r = one(await asService(`select ingest_osm_places($1::jsonb) r`, [JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((i) => mk(i)))])).r;
assert.deepEqual(r, { inserted: 7, updated: 0 });
r = one(await asService(`select ingest_osm_places($1::jsonb) r`, [JSON.stringify([mk(1, { name: 'Renamed 1' })])])).r;
assert.deepEqual(r, { inserted: 0, updated: 1 });
assert.equal(one(await db.query(`select name from places where osm_id='node/1'`)).name, 'Renamed 1');

await assert.rejects(asUser(U(1), `select ingest_osm_places('[]'::jsonb)`), /permission denied/, 'users cannot ingest');
await assert.rejects(asUser(null, `select mark_missing_osm(now())`), /permission denied/, 'anon cannot mark missing');

// ── stale marking + revival
await db.query(`update places set last_seen_in_source_at = now() - interval '30 days' where osm_id = 'node/7'`);
assert.equal(one(await asService(`select mark_missing_osm(now() - interval '14 days') n`)).n, 1);
assert.equal(one(await db.query(`select status from places where osm_id='node/7'`)).status, 'possibly_closed');
await asService(`select ingest_osm_places($1::jsonb)`, [JSON.stringify([mk(7)])]);
assert.equal(one(await db.query(`select status from places where osm_id='node/7'`)).status, 'active', 'seen again → active');

// ── public read; details are free for everyone (no sign-in, no daily limit)
assert.equal((await asUser(null, `select id from places`)).rows.length, 7, 'anon sees map layer');
assert.equal((await asUser(U(1), `select * from place_details`)).rows.length, 0, 'details table not directly readable');
const ids = (await db.query(`select id from places order by osm_id`)).rows.map((x) => x.id);
for (let i = 0; i < 7; i++) assert.ok(one(await asUser(null, `select get_place_details($1) r`, [ids[i]])).r.details.phone, `anon view ${i + 1}`);
for (let i = 0; i < 7; i++) assert.ok(one(await asUser(U(1), `select get_place_details($1) r`, [ids[i]])).r.details.phone, 'no daily limit');
assert.equal(one(await asUser(null, `select get_place_details($1) r`, [ids[0]])).r.premium, false);
assert.equal('website_dropped' in one(await asUser(null, `select get_place_details($1) r`, [ids[0]])).r.details, false, 'internal fields stay private');

// ── saved places: 10 free, unlimited with Premium; no self-upgrade
await asUser(U(1), `update profiles set plan = 'premium' where id = $1`, [U(1)]);
assert.equal(one(await db.query(`select plan from profiles where id=$1`, [U(1)])).plan, 'free', 'cannot self-upgrade');
for (let i = 0; i < 7; i++) await asUser(U(1), `insert into favorites (user_id, place_id) values ($1, $2)`, [U(1), ids[i]]);
await db.query(`insert into places (name, kind, state, lat, lng, source) select 'Extra '||g, 'market', 'TX', 29.7, -95.4, 'admin' from generate_series(1, 5) g`);
const extra = (await db.query(`select id from places where name like 'Extra %' order by name`)).rows.map((x) => x.id);
for (let i = 0; i < 3; i++) await asUser(U(1), `insert into favorites (user_id, place_id) values ($1, $2)`, [U(1), extra[i]]);
await assert.rejects(asUser(U(1), `insert into favorites (user_id, place_id) values ($1, $2)`, [U(1), extra[3]]), /row-level security/, '11th save needs Premium');
assert.deepEqual([one(await asUser(U(1), `select my_account() r`)).r.saved, one(await asUser(U(1), `select my_account() r`)).r.saved_limit], [10, 10]);
await db.query(`update profiles set plan='premium', plan_expires_at = now() + interval '30 days' where id=$1`, [U(1)]);
await asUser(U(1), `insert into favorites (user_id, place_id) values ($1, $2)`, [U(1), extra[3]]);
assert.ok(one(await asUser(U(1), `select get_place_details($1) r`, [ids[5]])).r.premium);
await db.query(`update profiles set plan_expires_at = now() - interval '1 day' where id=$1`, [U(1)]);
assert.equal(one(await asUser(U(1), `select my_account() r`)).r.plan, 'free', 'expired premium → free');
await db.query(`delete from places where name like 'Extra %'`);

// ── closed reports → possibly_closed
await asUser(U(2), `insert into reports (place_id, kind) values ($1, 'closed')`, [ids[2]]);
assert.equal(one(await db.query(`select status from places where id=$1`, [ids[2]])).status, 'active', 'one report not enough');
await asUser(U(3), `insert into reports (place_id, kind) values ($1, 'closed')`, [ids[2]]);
assert.equal(one(await db.query(`select status from places where id=$1`, [ids[2]])).status, 'possibly_closed');
assert.equal((await asUser(U(2), `select * from reports`)).rows.length, 1, 'users see only own reports');

// ── confirmations → community + revival
for (const u of [U(2), U(3), U(4)]) await asUser(u, `insert into confirmations (user_id, place_id) values ($1, $2)`, [u, ids[2]]);
const p2 = one(await db.query(`select verification, status, confirm_count from places where id=$1`, [ids[2]]));
assert.deepEqual(p2, { verification: 'community', status: 'active', confirm_count: 3 });

// ── admin
await assert.rejects(asUser(U(2), `select admin_verify_place($1, 'x')`, [ids[3]]), /admin only/);
await db.query(`update profiles set is_admin = true where id=$1`, [U(5)]);
await asUser(U(5), `select admin_verify_place($1, 'Called 11/18')`, [ids[3]]);
assert.equal(one(await db.query(`select verification from places where id=$1`, [ids[3]])).verification, 'verified');
const osm3 = one(await db.query(`select osm_id from places where id=$1`, [ids[3]])).osm_id;
await asService(`select ingest_osm_places($1::jsonb)`, [JSON.stringify([mk(Number(osm3.split('/')[1]), { name: 'OSM overwrite', phone: '000' })])]);
const locked = one(await db.query(`select p.name, d.phone from places p join place_details d on d.place_id=p.id where p.id=$1`, [ids[3]]));
assert.notEqual(locked.name, 'OSM overwrite', 'locked name survives ingestion');
assert.notEqual(locked.phone, '000', 'locked details survive ingestion');
assert.equal((await asUser(U(5), `select * from place_details`)).rows.length, 7, 'admin reads details');

const rep = one(await asUser(U(2), `insert into reports (kind, payload) values ('new_place', $1) returning id`,
  [JSON.stringify({ name: 'New Spot', kind: 'market', state: 'tx', city: 'Katy', origins: ['ghanaian'], regions: ['west_africa'], phone: '555' })])).id;
const newId = one(await asUser(U(5), `select admin_approve_new_place($1, 29.78, -95.82) id`, [rep])).id;
assert.equal(one(await db.query(`select state, verification, source from places where id=$1`, [newId])).state, 'TX');

assert.equal(one(await db.query(`select next_index from ingest_state`)).next_index, 0);
assert.equal((await asUser(U(2), `select * from ingest_state`)).rows.length, 0, 'non-admins cannot see import state');
assert.equal((await asUser(U(5), `select * from ingest_state`)).rows.length, 1, 'admin sees import state');

// ── Overture ingestion (generic source-keyed)
const ov = (i, extra = {}) => ({ source_ref: `overture:o${i}`, name: `Ov Place ${i}`, kind: 'restaurant', origins: ['ethiopian'], regions: ['east_africa'],
  city: 'Atlanta', state: 'GA', lat: 33.7, lng: -84.4, street: '1 St', postcode: '30301', phone: '555', website: null, opening_hours: null,
  instagram: null, facebook: null, services: [], confidence: 0.9, ...extra });
await assert.rejects(asUser(U(1), `select ingest_places('[]'::jsonb, 'overture')`), /permission denied/);
r = one(await asService(`select ingest_places($1::jsonb, 'overture') r`, [JSON.stringify([ov(1), ov(2), ov(3)])])).r;
assert.deepEqual(r, { inserted: 3, updated: 0 });
r = one(await asService(`select ingest_places($1::jsonb, 'overture') r`, [JSON.stringify([ov(1, { name: 'Ov Renamed' })])])).r;
assert.deepEqual(r, { inserted: 0, updated: 1 });
assert.equal(one(await db.query(`select name, source from places where source_ref='overture:o1'`)).name, 'Ov Renamed');
const o2 = one(await db.query(`select id from places where source_ref='overture:o2'`)).id;
await asUser(U(5), `select admin_verify_place($1, 'checked')`, [o2]);
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([ov(2, { name: 'Should Not Apply', phone: '000' })])]);
const lockedOv = one(await db.query(`select p.name, d.phone from places p join place_details d on d.place_id = p.id where p.id = $1`, [o2]));
assert.deepEqual(lockedOv, { name: 'Ov Place 2', phone: '555' }, 'admin-verified Overture place is not overwritten');
await db.query(`update places set last_seen_in_source_at = now() - interval '40 days' where source = 'overture'`);
assert.equal(one(await asService(`select mark_missing_source('overture', now() - interval '1 day') n`)).n, 2, 'verified one is exempt');
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([ov(3)])]);
assert.equal(one(await db.query(`select status from places where source_ref='overture:o3'`)).status, 'active', 'reappears → active');

// ── detail accuracy votes
const vp = ids[4];
await asUser(U(1), `insert into detail_votes (user_id, place_id, vote) values ($1, $2, 1)`, [U(1), vp]);
await asUser(U(2), `insert into detail_votes (user_id, place_id, vote) values ($1, $2, -1)`, [U(2), vp]);
await asUser(U(3), `insert into detail_votes (user_id, place_id, vote) values ($1, $2, -1)`, [U(3), vp]);
let tally = one(await db.query(`select accurate_votes a, inaccurate_votes i from places where id = $1`, [vp]));
assert.deepEqual(tally, { a: 1, i: 2 });
await asUser(U(2), `update detail_votes set vote = 1 where user_id = $1 and place_id = $2`, [U(2), vp]);
tally = one(await db.query(`select accurate_votes a, inaccurate_votes i from places where id = $1`, [vp]));
assert.deepEqual(tally, { a: 2, i: 1 }, 'changing a vote moves the tally');
await assert.rejects(asUser(U(1), `insert into detail_votes (user_id, place_id, vote) values ($1, $2, 1)`, [U(2), ids[5]]), /row-level security/, 'cannot vote as someone else');
await assert.rejects(asUser(U(1), `insert into detail_votes (user_id, place_id, vote) values ($1, $2, 5)`, [U(1), ids[5]]), /check constraint/);
assert.equal((await asUser(U(1), `select * from detail_votes`)).rows.length, 1, 'users see only their own votes');
await assert.rejects(asUser(null, `insert into detail_votes (place_id, vote) values ($1, 1)`, [vp]), /permission denied|row-level security|null value/);
await asUser(U(5), `select admin_verify_place($1, 'rechecked')`, [vp]);
tally = one(await db.query(`select accurate_votes a, inaccurate_votes i from places where id = $1`, [vp]));
assert.deepEqual(tally, { a: 0, i: 0 }, 'admin verification resets the tally');
await asUser(U(3), `update detail_votes set vote = -1 where user_id = $1 and place_id = $2`, [U(3), vp]);
tally = one(await db.query(`select accurate_votes a, inaccurate_votes i from places where id = $1`, [vp]));
assert.deepEqual(tally, { a: 0, i: 1 }, 'only votes after verification count');

// ── updated_at moves only for map-visible changes (keeps snapshot deltas small)
const before = one(await db.query(`select updated_at from places where source_ref = 'overture:o3'`)).updated_at;
await new Promise((r) => setTimeout(r, 20));
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([ov(3)])]);
assert.equal(+one(await db.query(`select updated_at from places where source_ref = 'overture:o3'`)).updated_at, +before, 'unchanged re-import keeps updated_at');
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([ov(3, { name: 'Ov Three Renamed' })])]);
assert.ok(+one(await db.query(`select updated_at from places where source_ref = 'overture:o3'`)).updated_at > +before, 'rename bumps updated_at');

// ── menus / product lists
const ip = ids[2];
const upsert = (uid, args) => asUser(uid, `select upsert_place_item($1, $2, $3, $4, $5, $6, $7, $8) r`,
  [ip, args.name, args.section ?? '', args.description ?? null, args.price ?? null, args.unit ?? null, args.available ?? true, args.id ?? null]).then((x) => one(x).r);
assert.equal(one(await asUser(null, `select upsert_place_item($1, 'Egusi') r`, [ip]).catch(() => ({ rows: [{ r: { error: 'denied' } }] }))).r.error !== undefined, true, 'anon cannot add items');
let it = await upsert(U(2), { name: '  Egusi   seeds ', section: 'Soup ingredients', price: 899, unit: 'LB' });
assert.equal(it.item.name, 'Egusi seeds', 'name is tidied');
assert.equal(it.item.price_unit, 'lb');
assert.equal(it.item.created_by, undefined, 'contributor id is not returned');
const egusi = it.item.id;
it = await upsert(U(3), { name: 'egusi seeds', unit: 'lb', price: 949, section: 'Soup ingredients' });
assert.equal(it.item.id, egusi, 'same name + unit updates instead of duplicating');
assert.equal(it.item.price_cents, 949);
await upsert(U(2), { name: 'Garri (yellow)', section: 'Grains & flours', price: 1299, unit: 'bag' });
assert.equal(one(await db.query(`select item_count c from places where id = $1`, [ip])).c, 2, 'place item_count kept');
assert.equal(one(await db.query(`select count(*)::int c from place_item_edits where place_id = $1`, [ip])).c, 3, 'every change is logged');
assert.equal((await asUser(U(2), `select * from place_items`).catch(() => ({ rows: [] }))).rows.length, 0, 'items not directly readable');
await assert.rejects(asUser(U(2), `insert into place_items (place_id, name) values ($1, 'x')`, [ip]), /permission denied|row-level security/);
await assert.rejects(asUser(U(2), `select refresh_place_item_summary($1)`, [ip]), /permission denied/);
assert.equal((await upsert(U(2), { name: '' })).error, 'bad_name');
assert.equal((await upsert(U(2), { name: 'x'.repeat(81) })).error, 'bad_name');

// items come with details (and use the same daily view)
let det = one(await asUser(U(1), `select get_place_details($1) r`, [ip])).r;
assert.equal(det.items.length, 2);
assert.deepEqual(det.items.map((x) => x.section), ['Grains & flours', 'Soup ingredients'], 'grouped by section');
assert.ok(det.items.every((x) => !('created_by' in x)), 'no contributor ids in details');
// public search: names only
let found = one(await asUser(null, `select search_items('EGUSI') r`)).r;
assert.deepEqual(found, [{ place_id: ip, items: ['egusi seeds'] }], 'latest edit wins the spelling');
assert.equal(one(await asUser(null, `select search_items('%') r`)).r.length, 0, 'wildcards are literal');
assert.equal(one(await asUser(null, `select search_items('e') r`)).r.length, 0, 'needs 2+ characters');
assert.equal(one(await asUser(null, `select search_items('egusi', 'ny') r`)).r.length, 0, 'state filter');

// votes: still right / changed; an edit resets them; 3+ "changed" outvoting hides the item
await asUser(U(1), `insert into place_item_votes (item_id, vote) values ($1, 1)`, [egusi]);
for (const u of [2, 3, 4]) await asUser(U(u), `insert into place_item_votes (item_id, vote) values ($1, -1)`, [egusi]);
let row = one(await db.query(`select confirm_count c, changed_count x, hidden h, hidden_reason hr from place_items where id = $1`, [egusi]));
assert.deepEqual(row, { c: 1, x: 3, h: true, hr: 'votes' });
assert.equal(one(await db.query(`select item_count c from places where id = $1`, [ip])).c, 1, 'hidden items drop out of the count');
assert.equal(one(await asUser(null, `select search_items('egusi') r`)).r.length, 0, 'hidden items are not searchable');
it = await upsert(U(4), { id: egusi, name: 'Egusi seeds', unit: 'lb', price: 1099, section: 'Soup ingredients' });
row = one(await db.query(`select confirm_count c, changed_count x, hidden h from place_items where id = $1`, [egusi]));
assert.deepEqual(row, { c: 0, x: 0, h: false }, 'an update restores the item and starts the votes fresh');
await assert.rejects(asUser(U(1), `insert into place_item_votes (item_id, user_id, vote) values ($1, $2, 1)`, [egusi, U(2)]), /row-level security/);

// removal: own item within a day, or admin
const garri = det.items.find((x) => x.name.startsWith('Garri')).id;
assert.equal(one(await asUser(U(3), `select remove_place_item($1) r`, [garri])).r.error, 'forbidden');
assert.equal(one(await asUser(U(2), `select remove_place_item($1) r`, [garri])).r.ok, true);
assert.equal(one(await asUser(U(5), `select admin_item_queue() r`)).r.recent[0].action, 'remove');
await assert.rejects(asUser(U(2), `select admin_item_queue()`), /admin only/);
await asUser(U(5), `select admin_set_item_hidden($1, true)`, [egusi]);
assert.equal(one(await db.query(`select item_count c from places where id = $1`, [ip])).c, 0);
await asUser(U(5), `select admin_set_item_hidden($1, false)`, [egusi]);
assert.equal(one(await db.query(`select item_count c from places where id = $1`, [ip])).c, 1);

// rate limit
await db.query(`insert into place_item_edits (item_id, place_id, user_id, action) select gen_random_uuid(), $1, $2, 'add' from generate_series(1, 60)`, [ip, U(3)]);
assert.equal((await upsert(U(3), { name: 'Ogbono' })).error, 'rate_limited');

// ── website check results + imported menus
const wsRef = 'overture:o1';
const wsPid = one(await db.query(`select id from places where source_ref = $1`, [wsRef])).id;
const wsRow = (extra) => ({ ...ov(1), website: 'https://ov1.example/', website_status: 'ok', website_checked_at: '2026-11-25', website_dropped: null,
  menu_url: 'https://ov1.example/menu', items_url: 'https://ov1.example/menu', ...extra });
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([wsRow({ items: [
  { name: 'Jollof rice', section: 'Rice', price_cents: 1200, available: true },
  { name: 'Egusi soup', section: 'Soups', price_cents: 1499, available: true },
] })])]);
let wd = one(await db.query(`select website, website_status, menu_url from place_details where place_id = $1`, [wsPid]));
assert.deepEqual(wd, { website: 'https://ov1.example/', website_status: 'ok', menu_url: 'https://ov1.example/menu' });
let wi = (await db.query(`select name, source, price_cents from place_items where place_id = $1 order by name`, [wsPid])).rows;
assert.deepEqual(wi.map((x) => [x.name, x.source, x.price_cents]), [['Egusi soup', 'website', 1499], ['Jollof rice', 'website', 1200]]);
// a person edits one → it becomes theirs; the next import leaves it alone and removes what the site dropped
const jollof = one(await db.query(`select id from place_items where place_id = $1 and name = 'Jollof rice'`, [wsPid])).id;
await asUser(U(2), `select upsert_place_item($1, 'Jollof rice', 'Rice', null, 1350, null, true, $2)`, [wsPid, jollof]);
assert.equal(one(await db.query(`select source from place_items where id = $1`, [jollof])).source, 'community');
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([wsRow({ website_checked_at: '2026-12-02', items: [
  { name: 'Jollof rice', section: 'Rice', price_cents: 999, available: true },
  { name: 'Suya', section: 'Grills', price_cents: 1500, available: false },
] })])]);
wi = (await db.query(`select name, source, price_cents, available from place_items where place_id = $1 order by name`, [wsPid])).rows;
assert.deepEqual(wi.map((x) => [x.name, x.source, x.price_cents, x.available]), [['Jollof rice', 'community', 1350, true], ['Suya', 'website', 1500, false]],
  'people\'s edits win; items gone from the site are removed');
assert.equal(one(await db.query(`select item_count c from places where id = $1`, [wsPid])).c, 2);
// a run without the website check keeps earlier results; a dead site drops the link
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([ov(1)])]);
assert.equal(one(await db.query(`select website_status s from place_details where place_id = $1`, [wsPid])).s, 'ok');
assert.equal((await db.query(`select 1 from place_items where place_id = $1`, [wsPid])).rows.length, 2, 'rows without items leave items alone');
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([wsRow({ website: null, website_status: 'parked', website_dropped: 'https://ov1.example/', menu_url: null, items_url: null, items: [] })])]);
wd = one(await db.query(`select website, website_status, website_dropped from place_details where place_id = $1`, [wsPid]));
assert.deepEqual(wd, { website: null, website_status: 'parked', website_dropped: 'https://ov1.example/' });
assert.deepEqual((await db.query(`select name from place_items where place_id = $1`, [wsPid])).rows.map((x) => x.name), ['Jollof rice'], 'website items go with the website');
await assert.rejects(asUser(U(2), `select ingest_website_items($1, '[]'::jsonb, now())`, [wsPid]), /permission denied/);
const wr = one(await asUser(U(5), `select admin_website_report() r`)).r;
assert.equal(wr.counts.parked, 1);
await assert.rejects(asUser(U(2), `select admin_website_report()`), /admin only/);

// two weeks unreachable → link dropped
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([wsRow({ website_status: 'unreachable' })])]);
assert.equal(one(await db.query(`select website from place_details where place_id = $1`, [wsPid])).website, 'https://ov1.example/', 'first week: kept');
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([wsRow({ website_status: 'unreachable' })])]);
assert.equal(one(await db.query(`select website from place_details where place_id = $1`, [wsPid])).website, 'https://ov1.example/', 'two runs the same day are one strike');
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([wsRow({ website_status: 'unreachable', website_checked_at: '2026-12-09' })])]);
wd = one(await db.query(`select website, website_status, website_dropped from place_details where place_id = $1`, [wsPid]));
assert.deepEqual(wd, { website: null, website_status: 'unreachable_twice', website_dropped: 'https://ov1.example/' }, 'second week: dropped');
await asService(`select ingest_places($1::jsonb, 'overture')`, [JSON.stringify([wsRow({ website_status: 'ok', website_checked_at: '2026-12-16' })])]);
assert.equal(one(await db.query(`select website from place_details where place_id = $1`, [wsPid])).website, 'https://ov1.example/', 'back when it answers');

// ── products and price comparison
await db.query(`update profiles set plan = 'free', plan_expires_at = null where id = $1`, [U(1)]);
const mk1 = ids[0], mk2 = ids[2];   // markets (odd node numbers)
assert.equal(one(await db.query(`select kind from places where id = $1`, [mk1])).kind, 'market');
const addItem = (uid, place, name, cents, unit = null) => asUser(uid, `select upsert_place_item($1, $2, '', null, $3, $4, true, null) r`, [place, name, cents, unit]).then((x) => one(x).r);
await addItem(U(1), mk1, 'Egusi seeds', 899, 'lb');
await addItem(U(1), mk2, 'Ground Egusi 2lb bag', 1500, 'each');
await addItem(U(1), mk2, 'Bitter kola', 500);
assert.equal(one(await db.query(`select product_key k from place_items where name = 'Ground Egusi 2lb bag'`)).k, 'egusi');
assert.equal(one(await db.query(`select product_key k from place_items where name = 'Bitter kola'`)).k, 'bitter-kola', 'specific product wins over "kola"');
const ov2 = one(await asUser(null, `select product_overview() r`)).r;
assert.deepEqual(ov2.find((x) => x.key === 'egusi'), { key: 'egusi', kind: 'market', label: 'Egusi (melon seeds)', places: 2, min_cents: 899, max_cents: 1500 });
let cmp = one(await asUser(null, `select compare_prices('market', 'egusi', 29.7, -95.4) r`)).r;
assert.equal(cmp.places, 2);
assert.equal(cmp.premium, false);
assert.ok(cmp.rows.every((x) => x.price_cents === null && x.per_lb_cents === null), 'free: which stores, not their prices');
await db.query(`update profiles set plan='premium', plan_expires_at = now() + interval '30 days' where id=$1`, [U(4)]);
cmp = one(await asUser(U(4), `select compare_prices('market', 'egusi') r`)).r;
assert.deepEqual(cmp.rows.map((x) => [x.item, x.price_cents, x.per_lb_cents]), [['Ground Egusi 2lb bag', 1500, 750], ['Egusi seeds', 899, 899]], 'premium: cheapest per pound first');
assert.equal(one(await asUser(null, `select compare_prices('market', 'nope') r`)).r.error, 'not_found');
assert.equal(one(await db.query(`select item_pounds('Garri', '4 lb') p`)).p, '4');
assert.equal(one(await db.query(`select match_product('restaurant', 'Jollof rice party tray (feeds 20)') k`)).k, null, 'catering trays are not compared with plates');
assert.equal(one(await db.query(`select match_product('market', 'Maggi cubes case of 24') k`)).k, null);
assert.equal(one(await db.query(`select match_product('restaurant', 'Jollof rice') k`)).k, 'jollof-rice');

// ── owner claims
await db.query(`update place_details set website = 'https://www.tp3market.com/', website_status = 'ok' where place_id = $1`, [mk2]);
await db.query(`update auth.users set email = 'owner@tp3market.com' where id = $1`, [U(2)]);
let cl = one(await asUser(U(2), `select claim_place($1, 'Ada', '713-555-0100', 'Owner', 'Hi') r`, [mk2])).r;
assert.deepEqual([cl.status, cl.method], ['verified', 'email_domain'], 'email at the business domain verifies instantly');
cl = one(await asUser(U(3), `select claim_place($1, 'Bo', null, 'Manager', null) r`, [mk2])).r;
assert.equal(cl.status, 'pending', 'a gmail-style address waits for website code or admin');
assert.match(cl.code, /^dmm-[0-9a-f]{16}$/);
await db.query(`update auth.users set email = 'me@gmail.com' where id = $1`, [U(3)]);
await db.query(`update place_details set website = 'https://gmail.com' where place_id = $1`, [mk1]);
assert.equal(one(await asUser(U(3), `select claim_place($1) r`, [mk1])).r.status, 'pending', 'free mail domains never verify a business');
assert.equal(one(await asUser(null, `select get_place_details($1) r`, [mk2])).r.owner.claimed, true);
assert.equal(one(await asUser(U(2), `select get_place_details($1) r`, [mk2])).r.owner.you, true);
// owners edit details (locked against the weekly import) and own their items
assert.equal(one(await asUser(U(3), `select owner_update_place($1, '{"phone":"1"}'::jsonb) r`, [mk2])).r.error, 'forbidden');
assert.equal(one(await asUser(U(2), `select owner_update_place($1, '{"website":"not a url"}'::jsonb) r`, [mk2])).r.error, 'bad_website');
await asUser(U(2), `select owner_update_place($1, '{"phone":"+1 713 555 0199","opening_hours":"Mo-Su 09:00-21:00","description":"Family run since 1998"}'::jsonb)`, [mk2]);
const od = one(await db.query(`select phone, opening_hours, description, locked from place_details where place_id = $1`, [mk2]));
assert.deepEqual(od, { phone: '+1 713 555 0199', opening_hours: 'Mo-Su 09:00-21:00', description: 'Family run since 1998', locked: true });
const oi = await addItem(U(2), mk2, 'Palm oil', 1099, 'bottle');
assert.equal(oi.item.source, 'owner');
assert.equal((await addItem(U(4), mk2, 'Palm oil', 999, 'bottle')).error, 'owner_item', 'the community cannot overwrite an owner\'s item');
assert.equal(one(await asUser(U(2), `select remove_place_item($1) r`, [one(await db.query(`select id from place_items where name = 'Bitter kola'`)).id])).r.ok, true, 'owners can remove items at their place');
// admin queue
assert.equal(one(await asUser(U(5), `select admin_claims() r`)).r.filter((x) => x.status === 'pending').length, 2);
const pend = one(await db.query(`select id from place_claims where user_id = $1 and place_id = $2`, [U(3), mk2])).id;
await asUser(U(5), `select admin_decide_claim($1, false, 'Could not reach them')`, [pend]);
assert.equal(one(await db.query(`select status from place_claims where id = $1`, [pend])).status, 'rejected');
await assert.rejects(asUser(U(3), `select admin_decide_claim($1, true)`, [pend]), /admin only/);
assert.equal((await asUser(U(3), `select * from place_claims`)).rows.length, 2, 'users see only their own claims');
await assert.rejects(asUser(U(3), `update place_claims set status = 'verified'`), /permission denied/);

// ── menu signs on the public layer
await db.query(`update place_details set menu_url = 'https://x.example/menu' where place_id = $1`, [mk2]);
let sign = one(await asUser(null, `select item_count, items_updated_at is not null fresh, menu_link from places where id = $1`, [mk2]));
assert.ok(sign.item_count > 0 && sign.fresh && sign.menu_link, 'item count, freshness and menu link are public');
const u0 = one(await db.query(`select updated_at from places where id = $1`, [mk2])).updated_at;
await new Promise((r) => setTimeout(r, 20));
await addItem(U(2), mk2, 'Stockfish', 2500);
assert.ok(+one(await db.query(`select updated_at from places where id = $1`, [mk2])).updated_at > +u0, 'a menu change reaches the map snapshot delta');
await db.query(`update place_details set menu_url = null where place_id = $1`, [mk2]);
assert.equal(one(await db.query(`select menu_link from places where id = $1`, [mk2])).menu_link, false);

// ── public export for the page builder
const ex = one(await asUser(null, `select export_public_places(null, 3) r`)).r;
assert.equal(ex.length, 3);
assert.ok('phone' in ex[0] && 'items' in ex[0] && !('website_dropped' in ex[0]));
const ex2 = one(await asUser(null, `select export_public_places($1, 1000) r`, [ex[2].id])).r;
assert.ok(ex2.every((x) => x.id > ex[2].id), 'pages by id');

console.log('✓ all database tests passed');
