import type { Place } from '../lib/types';
import { IconCheck, IconList } from './Icons';

/** Trust level. `quiet` hides the default "not yet confirmed" state in dense lists. */
export function Badge({ place, quiet = false }: { place: Place; quiet?: boolean }) {
  if (place.verification === 'verified')
    return <span className="badge verified" title="Checked by the Diaspora Market Map team"><IconCheck width={13} height={13} strokeWidth={2.5} />Verified</span>;
  if (place.verification === 'community')
    return <span className="badge community" title="3 or more people confirmed it's open in the last 90 days"><IconCheck width={13} height={13} strokeWidth={2.5} />Confirmed by locals</span>;
  if (quiet) return null;
  return <span className="badge listed" title="From public business data; not yet confirmed">Not yet confirmed</span>;
}

/** Two or more "details are wrong" votes outnumbering the "correct" ones. */
export const detailsDisputed = (p: Place) => p.inaccurate_votes >= 2 && p.inaccurate_votes > p.accurate_votes;

export function StatusBadge({ place }: { place: Place }) {
  if (place.status === 'active' && detailsDisputed(place))
    return <span className="badge warn" title="People have reported that some details may be wrong">Details may be out of date</span>;
  if (place.status === 'possibly_closed') return <span className="badge warn" title="Reported closed, or missing from the latest business data">May be closed</span>;
  if (place.status === 'closed') return <span className="badge closed">Closed</span>;
  return null;
}

const FRESH_DAYS = 60;
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : Infinity);
const when = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`);

/**
 * Sign beside a place's name: does it have a menu / product list in the app, and is it current?
 *   filled  "Menu 24"   items listed and checked in the last 60 days
 *   gray    "Menu 24"   items listed, but none checked for 60+ days
 *   outline "Menu link" no list here yet, but their own menu or shop page is linked
 */
export function MenuSign({ place }: { place: Place }) {
  const noun = place.kind === 'market' ? 'Products' : 'Menu';
  if (place.item_count > 0) {
    const d = daysSince(place.items_updated_at);
    const fresh = d <= FRESH_DAYS;
    const what = `${place.item_count} ${place.kind === 'market' ? (place.item_count === 1 ? 'product' : 'products') : (place.item_count === 1 ? 'menu item' : 'menu items')} with prices`;
    const label = `${what}, ${fresh ? 'updated' : 'last updated'} ${when(d)}`;
    return (
      <span className={`menu-sign ${fresh ? 'fresh' : 'old'}`} title={label} aria-label={label}>
        <IconList width={12} height={12} strokeWidth={2.4} />{noun}<span className="ms-n">{place.item_count}</span>
      </span>
    );
  }
  if (place.menu_link) {
    const label = place.kind === 'market' ? 'Their own online shop is linked' : 'Their own menu page is linked';
    return <span className="menu-sign link" title={label} aria-label={label}>{noun === 'Menu' ? 'Menu link' : 'Shop link'}</span>;
  }
  return null;
}
