import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MapView, { type Bounds } from '../components/MapView';
import PlacePanel from '../components/PlacePanel';
import { Badge, StatusBadge } from '../components/Badge';
import { useStore } from '../lib/store';
import { ORIGIN, ORIGINS, originLabel, REGIONS, US_STATES } from '../lib/taxonomy';
import type { Place } from '../lib/types';

type Kind = 'all' | 'market' | 'restaurant';
const LIST_LIMIT = 150;

const rank = (p: Place) => (p.featured ? 0 : 3) + (p.verification === 'verified' ? 0 : p.verification === 'community' ? 1 : 2) + (p.status === 'active' ? 0 : 10);

export default function Explore() {
  const { places, placesLoading, placesError } = useStore();
  const { id: selectedId = null } = useParams();
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [origin, setOrigin] = useState('');           // "region:west_africa" | "origin:nigerian" | ""
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
        const hay = `${p.name} ${p.city ?? ''} ${p.state} ${US_STATES[p.state] ?? ''} ${p.origins.map((o) => ORIGIN.get(o)?.label ?? o).join(' ')}`.toLowerCase();
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

  return (
    <div className={`explore ${selected ? 'has-selection' : ''}`}>
      <aside className={`sidebar ${sheet ? 'open' : ''}`}>
        <div className="filters">
          <input className="search" type="search" placeholder="Search name, city or cuisine" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <div className="seg" role="tablist">
            {(['all', 'market', 'restaurant'] as Kind[]).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {k === 'all' ? 'All' : k === 'market' ? '🛒 Markets' : '🍲 Restaurants'}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origin">
              <option value="">All origins</option>
              {REGIONS.map((r) => (
                <optgroup key={r.key} label={r.label}>
                  <option value={`region:${r.key}`}>All {r.label}</option>
                  {ORIGINS.filter((o) => o.region === r.key).map((o) => <option key={o.key} value={`origin:${o.key}`}>{o.flag} {o.label}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={state} onChange={(e) => pickState(e.target.value)} aria-label="State">
              <option value="">All states</option>
              {Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="toggles">
            <label><input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} /> Verified or confirmed only</label>
            <label><input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} /> Hide possibly closed</label>
          </div>
        </div>

        <button className="sheet-handle" onClick={() => setSheet((s) => !s)}>
          <span className="grip" />
          {placesLoading && !places.length ? 'Loading places…' : `${inView.length.toLocaleString()} places in view`}
          <span className="muted"> · {filtered.length.toLocaleString()} match nationwide</span>
        </button>

        <ul className="results">
          {placesError && <li className="muted">Couldn't load places: {placesError}</li>}
          {!placesLoading && !places.length && !placesError && (
            <li className="empty">No places yet. The first OpenStreetMap import fills the map; until it runs, add places from the "Add" tab.</li>
          )}
          {inView.slice(0, LIST_LIMIT).map((p) => (
            <li key={p.id}>
              <button className={`result ${p.id === selectedId ? 'on' : ''}`} onClick={() => select(p.id, true)}>
                <span className={`dot ${p.kind}`} aria-hidden />
                <span className="r-main">
                  <strong>{p.name}</strong>
                  <span className="muted small">{p.city ? `${p.city}, ` : ''}{p.state} · {p.origins.slice(0, 2).map(originLabel).join(', ')}</span>
                </span>
                <span className="r-badges"><Badge place={p} /><StatusBadge place={p} /></span>
              </button>
            </li>
          ))}
          {inView.length > LIST_LIMIT && <li className="muted small center">Showing {LIST_LIMIT} of {inView.length}. Zoom in or filter to narrow.</li>}
        </ul>
        <p className="attribution tiny muted">Listings include data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, ODbL.</p>
      </aside>

      <div className="map-wrap">
        <MapView places={filtered} selectedId={selectedId} onSelect={(id) => select(id)} onBounds={setBounds} flyTo={flyTo} />
        <div className="legend">
          <span><i className="dot market" /> Market</span>
          <span><i className="dot restaurant" /> Restaurant</span>
          <span><i className="dot ring" /> Verified</span>
        </div>
        {selected && <PlacePanel place={selected} onClose={() => navigate('/')} />}
      </div>
    </div>
  );
}
