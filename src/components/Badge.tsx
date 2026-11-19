import type { Place } from '../lib/types';
import { IconCheck } from './Icons';

/** Trust level. `quiet` hides the default "not yet confirmed" state in dense lists. */
export function Badge({ place, quiet = false }: { place: Place; quiet?: boolean }) {
  if (place.verification === 'verified')
    return <span className="badge verified" title="Checked by the Diaspora Market Map team"><IconCheck width={13} height={13} strokeWidth={2.5} />Verified</span>;
  if (place.verification === 'community')
    return <span className="badge community" title="3 or more people confirmed it's open in the last 90 days"><IconCheck width={13} height={13} strokeWidth={2.5} />Confirmed by locals</span>;
  if (quiet) return null;
  return <span className="badge listed" title="From public business data; not yet confirmed">Not yet confirmed</span>;
}

export function StatusBadge({ place }: { place: Place }) {
  if (place.status === 'possibly_closed') return <span className="badge warn" title="Reported closed, or missing from the latest business data">May be closed</span>;
  if (place.status === 'closed') return <span className="badge closed">Closed</span>;
  return null;
}
