import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import MapView, { type Bounds } from '../components/MapView';
import PlacePanel from '../components/PlacePanel';
import { Badge, StatusBadge, MenuSign } from '../components/Badge';
import { IconBasket, IconBowl, IconChevron, IconClose, IconLocate, IconSearch } from '../components/Icons';
import { useStore } from '../lib/store';
import { ORIGIN, ORIGINS, REGIONS, US_STATES } from '../lib/taxonomy';
import { cityCenter } from '../lib/insights';
import { formatMiles, miles } from '../lib/geo';
import type { Place } from '../lib/types';
import { configured, supabase } from '../lib/supabase';
import { cityPath, matchesRef, placePath, placeRef, statePath } from '../../shared/slug.js';

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

/** preset: filters given by a state, city or cuisine page (/us/texas/houston/ …), same shape as ?query */
export default function Explore({ preset, heading }: { preset?: string; heading?: string } = {}) {
  const { places, placesLoading, placesError, userLoc, locating, requestLocation } = useStore();
  const { id: placeParam = null } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [urlParams] = useSearchParams();
  // Landing pages (/us/texas/houston/) give their filters as a preset; anything the person changes goes in the address
  const search = useMemo(() => {
    if (preset == null) return location.search;
    const p = new URLSearchParams(preset);
    new URLSearchParams(location.search).forEach((v, k) => p.set(k, v));
    const out = p.toString();
    return out ? `?${out}` : '';
  }, [preset, location.search]);
  const params = preset != null ? new URLSearchParams(search) : urlParams;
  const pref = useMemo(() => placeRef(placeParam), [placeParam]);
  const selectedId = useMemo(() => (pref ? places.find((p) => matchesRef(p.id, pref))?.id ?? null : null), [pref, places]);

  const [q, setQ] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState<Kind>((params.get('kind') as Kind) || 'all');
  const [origin, setOrigin] = useState(params.get('origin') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [confirmedOnly, setConfirmedOnly] = useState(params.get('verified') === '1');
  const [hideClosed, setHideClosed] = useState(params.get('closed') !== '1');
  const [menuOnly, setMenuOnly] = useState(params.get('menu') === '1');
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; seq: number; instant?: boolean } | null>(null);
  const deferredQ = useDeferredValue(q);

  // Links from Discover and search suggestions arrive as query params
  const appliedSearch = useRef<string | null>(null);
  const wroteSearch = useRef<string | null>(null);
  // Coming back to a list page that was rebuilt: where its map and list were when a place was opened
  const restoreList = useRef<{ view: Bounds | null; scroll: number } | null>((() => {
    try { const v = sessionStorage.getItem(`dmm.list.${location.key}`); return v ? JSON.parse(v) : null; } catch { return null; }
  })());

  // Keep the filters in the address, so Back (and a shared link) brings the same results back
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const set = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
    const base = preset != null ? new URLSearchParams(preset) : null;
    const put = (k: string, v: string) => (base && (base.get(k) ?? '') === v ? p.delete(k) : set(k, v));
    put('q', deferredQ.trim());
    put('kind', kind !== 'all' ? kind : '');
    put('origin', origin);
    put('state', state);
    set('verified', confirmedOnly ? '1' : '');
    set('closed', hideClosed ? '' : '1');
    set('menu', menuOnly ? '1' : '');
    const next = p.toString() ? `?${p}` : '';
    if (next === location.search) return;
    const merged = preset != null ? (() => { const m = new URLSearchParams(preset); p.forEach((v, k) => m.set(k, v)); return m.toString() ? `?${m}` : ''; })() : next;
    wroteSearch.current = merged;
    navigate({ pathname: location.pathname, search: next }, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQ, kind, origin, state, confirmedOnly, hideClosed, menuOnly]);
  useEffect(() => {
    if (!places.length || appliedSearch.current === search) return;
    const own = wroteSearch.current === search;
    appliedSearch.current = search;
    if (own) return;   // the address changed because the filters did: nothing to apply
    const p = new URLSearchParams(search);
    setConfirmedOnly(p.get('verified') === '1');
    setHideClosed(p.get('closed') !== '1');
    setMenuOnly(p.get('menu') === '1');
    if (p.has('q')) setQ(p.get('q') ?? '');
    if (p.has('kind')) setKind((p.get('kind') as Kind) || 'all');
    if (p.has('origin')) setOrigin(p.get('origin') ?? '');
    if (p.has('state')) {
      const s = p.get('state') ?? '';
      setState(s);
      const ps = places.filter((x) => x.state === s);
      if (ps.length) setFlyTo({ lat: ps.reduce((a, x) => a + x.lat, 0) / ps.length, lng: ps.reduce((a, x) => a + x.lng, 0) / ps.length, zoom: 6, seq: Date.now(), instant: true });
    }
    if (restoreList.current && !selectedId) {
      const r = restoreList.current;
      restoreList.current = null;
      if (r.view) { pendingScroll.current = { scroll: r.scroll, view: r.view }; setFlyTo({ lng: r.view.lng, lat: r.view.lat, zoom: r.view.zoom, seq: Date.now(), instant: true }); }
      return;
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
  }, [search, places, userLoc, selectedId]);

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
      if (menuOnly && !(p.item_count > 0 || p.menu_link)) return false;
      if (ot === 'region' && !p.regions.includes(ov)) return false;
      if (ot === 'origin' && !p.origins.includes(ov)) return false;
      if (needle) {
        const hay = `${p.name} ${p.city ?? ''} ${p.state} ${US_STATES[p.state] ?? ''} ${originNames(p)}`.toLowerCase();
        if (!hay.includes(needle) && !itemHits.has(p.id)) return false;
      }
      return true;
    });
  }, [places, deferredQ, kind, origin, state, confirmedOnly, hideClosed, menuOnly, itemHits]);

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

  // Back from a place: put the map and the list where they were
  const prevSelected = useRef<string | null>(null);
  const pendingScroll = useRef<{ scroll: number; view: Bounds } | null>(null);
  useEffect(() => {
    const pend = pendingScroll.current;
    if (!pend || !bounds || selectedId) return;
    if (Math.abs(bounds.zoom - pend.view.zoom) > 0.05 || Math.abs(bounds.lng - pend.view.lng) > 1e-4) return;   // not there yet
    pendingScroll.current = null;
    requestAnimationFrame(() => { if (resultsRef.current) resultsRef.current.scrollTop = pend.scroll; });
  }, [bounds, inView, selectedId]);
  useEffect(() => {
    const was = prevSelected.current;
    prevSelected.current = selectedId;
    if (was && !selectedId && before.current) {
      const { view, scroll } = before.current;
      before.current = null;
      // Jump the map back first; the list refills for that view, then its scroll is put back (below)
      if (view) { pendingScroll.current = { scroll, view }; setFlyTo({ lng: view.lng, lat: view.lat, zoom: view.zoom, seq: Date.now(), instant: true }); }
      else requestAnimationFrame(() => { if (resultsRef.current) resultsRef.current.scrollTop = scroll; });
    }
    // A place opened from another page (Discover, Compare, Saved, a search engine): show it on the map
    if (selectedId && !was && !before.current) {
      const p = places.find((x) => x.id === selectedId);
      if (p) setFlyTo({ lng: p.lng, lat: p.lat, zoom: 14, seq: Date.now(), instant: true });
    }
  }, [selectedId, places]);

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

  const resultsRef = useRef<HTMLUListElement>(null);
  const before = useRef<{ view: Bounds | null; scroll: number } | null>(null);
  const select = (id: string, fly = false) => {
    const p = places.find((x) => x.id === id);
    if (!p) return;
    // Opening a place from the list or map: remember where the person was, so Back returns them there.
    // Switching to another place replaces the history entry, so Back still means "back to the results".
    if (!selectedId) {
      before.current = { view: bounds, scroll: resultsRef.current?.scrollTop ?? 0 };
      // Also keep it for this history entry, in case the page is rebuilt on the way back (city pages)
      try { sessionStorage.setItem(`dmm.list.${location.key}`, JSON.stringify(before.current)); } catch { /* private mode */ }
    }
    navigate(`${placePath(p)}${search}`, { replace: Boolean(selectedId), state: { backLabel: heading ? 'the list' : 'results', fromList: true } });
    if (fly && p) setFlyTo({ lng: p.lng, lat: p.lat, zoom: 15, seq: Date.now() });
  };

  // Close / Back: return to wherever the person came from (results, Compare, Saved, Discover…);
  // with no earlier page in this tab (a link from outside), go to the place's city instead
  const navState = location.state as { backLabel?: string; fromList?: boolean } | null;
  const hasHistory = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;   // an earlier page of this app in this tab
  const fallback = selected ? (selected.city ? cityPath(US_STATES[selected.state] ?? selected.state, selected.city) : statePath(US_STATES[selected.state] ?? selected.state)) : '/map';
  const backLabel = hasHistory ? (navState?.backLabel ?? null) : selected?.city ? `more in ${selected.city}` : 'the map';
  const closePlace = () => (hasHistory ? navigate(-1) : navigate(fallback, { replace: true }));

  const pickState = (s: string) => {
    setState(s);
    const ps = places.filter((p) => p.state === s);
    if (ps.length) setFlyTo({ lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lng: ps.reduce((a, p) => a + p.lng, 0) / ps.length, zoom: 6, seq: Date.now() });
  };

  const nearMe = async () => {
    const loc = await requestLocation();
    if (loc) setFlyTo({ ...loc, zoom: 12, seq: Date.now() });
  };

  const activeFilters = [kind !== 'all', !!origin, !!state, confirmedOnly, menuOnly, !!q].filter(Boolean).length;
  const clearFilters = () => { setKind('all'); setOrigin(''); setState(''); setConfirmedOnly(false); setMenuOnly(false); setQ(''); if (preset == null) navigate('/map', { replace: true }); };

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
          {heading && <h1 className="landing-h1">{heading}</h1>}
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
              <label className="switch"><input type="checkbox" checked={menuOnly} onChange={(e) => setMenuOnly(e.target.checked)} /><span aria-hidden />Has a menu or product list</label>
              <label className="switch"><input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} /><span aria-hidden />Hide places that may be closed</label>
            </div>
            <p className="menu-key">
              <span className="menu-sign fresh" aria-hidden>Menu</span> prices updated in the last 2 months
              <span className="menu-sign old" aria-hidden>Menu</span> older
              <span className="menu-sign link" aria-hidden>Menu link</span> on their own website
            </p>
            {activeFilters > 0 && <button className="clear-filters" onClick={clearFilters}><IconClose width={14} height={14} />Clear {activeFilters === 1 ? 'filter' : `${activeFilters} filters`}</button>}
          </div>
        </div>

        <ul className="results" ref={resultsRef}>
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
                  <span className="r-name"><strong>{p.name}</strong><MenuSign place={p} /></span>
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
        {selected && <PlacePanel place={selected} onClose={closePlace} backLabel={backLabel} />}
      </div>
    </div>
  );
}
