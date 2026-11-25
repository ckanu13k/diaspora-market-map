// Home screen: search, places near you, cuisines and cities to browse. Loads without the map library.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { placePath } from '../../shared/slug.js';
import SearchBox from '../components/SearchBox';
import { Badge, StatusBadge } from '../components/Badge';
import { IconArrowRight, IconBasket, IconBowl, IconDownload, IconLocate, IconClose } from '../components/Icons';
import { useStore } from '../lib/store';
import { cuisineCounts, topCities } from '../lib/insights';
import { formatMiles, miles } from '../lib/geo';
import { ORIGIN, US_STATES } from '../lib/taxonomy';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import type { Place } from '../lib/types';

function PlaceRow({ p, distance }: { p: Place; distance?: number }) {
  return (
    <li>
      <Link className="result" to={placePath(p)}>
        <span className={`kind-mark ${p.kind}`} aria-label={p.kind === 'market' ? 'Market' : 'Restaurant'}>
          {p.kind === 'market' ? <IconBasket width={16} height={16} /> : <IconBowl width={16} height={16} />}
        </span>
        <span className="r-main">
          <strong>{p.name}</strong>
          <span className="r-sub">{distance != null ? `${formatMiles(distance)} away, ` : ''}{p.city ? `${p.city}, ${p.state}` : US_STATES[p.state]}</span>
          <span className="r-badges"><Badge place={p} quiet /><StatusBadge place={p} /></span>
        </span>
        <span className="r-flags">{p.origins.map((o) => ORIGIN.get(o)?.flag).join(' ')}</span>
      </Link>
    </li>
  );
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return <ul className="results skeleton" aria-hidden>{Array.from({ length: rows }, (_, i) => <li key={i}><span className="sk-row" /></li>)}</ul>;
}

export default function Discover() {
  const { places, placesLoading, userLoc, locating, requestLocation, account } = useStore();
  const navigate = useNavigate();
  const install = useInstallPrompt();

  const active = useMemo(() => places.filter((p) => p.status === 'active'), [places]);
  const cuisines = useMemo(() => cuisineCounts(active).slice(0, 16), [active]);
  const cities = useMemo(() => topCities(active, 12), [active]);
  const nearby = useMemo(() => {
    if (!userLoc) return [];
    return active.map((p) => ({ p, d: miles(userLoc, p) })).sort((a, b) => a.d - b.d).slice(0, 8);
  }, [active, userLoc]);
  const trusted = useMemo(() => active.filter((p) => p.verification !== 'listed')
    .sort((a, b) => (a.verification === 'verified' ? 0 : 1) - (b.verification === 'verified' ? 0 : 1)).slice(0, 6), [active]);
  const markets = active.filter((p) => p.kind === 'market').length;
  const states = new Set(active.map((p) => p.state)).size;

  const nearMe = async () => {
    const loc = await requestLocation();
    if (loc) window.scrollTo({ top: 0 });
  };

  return (
    <div className="discover">
      <section className="hero">
        <div className="hero-inner">
          <h1>African and Caribbean food, close to home.</h1>
          <p>
            {placesLoading && !places.length ? 'Markets and restaurants across the US, checked by locals.'
              : `${active.length.toLocaleString()} markets and restaurants in ${states} states, including ${markets.toLocaleString()} markets for ingredients from home.`}
          </p>
          <SearchBox size="lg" />
          <div className="hero-actions">
            <button className="btn ghost-light" onClick={nearMe} disabled={locating}><IconLocate width={18} height={18} />{locating ? 'Finding you…' : userLoc ? 'Update my location' : 'Find places near me'}</button>
            <Link className="btn ghost-light" to="/map">Open the map</Link>
          </div>
        </div>
      </section>

      <div className="discover-body">
        {install.show && (
          <aside className="install">
            <IconDownload />
            <div>
              <strong>Add Diaspora Market Map to your phone</strong>
              <p>{install.canPrompt ? 'Install it for one-tap access, even with a weak signal.' : 'In Safari, tap Share, then "Add to Home Screen".'}</p>
            </div>
            {install.canPrompt && <button className="btn primary" onClick={install.install}>Install</button>}
            <button className="icon-btn" onClick={install.dismiss} aria-label="Dismiss"><IconClose width={16} height={16} /></button>
          </aside>
        )}

        <section className="block">
          <header className="block-head">
            <h2>{userLoc ? 'Closest to you' : 'Near you'}</h2>
            {userLoc && <Link to={`/map?near=${userLoc.lat.toFixed(4)},${userLoc.lng.toFixed(4)}`} className="see-all">See all on the map <IconArrowRight width={16} height={16} /></Link>}
          </header>
          {userLoc ? (
            placesLoading && !places.length ? <Skeleton /> : (
              <ul className="results card-list">{nearby.map(({ p, d }) => <PlaceRow key={p.id} p={p} distance={d} />)}</ul>
            )
          ) : (
            <div className="prompt-card">
              <p>Share your location to see the nearest markets and restaurants. It stays on your device.</p>
              <button className="btn primary" onClick={nearMe} disabled={locating}><IconLocate width={18} height={18} />{locating ? 'Finding you…' : 'Use my location'}</button>
            </div>
          )}
        </section>

        <section className="block">
          <header className="block-head"><h2>Browse by cuisine</h2></header>
          {placesLoading && !places.length ? <div className="chip-grid skeleton-chips" aria-hidden>{Array.from({ length: 10 }, (_, i) => <span key={i} />)}</div> : (
            <div className="chip-grid">
              {cuisines.map((c) => (
                <Link key={c.key} className="cuisine-tile" to={`/map?origin=origin:${c.key}`}>
                  <span className="ct-flag" aria-hidden>{c.flag}</span>
                  <span className="ct-name">{c.label}</span>
                  <span className="ct-count">{c.count.toLocaleString()}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="block">
          <header className="block-head"><h2>Cities with the most places</h2></header>
          <div className="city-grid">
            {cities.map((c) => (
              <button key={c.key} className="city-tile" onClick={() => navigate(`/map?city=${encodeURIComponent(c.key)}`)}>
                <strong>{c.city}</strong>
                <span>{US_STATES[c.state] ?? c.state}</span>
                <span className="city-count">{c.count.toLocaleString()} {c.count === 1 ? 'place' : 'places'}</span>
              </button>
            ))}
          </div>
        </section>

        {trusted.length > 0 && (
          <section className="block">
            <header className="block-head"><h2>Checked by our team and locals</h2></header>
            <ul className="results card-list">{trusted.map((p) => <PlaceRow key={p.id} p={p} distance={userLoc ? miles(userLoc, p) : undefined} />)}</ul>
          </section>
        )}

        <section className="block split">
          <div className="callout">
            <h2>Know a spot we're missing?</h2>
            <p>Tell us about a market or restaurant and we'll check it before it goes on the map.</p>
            <Link className="btn" to="/suggest">Add a place</Link>
          </div>
          {account?.plan !== 'premium' && (
            <div className="callout callout-premium">
              <h2>Where is it cheapest?</h2>
              <p>Compare what egusi, garri, oxtail or jollof costs across stores and restaurants near you.</p>
              <Link className="btn accent" to="/prices">Compare prices</Link>
            </div>
          )}
        </section>

        <footer className="site-footer">
          <p>Listings from the <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">Overture Maps Foundation</a> and the community. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.</p>
        </footer>
      </div>
    </div>
  );
}
