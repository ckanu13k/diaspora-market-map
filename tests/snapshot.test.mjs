// Round-trip test for the compact snapshot row format.
import assert from 'node:assert/strict';
import { COLS, decodeRow, encodeRow } from '../src/lib/snapshot-format.js';

const p = { id: 'a', name: 'Fixture Kitchen', kind: 'restaurant', origins: ['nigerian', 'ghanaian'], regions: ['west_africa'], city: null,
  state: 'TX', lat: 29.7612345, lng: -95.3698765, status: 'active', verification: 'community', verified_at: null, featured: true,
  confirm_count: 3, accurate_votes: 2, inaccurate_votes: 0, last_confirmed_at: '2026-11-20T00:00:00Z', source: 'overture', updated_at: '2026-11-21T00:00:00Z' };
const row = encodeRow(p);
assert.equal(row.length, COLS.length);
const back = decodeRow(JSON.parse(JSON.stringify(row)));
assert.deepEqual(back.origins, ['nigerian', 'ghanaian']);
assert.equal(back.featured, true);
assert.equal(back.lat, 29.76123);
assert.equal(back.city, null);
assert.deepEqual(decodeRow(encodeRow({ ...p, origins: [], regions: [] })).origins, []);
console.log('✓ snapshot format tests passed');
