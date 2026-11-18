// Unit tests for OSM → row mapping. Elements below are synthetic fixtures, not real businesses.
import assert from 'node:assert/strict';
import { overpassQuery, toRow } from '../scripts/osm-lib.mjs';

const node = (id, tags, extra = {}) => ({ type: 'node', id, lat: 29.7, lon: -95.4, tags, ...extra });

// cuisine tag → restaurant, multi-value cuisine
let r = toRow(node(1, { name: 'Fixture Kitchen', amenity: 'restaurant', cuisine: 'nigerian;ghanaian', phone: '+1 555', website: 'example.com' }), 'TX');
assert.deepEqual(r.origins.sort(), ['ghanaian', 'nigerian']);
assert.deepEqual(r.regions, ['west_africa']);
assert.equal(r.kind, 'restaurant');
assert.equal(r.website, 'https://example.com/');

// name keyword → market; generic "African" dropped when specific origin present
r = toRow(node(2, { name: 'Fixture African & Caribbean Market', shop: 'supermarket' }), 'GA');
assert.deepEqual(r.origins.sort(), ['african', 'caribbean']);
assert.equal(r.kind, 'market');
r = toRow(node(3, { name: 'Fixture Nigerian African Foods', shop: 'grocery' }), 'GA');
assert.deepEqual(r.origins, ['nigerian']);

// word boundary rejects false positives from the coarse Overpass regex
assert.equal(toRow(node(4, { name: 'Pizza ToGo', amenity: 'fast_food' }), 'TX'), null);
assert.equal(toRow(node(5, { name: 'Africana Hair Braiding', shop: 'hairdresser' }), 'TX'), null);
assert.equal(toRow(node(11, { name: 'African Hair Braiding', shop: 'hairdresser' }), 'TX'), null, 'non-food shop');

// ways use center; disused excluded; no-name excluded
r = toRow({ type: 'way', id: 6, center: { lat: 40.1, lon: -74.2 }, tags: { name: 'Fixture Jerk Hut', amenity: 'fast_food', 'addr:state': 'nj', 'addr:city': 'Newark' } }, 'NY');
assert.equal(r.osm_id, 'way/6'); assert.equal(r.state, 'NJ'); assert.deepEqual(r.origins, ['jamaican']);
assert.equal(toRow(node(7, { name: 'Old Haitian Spot', 'disused:amenity': 'restaurant', amenity: 'restaurant' }), 'FL'), null);
assert.equal(toRow(node(8, { amenity: 'restaurant', cuisine: 'ethiopian' }), 'FL'), null);

// disabled region (Hispanic Caribbean is off by default) is ignored
assert.equal(toRow(node(9, { name: 'Fixture Cafe', amenity: 'restaurant', cuisine: 'cuban' }), 'FL'), null);

// services + socials
r = toRow(node(10, { name: 'Fixture Habesha', amenity: 'restaurant', takeaway: 'yes', 'diet:halal': 'yes', 'contact:instagram': '@fixture' }), 'MD');
assert.deepEqual(r.services, ['takeaway', 'halal']);
assert.equal(r.instagram, 'https://instagram.com/fixture');

const q = overpassQuery('TX');
assert.match(q, /US-TX/); assert.match(q, /nigerian\|ghanaian/); assert.doesNotMatch(q, /cuban/);
console.log('✓ all ingestion tests passed');
