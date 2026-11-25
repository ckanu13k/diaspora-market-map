// Derived browse data for the Discover screen: cuisine counts and the busiest cities.
import { ORIGIN } from './taxonomy';
import type { Place } from './types';

export interface CityStat { key: string; city: string; state: string; count: number; lat: number; lng: number }
export interface CuisineStat { key: string; label: string; flag: string; count: number }

const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);

export function cityKey(p: Pick<Place, 'city' | 'state'>) {
  return p.city ? `${title(p.city.trim())}|${p.state}` : null;
}

export function topCities(places: Place[], n = 12): CityStat[] {
  const acc = new Map<string, { count: number; lat: number; lng: number }>();
  for (const p of places) {
    const k = cityKey(p);
    if (!k) continue;
    const a = acc.get(k) ?? { count: 0, lat: 0, lng: 0 };
    a.count++; a.lat += p.lat; a.lng += p.lng;
    acc.set(k, a);
  }
  return [...acc.entries()]
    .sort((x, y) => y[1].count - x[1].count)
    .slice(0, n)
    .map(([k, a]) => { const [city, state] = k.split('|'); return { key: k, city, state, count: a.count, lat: a.lat / a.count, lng: a.lng / a.count }; });
}

export function cuisineCounts(places: Place[]): CuisineStat[] {
  const acc = new Map<string, number>();
  for (const p of places) for (const o of p.origins) acc.set(o, (acc.get(o) ?? 0) + 1);
  return [...acc.entries()]
    .filter(([k]) => ORIGIN.has(k))
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => { const o = ORIGIN.get(k)!; return { key: k, label: o.label.replace(' (general)', ''), flag: o.flag, count }; });
}

export function cityCenter(places: Place[], key: string): CityStat | null {
  return topCities(places.filter((p) => cityKey(p) === key), 1)[0] ?? null;
}
