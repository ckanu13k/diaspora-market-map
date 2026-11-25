import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import MapView, { type Bounds } from '../components/MapView';
import PlacePanel from '../components/PlacePanel';
import { Badge, StatusBadge } from '../components/Badge';
import { IconBasket, IconBowl, IconChevron, IconClose, IconLocate, IconSearch } from '../components/Icons';
import { useStore } from '../lib/store';
import { ORIGIN, ORIGINS, REGIONS, US_STATES } from '../lib/taxonomy';
import { cityCenter } from '../lib/insights';
import { formatMiles, miles } from '../lib/geo';
import type { Place } from '../lib/types';
import { configured, supabase } from '../lib/supabase';

type Kind = 'all' | 'market' | 'restaurant';
type Snap = 'peek' | 'half' | 'full';
const LIST_LIMIT = 120;
const flags = (p: Place) => p.origins.map((o) => ORIGIN.get(o)?.flag ?? '').join(' ');
const originNames = (p: Place) => p.origins.map((o) => ORIGIN.get(o)?.label.replace(' (general)', '') ?? o).join(', ');
const isPhone = () => window.matchMedia('(max-width: 820px)').matches;

/** Bottom-sheet heights on phones, in px, for a given viewport. */
function snapHeights(container: number) {
  return { peek: 176, half: Math.round(container * 0.52), full: Math.round(container * 0.9) };
}

export default function Explore() {
  const { places, placesLoading, placesError, userLoc, locating, requestLocation } = useStore();
  const { id: selectedId = null } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [q, setQ] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState<Kind>((params.get('kind') as Kind) || 'all');
  const [origin, setOrigin] = useState(params.get('origin') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [hideClosed, setHideClosed] = useState(true);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; seq: number; instant?: boolean } | null>(null);
  const deferredQ = useDeferredValue(q);

  // Links from Discover and search suggestions arrive as query params
  const appliedSearch = useRef<string | null>(null);
  useEffect(() => {
    if (!places.length || appliedSearch.current === location.search) return;
    appliedSearch.current = location.search;
    const p = new URLSearchParams(location.search);
    if (p.has('q')) setQ(p.get('q') ?? '');
    if (p.has('kind')) setKind((p.get('kind') as Kind) || 'all');
    if (p.has('origin')) setOrigin(p.get('origin') ?? '');
    if (p.has('state')) {
      const s = p.get('state') ?? '';
      setState(s);
      const ps = places.filter((x) => x.state === s);
      if (ps.length) setFlyTo({ lat: ps.reduce((a, x) => a + x.lat, 0) / ps.length, lng: ps.reduce((a, x) => a + x.lng, 0) / ps.length, zoom: 6, seq: Date.now(), instant: true });
    }
    const city = p.get('city');
    if (city) {
      const c = cityCenter(places, city);
      if (c) setFlyTo({ lat: c.lat, lng: c.lng, zoom: 10.5, seq: Date.now(), instant: true });
    }
    const near = p.get('near');
    if (near) {
      const [lat, lng] = near.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) setFlyTo({ lat, lng, zoom: 11, seq: Date.now(), instant: true });
    } else if (!city && !p.has('state') && userLoc && !selectedId) {
      setFlyTo({ ...userLoc, zoom: 10, seq: Date.now(), instant: true });
    }
  }, [location.search, places, userLoc, selectedId]);

  // Product / dish search: places whose list has a matching item (names only; prices stay behind details)
  const [itemHits, setItemHits] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    const term = deferredQ.trim();
    if (!configured || term.length < 3) { setItemHits(new Map()); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_items', { q: term, p_state: null, lim: 200 });
      if (live && Array.isArray(data)) setItemHits(new Map(data.map((r: { place_id: string; items: string[] }) => [r.place_id, r.items])));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [deferredQ]);

  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase();
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
        if (!hay.includes(needle) && !itemHits.has(p.id)) return false;
      }
      return true;
    });
  }, [places, deferredQ, kind, origin, state, confirmedOnly, hideClosed, itemHits]);

  // Sorted by distance: from you when we know where you are, otherwise from the middle of the map
  const ref = userLoc ?? (bounds ? { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 } : null);
  const inView = useMemo(() => {
    const vis = bounds
      ? filtered.filter((p) => p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east)
      : filtered;
    if (!ref) return vis.map((p) => ({ p, d: null as number | null }));
    return vis.map((p) => ({ p, d: miles(ref, p) })).sort((a, b) => a.d - b.d);
  }, [filtered, bounds, ref?.lat, ref?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selectedId ? places.find((p) => p.id === selectedId) ?? null : null;

  // ── phone bottom sheet: three snap points, drag or tap the handle ──
  const sheetRef = useRef<HTMLElement>(null);
  const [snap, setSnap] = useState<Snap>('peek');
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const applySnap = useCallback((s: Snap) => {
    setSnap(s);
    const el = sheetRef.current;
    if (el && isPhone()) el.style.height = `${snapHeights(el.parentElement!.clientHeight)[s]}px`;
  }, []);
  useEffect(() => {
    const onResize = () => applySnap(snap);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [snap, applySnap]);
  const onHandleDown = (e: React.PointerEvent) => {
    if (!isPhone() || !sheetRef.current) return;
    drag.current = { y: e.clientY, h: sheetRef.current.offsetHeight, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    sheetRef.current.classList.add('dragging');
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    const max = snapHeights(el.parentElement!.clientHeight).full;
    el.style.height = `${Math.max(120, Math.min(max, d.h + dy))}px`;
  };
  const onHandleUp = () => {
    const d = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!el || !d) return;
    el.classList.remove('dragging');
    if (!d.moved) return applySnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');
    const h = el.offsetHeight;
    const hs = snapHeights(el.parentElement!.clientHeight);
    const nearest = (Object.keys(hs) as Snap[]).reduce((a, b) => (Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a));
    applySnap(nearest);
  };

  const select = (id: string, fly = false) => {
    navigate(`/place/${id}${location.search}`);
    const p = places.find((x) => x.id === id);
    if (fly && p) setFlyTo({ lng: p.lng, lat: p.lat, zoom: 15, seq: Date.now() });
  };

  const pickState = (s: string) => {
    setState(s);
    const ps = places.filter((p) => p.state === s);
    if (ps.length) setFlyTo({ lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lng: ps.reduce((a, p) => a + p.lng, 0) / ps.length, zoom: 6, seq: Date.now() });
  };

  const nearMe = async () => {
    const loc = await requestLocation();
    if (loc) setFlyTo({ ...loc, zoom: 12, seq: Date.now() });
  };

  const activeFilters = [kind !== 'all', !!origin, !!state, confirmedOnly, !!q].filter(Boolean).length;
  const clearFilters = () => { setKind('all'); setOrigin(''); setState(''); setConfirmedOnly(false); setQ(''); navigate('/map', { replace: true }); };

  const countLabel = placesLoading && !places.length
    ? 'Loading places…'
    : `${inView.length.toLocaleString()} ${inView.length === 1 ? 'place' : 'places'} in this area`;

  return (
    <div className={`explore ${selected ? 'has-selection' : ''}`}>
      <aside ref={sheetRef} className={`sidebar snap-${snap}`} aria-label="Search and results">
        <div className="sheet-handle" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
          role="button" tabIndex={0} aria-label={snap === 'full' ? 'Collapse list' : 'Expand list'}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applySnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek'); } }}>
          <span className="grip" aria-hidden />
          <span className="count" aria-live="polite">{countLabel}</span>
          {filtered.length !== inView.length && <span className="count-sub">{filtered.length.toLocaleString()} across the US</span>}
        </div>

        <div className="filters">
          <div className="search-row">
            <label className="search">
              <IconSearch />
              <input type="search" placeholder="Search places, cuisines, dishes or products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter places"
                onFocus={() => { if (isPhone() && snap === 'peek') applySnap('half'); }} />
            </label>
            <button className="icon-btn near" onClick={nearMe} disabled={locating} aria-label="Show places near me" title="Near me"><IconLocate width={18} height={18} /></button>
          </div>
          <div className="seg" role="radiogroup" aria-label="Type of place">
            <button role="radio" aria-checked={kind === 'all'} className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>All</button>
            <button role="radio" aria-checked={kind === 'market'} className={kind === 'market' ? 'on' : ''} onClick={() => setKind('market')}><IconBasket width={17} height={17} />Markets</button>
            <button role="radio" aria-checked={kind === 'restaurant'} className={kind === 'restaurant' ? 'on' : ''} onClick={() => setKind('restaurant')}><IconBowl width={17} height={17} />Restaurants</button>
          </div>
          <div className="more-filters">
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
            {activeFilters > 0 && <button className="clear-filters" onClick={clearFilters}><IconClose width={14} height={14} />Clear {activeFilters === 1 ? 'filter' : `${activeFilters} filters`}</button>}
          </div>
        </div>

        <ul className="results">
          {placesError && <li className="empty">The listings didn't load. Check your connection and reload the page.</li>}
          {placesLoading && !places.length && Array.from({ length: 6 }, (_, i) => <li key={i} className="sk-li" aria-hidden><span className="sk-row" /></li>)}
          {!placesLoading && !placesError && places.length > 0 && inView.length === 0 && (
            <li className="empty">Nothing matches in this area. Zoom out, or <button className="linkish" onClick={clearFilters}>clear your filters</button>.</li>
          )}
          {inView.slice(0, LIST_LIMIT).map(({ p, d }) => (
            <li key={p.id}>
              <button className={`result ${p.id === selectedId ? 'on' : ''}`} onClick={() => select(p.id, true)}>
                <span className={`kind-mark ${p.kind}`} aria-label={p.kind === 'market' ? 'Market' : 'Restaurant'}>
                  {p.kind === 'market' ? <IconBasket width={16} height={16} /> : <IconBowl width={16} height={16} />}
                </span>
                <span className="r-main">
                  <strong>{p.name}</strong>
                  <span className="r-sub">{userLoc && d != null ? `${formatMiles(d)}, ` : ''}{p.city ? `${p.city}, ${p.state}` : US_STATES[p.state]}</span>
                  {itemHits.has(p.id) && <span className="r-items">{p.kind === 'market' ? 'Sells' : 'Serves'} {itemHits.get(p.id)!.slice(0, 3).join(', ')}</span>}
                  <span className="r-badges"><Badge place={p} quiet /><StatusBadge place={p} /></span>
                </span>
                <span className="r-flags" title={originNames(p)}>{flags(p)}</span>
              </button>
            </li>
          ))}
          {inView.length > LIST_LIMIT && <li className="more">Showing the closest {LIST_LIMIT}. Zoom in or filter to see the rest.</li>}
        </ul>
        <p className="attribution">
          Listings from <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">Overture Maps Foundation</a> and the community. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>.
        </p>
      </aside>

      <div className="map-wrap">
        <MapView places={filtered} selectedId={selectedId} onSelect={(id) => select(id)} onBounds={setBounds} flyTo={flyTo} userLoc={userLoc} />
        <div className="legend" aria-label="Map key">
          <span><i className="dot market" />Market</span>
          <span><i className="dot restaurant" />Restaurant</span>
          <span><i className="dot ring" />Verified</span>
        </div>
        {selected && <PlacePanel place={selected} onClose={() => navigate(`/map${location.search}`)} />}
      </div>
    </div>
  );
}
