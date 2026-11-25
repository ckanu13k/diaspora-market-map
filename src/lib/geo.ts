import type { LatLng } from './store';

const R_MI = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function miles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(h));
}

export function formatMiles(mi: number): string {
  if (mi < 0.1) return 'Under 0.1 mi';
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString()} mi`;
}
