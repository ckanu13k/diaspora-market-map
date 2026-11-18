import type { Place } from '../lib/types';

export function Badge({ place }: { place: Place }) {
  if (place.verification === 'verified') return <span className="badge verified" title="Checked by the Diaspora Market Map team">✔ Verified</span>;
  if (place.verification === 'community') return <span className="badge community" title="3+ people confirmed it's open in the last 90 days">✔ Community confirmed</span>;
  return <span className="badge listed" title="Listed from OpenStreetMap; not yet confirmed">Listed</span>;
}

export function StatusBadge({ place }: { place: Place }) {
  if (place.status === 'possibly_closed') return <span className="badge warn" title="Reported closed or no longer on OpenStreetMap">⚠ May be closed</span>;
  if (place.status === 'closed') return <span className="badge closed">Closed</span>;
  return null;
}
