// Unit tests for Overture → row mapping. Records are synthetic fixtures, not real businesses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOverture, stateCode } from '../scripts/overture/core.mjs';

const { toRow } = createOverture(JSON.parse(readFileSync('shared/taxonomy.json', 'utf8')));
const rec = (o) => ({ id: 'x1', name: 'Fixture', cats: [], confidence: 0.9, websites: null, socials: null, phones: null,
  addr: { freeform: '1 Test St', locality: 'Houston', postcode: '77001-1234', region: 'TX', country: 'US' }, lng: -95.37, lat: 29.76, ...o });

let r = toRow(rec({ name: 'Fixture Kitchen', cats: ['nigerian_restaurant', 'african_restaurant', 'restaurant'], phones: ['+17135550100'], websites: ['example.com'], socials: ['https://www.facebook.com/x', 'https://instagram.com/y'] }));
assert.deepEqual(r.origins, ['nigerian'], 'specific beats general african');
assert.equal(r.kind, 'restaurant');
assert.equal(r.postcode, '77001');
assert.equal(r.website, 'https://example.com');
assert.equal(r.instagram, 'https://instagram.com/y');
assert.equal(r.source_ref, 'overture:x1');

r = toRow(rec({ name: 'Fixture African Market', cats: ['grocery_store'] }));
assert.equal(r.kind, 'market'); assert.deepEqual(r.origins, ['african']);

r = toRow(rec({ name: 'Island Fixture Jerk Center', cats: ['caribbean_restaurant'] }));
assert.deepEqual(r.origins, ['jamaican'], 'Jerk keyword → jamaican, drops general caribbean');

r = toRow(rec({ name: 'Fixture Caribbean Market & Grill', cats: ['grocery_store', 'caribbean_restaurant'] }));
assert.equal(r.kind, 'market', 'both cats + "Market" in name → market');

assert.equal(toRow(rec({ name: 'Pizza ToGo', cats: ['pizza_restaurant'] })), null, 'no origin');
assert.equal(toRow(rec({ name: 'African Hair Braiding', cats: ['hair_salon'] })), null, 'not food');
assert.equal(toRow(rec({ name: 'Fixture Cuban Cafe', cats: ['cuban_restaurant'] })), null, 'disabled region');
assert.equal(toRow(rec({ name: 'Fixture Habesha', cats: ['ethiopian_restaurant'], operating_status: 'permanently_closed' })), null, 'closed');
assert.equal(toRow(rec({ name: 'Fixture Habesha', cats: ['ethiopian_restaurant'], addr: { region: 'Ontario', country: 'CA' } })), null, 'not US');

r = toRow(rec({ name: 'Fixture Habesha', cats: ['ethiopian_restaurant'], addr: { region: 'District of Columbia', country: 'US', locality: 'Washington' } }));
assert.equal(r.state, 'DC');
assert.equal(stateCode('US-GA'), 'GA'); assert.equal(stateCode('new york'), 'NY'); assert.equal(stateCode('ZZ'), null);

// Hispanic Caribbean filtered when that region is disabled
assert.equal(toRow(rec({ name: 'La Esquina Fixture', cats: ['caribbean_restaurant'] })), null, 'Spanish name, generic caribbean');
assert.equal(toRow(rec({ name: 'Fixture Grill', cats: ['caribbean_restaurant', 'cuban_restaurant'] })), null, 'Hispanic alt category');
assert.ok(toRow(rec({ name: 'Fixture Island Grill', cats: ['caribbean_restaurant'] })), 'plain generic caribbean kept');
assert.ok(toRow(rec({ name: 'La Fixture Jamaican Kitchen', cats: ['caribbean_restaurant'] })), 'explicit keyword wins');
// place-name keywords removed; exact market categories
assert.equal(toRow(rec({ name: 'Jamaica Halal Food', cats: ['halal_restaurant'] })), null, 'Jamaica, Queens is not Jamaican');
assert.equal(toRow(rec({ name: 'Caribbean Fixture Freight', cats: ['shipping_center', 'freight_and_cargo_service'] })), null, 'not food');
assert.equal(toRow(rec({ name: 'Fixture African Market', cats: ['marketing_agency'] })), null, 'marketing is not a market');

console.log('✓ all Overture mapping tests passed');
