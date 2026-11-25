import raw from '../../shared/taxonomy.json';
import usStates from '../../shared/us-states.json';

export interface Region { key: string; label: string; enabled: boolean }
export interface Origin { key: string; label: string; flag: string; region: string; keywords: string[] }

export const REGIONS: Region[] = (raw.regions as Region[]).filter((r) => r.enabled);
const enabled = new Set(REGIONS.map((r) => r.key));
export const ORIGINS: Origin[] = (raw.origins as Origin[]).filter((o) => enabled.has(o.region));
export const ORIGIN = new Map(ORIGINS.map((o) => [o.key, o]));

export const originLabel = (k: string) => {
  const o = ORIGIN.get(k);
  return o ? `${o.flag} ${o.label}` : k;
};

export const US_STATES: Record<string, string> = usStates;

const DAYS: Record<string, string> = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun', PH: 'Holidays' };
/** Make an OSM opening_hours string readable: "Mo-Sa 10:00-20:00; Su off" → lines */
export function prettyHours(h: string): string[] {
  return h
    .split(';')
    .map((part) => part.trim().replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d]).replace(/\boff\b/i, 'Closed').replace(/,(?=\S)/g, ', '))
    .filter(Boolean);
}

export const SERVICE_LABEL: Record<string, string> = {
  delivery: 'Delivery', takeaway: 'Takeout', outdoor_seating: 'Outdoor seating', drive_through: 'Drive-through',
  halal: 'Halal', vegetarian_options: 'Vegetarian options', catering: 'Catering',
};
