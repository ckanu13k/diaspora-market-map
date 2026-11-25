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

// ── public read / details hidden
assert.equal((await asUser(null, `select id from places`)).rows.length, 7, 'anon sees map layer');
assert.equal((await asUser(U(1), `select * from place_details`)).rows.length, 0, 'details not directly readable');
assert.equal(one(await asUser(null, `select get_place_details(gen_random_uuid()) r`)).r.error, 'auth_required');

// ── metered quota (5/day)
const ids = (await db.query(`select id from places order by osm_id`)).rows.map((x) => x.id);
for (let i = 0; i < 5; i++) {
  const res = one(await asUser(U(1), `select get_place_details($1) r`, [ids[i]])).r;
  assert.ok(res.details.phone, `view ${i + 1} returns details`);
  assert.equal(res.used, i + 1);
}
assert.equal(one(await asUser(U(1), `select get_place_details($1) r`, [ids[0]])).r.used, 5, 're-view same place is free');
assert.equal(one(await asUser(U(1), `select get_place_details($1) r`, [ids[5]])).r.error, 'quota_exceeded');
assert.equal(one(await asUser(U(1), `select my_account() r`)).r.used_today, 5);

// ── no self-upgrade; premium unlocks
await asUser(U(1), `update profiles set plan = 'premium' where id = $1`, [U(1)]);
assert.equal(one(await db.query(`select plan from profiles where id=$1`, [U(1)])).plan, 'free', 'cannot self-upgrade');
await assert.rejects(asUser(U(1), `insert into favorites (user_id, place_id) values ($1, $2)`, [U(1), ids[0]]), /row-level security/);
await db.query(`update profiles set plan='premium', plan_expires_at = now() + interval '30 days' where id=$1`, [U(1)]);
assert.ok(one(await asUser(U(1), `select get_place_details($1) r`, [ids[5]])).r.premium, 'premium bypasses quota');
await asUser(U(1), `insert into favorites (user_id, place_id) values ($1, $2)`, [U(1), ids[0]]);
await db.query(`update profiles set plan_expires_at = now() - interval '1 day' where id=$1`, [U(1)]);
assert.equal(one(await asUser(U(1), `select my_account() r`)).r.plan, 'free', 'expired premium → free');

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

console.log('✓ all database tests passed');
