import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MapView, { type Bounds } from '../components/MapView';
import PlacePanel from '../components/PlacePanel';
import { Badge, StatusBadge } from '../components/Badge';
import { IconBasket, IconBowl, IconChevron, IconSearch } from '../components/Icons';
import { useStore } from '../lib/store';
import { ORIGIN, ORIGINS, REGIONS, US_STATES } from '../lib/taxonomy';
import type { Place } from '../lib/types';

type Kind = 'all' | 'market' | 'restaurant';
const LIST_LIMIT = 150;

const rank = (p: Place) => (p.featured ? 0 : 3) + (p.verification === 'verified' ? 0 : p.verification === 'community' ? 1 : 2) + (p.status === 'active' ? 0 : 10);
const flags = (p: Place) => p.origins.map((o) => ORIGIN.get(o)?.flag ?? '').join(' ');
const originNames = (p: Place) => p.origins.map((o) => ORIGIN.get(o)?.label.replace(' (general)', '') ?? o).join(', ');

export default function Explore() {
  const { places, placesLoading, placesError } = useStore();
  const { id: selectedId = null } = useParams();
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [origin, setOrigin] = useState('');
  const [state, setState] = useState('');
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [hideClosed, setHideClosed] = useState(true);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [sheet, setSheet] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; seq: number } | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const [ot, ov] = origin.split(':');
    return places.filter((p) => {
      if (kind !== 'all' && p.kind !== kind) return false;
      if (state && p.state !== state) return false;
      if (hideClosed && p.status !== 'active') return false;
      if (confirmedOnly && p.verification === 'listed') return false;
      if (ot === 'region' && !p.regions.includes(ov)) return false;
      if (ot === 'origin' && !p.origins.includes(ov)) return false;
      if (needle) {
        const hay = `${p.name} ${p.city ?? ''} ${p.state} ${US_STATES[p.state] ?? ''} ${originNames(p)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [places, q, kind, origin, state, confirmedOnly, hideClosed]);

  const inView = useMemo(() => {
    const vis = bounds
      ? filtered.filter((p) => p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east)
      : filtered;
    return [...vis].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [filtered, bounds]);

  const selected = selectedId ? places.find((p) => p.id === selectedId) ?? null : null;

  const select = (id: string, fly = false) => {
    navigate(`/place/${id}`);
    setSheet(false);
    const p = places.find((x) => x.id === id);
    if (fly && p) setFlyTo({ lng: p.lng, lat: p.lat, zoom: 15, seq: Date.now() });
  };

  const pickState = (s: string) => {
    setState(s);
    const ps = places.filter((p) => p.state === s);
    if (ps.length) {
      const lat = ps.reduce((a, p) => a + p.lat, 0) / ps.length;
      const lng = ps.reduce((a, p) => a + p.lng, 0) / ps.length;
      setFlyTo({ lat, lng, zoom: 6, seq: Date.now() });
    }
  };

  const countLabel = placesLoading && !places.length
    ? 'Loading places…'
    : `${inView.length.toLocaleString()} ${inView.length === 1 ? 'place' : 'places'} on the map`;

  return (
    <div className={`explore ${selected ? 'has-selection' : ''}`}>
      <aside className={`sidebar ${sheet ? 'open' : ''}`} aria-label="Search and results">
        <button className="sheet-handle" onClick={() => setSheet((s) => !s)} aria-expanded={sheet}>
          <span className="grip" aria-hidden />
          <span className="count">{countLabel}</span>
          {filtered.length !== inView.length && <span className="count-sub">{filtered.length.toLocaleString()} across the US</span>}
        </button>

        <div className="filters">
          <label className="search">
            <IconSearch />
            <input type="search" placeholder="Search by name, city or cuisine" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </label>
          <div className="seg" role="radiogroup" aria-label="Type of place">
            <button role="radio" aria-checked={kind === 'all'} className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>All</button>
            <button role="radio" aria-checked={kind === 'market'} className={kind === 'market' ? 'on' : ''} onClick={() => setKind('market')}><IconBasket width={17} height={17} />Markets</button>
            <button role="radio" aria-checked={kind === 'restaurant'} className={kind === 'restaurant' ? 'on' : ''} onClick={() => setKind('restaurant')}><IconBowl width={17} height={17} />Restaurants</button>
          </div>
          <div className="filter-row">
            <label className="select">
              <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Cuisine or country">
                <option value="">Every cuisine</option>
                {REGIONS.map((r) => (
                  <optgroup key={r.key} label={r.label}>
                    <option value={`region:${r.key}`}>All of {r.label}</option>
                    {ORIGINS.filter((o) => o.region === r.key).map((o) => <option key={o.key} value={`origin:${o.key}`}>{o.flag} {o.label}</option>)}
                  </optgroup>
                ))}
              </select>
              <IconChevron width={16} height={16} />
            </label>
            <label className="select">
              <select value={state} onChange={(e) => pickState(e.target.value)} aria-label="State">
                <option value="">Every state</option>
                {Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <IconChevron width={16} height={16} />
            </label>
          </div>
          <div className="switches">
            <label className="switch"><input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} /><span aria-hidden />Verified or confirmed only</label>
            <label className="switch"><input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} /><span aria-hidden />Hide places that may be closed</label>
          </div>
        </div>

        <ul className="results">
          {placesError && <li className="empty">The listings didn't load. Check your connection and reload the page.</li>}
          {!placesLoading && !placesError && places.length > 0 && inView.length === 0 && (
            <li className="empty">Nothing matches here. Zoom out, or clear a filter.</li>
          )}
          {!placesLoading && !places.length && !placesError && (
            <li className="empty">Listings are on their way. Know a spot? Add it from the Add tab.</li>
          )}
          {inView.slice(0, LIST_LIMIT).map((p) => (
            <li key={p.id}>
              <button className={`result ${p.id === selectedId ? 'on' : ''}`} onClick={() => select(p.id, true)}>
                <span className={`kind-mark ${p.kind}`} aria-label={p.kind === 'market' ? 'Market' : 'Restaurant'}>
                  {p.kind === 'market' ? <IconBasket width={16} height={16} /> : <IconBowl width={16} height={16} />}
                </span>
                <span className="r-main">
                  <strong>{p.name}</strong>
                  <span className="r-sub">{p.city ? `${p.city}, ${p.state}` : US_STATES[p.state]}</span>
                  <span className="r-badges"><Badge place={p} quiet /><StatusBadge place={p} /></span>
                </span>
                <span className="r-flags" title={originNames(p)}>{flags(p)}</span>
              </button>
            </li>
          ))}
          {inView.length > LIST_LIMIT && <li className="more">Showing the first {LIST_LIMIT}. Zoom in or filter to see the rest.</li>}
        </ul>
        <p className="attribution">
          Listings from <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">Overture Maps Foundation</a> and the community. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>.
        </p>
      </aside>

      <div className="map-wrap">
        <MapView places={filtered} selectedId={selectedId} onSelect={(id) => select(id)} onBounds={setBounds} flyTo={flyTo} />
        <div className="legend" aria-label="Map key">
          <span><i className="dot market" />Market</span>
          <span><i className="dot restaurant" />Restaurant</span>
          <span><i className="dot ring" />Verified</span>
        </div>
        {selected && <PlacePanel place={selected} onClose={() => navigate('/')} />}
      </div>
    </div>
  );
}
