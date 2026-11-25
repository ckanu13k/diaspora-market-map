// Round-trip test for the compact snapshot row format.
import assert from 'node:assert/strict';
import { decodeRow, encodeRow } from '../src/lib/snapshot-format.js';

const regionOf = (o) => ({ nigerian: 'west_africa', ghanaian: 'west_africa', jamaican: 'caribbean' })[o];
const p = { id: 'a', name: 'Fixture Kitchen', kind: 'restaurant', origins: ['nigerian', 'ghanaian'], city: null,
  state: 'TX', lat: 29.7612345, lng: -95.3698765, status: 'possibly_closed', verification: 'community', verified_at: null, featured: true,
  confirm_count: 3, accurate_votes: 2, inaccurate_votes: 1, last_confirmed_at: '2026-11-20T00:00:00.000Z', source: 'overture', updated_at: '2026-11-21T10:20:30.000Z',
  item_count: 24, items_updated_at: '2026-11-24T08:00:00.000Z', menu_link: true };
const back = decodeRow(JSON.parse(JSON.stringify(encodeRow(p))), regionOf);
assert.deepEqual(back.origins, ['nigerian', 'ghanaian']);
assert.deepEqual(back.regions, ['west_africa']);
assert.equal(back.kind, 'restaurant'); assert.equal(back.status, 'possibly_closed'); assert.equal(back.verification, 'community');
assert.equal(back.source, 'overture'); assert.equal(back.featured, true); assert.equal(back.city, null);
assert.equal(back.lat, 29.76123); assert.equal(back.inaccurate_votes, 1);
assert.equal(back.updated_at, '2026-11-21T10:20:30.000Z'); assert.equal(back.verified_at, null);
assert.equal(back.last_confirmed_at, '2026-11-20T00:00:00.000Z');
assert.deepEqual(decodeRow(encodeRow({ ...p, origins: [] }), regionOf).origins, []);
assert.equal(decodeRow(encodeRow({ ...p, kind: 'market', status: 'active', verification: 'verified' }), regionOf).kind, 'market');
assert.equal(back.item_count, 24); assert.equal(back.items_updated_at, '2026-11-24T08:00:00.000Z'); assert.equal(back.menu_link, true);
const none = decodeRow(encodeRow({ ...p, item_count: undefined, items_updated_at: null, menu_link: false }), regionOf);
assert.deepEqual([none.item_count, none.items_updated_at, none.menu_link], [0, null, false]);
console.log('✓ snapshot format tests passed');
