// Node wrapper: loads the shared taxonomy and exposes the pure OSM helpers.
import { readFileSync } from 'node:fs';
import { createOsm } from './osm-core.mjs';

const taxonomy = JSON.parse(readFileSync(new URL('../shared/taxonomy.json', import.meta.url), 'utf8'));
export const { ORIGINS, STATES, overpassQuery, toRow } = createOsm(taxonomy);
