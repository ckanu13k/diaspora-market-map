import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { originLabel, prettyHours, SERVICE_LABEL, US_STATES } from '../lib/taxonomy';
import type { DetailsResult, Place } from '../lib/types';
import { Badge, StatusBadge } from './Badge';
import ReportDialog from './ReportDialog';

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);

export default function PlacePanel({ place, onClose }: { place: Place; onClose: () => void }) {
  const { session, account, refreshAccount, favorites, toggleFavorite, notify, patchPlace } = useStore();
  const [res, setRes] = useState<DetailsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reporting, setReporting] = useState(false);
  const premium = account?.plan === 'premium' || account?.is_admin;

  const loadDetails = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_place_details', { p_place: place.id });
    setLoading(false);
    if (error) return notify(error.message);
    setRes(data as DetailsResult);
    refreshAccount();
  };

  // Premium users get details automatically; free users choose when to spend a daily view.
  useEffect(() => {
    setRes(null);
    if (session && premium) loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, session?.user.id, premium]);

  const confirmOpen = async () => {
    if (!session) return notify('Sign in to confirm places');
    const { error } = await supabase.from('confirmations').upsert({ user_id: session.user.id, place_id: place.id, confirmed_at: new Date().toISOString() });
    if (error) return notify(error.message);
    const { data } = await supabase.from('places').select('confirm_count,last_confirmed_at,verification,status').eq('id', place.id).single();
    if (data) patchPlace(place.id, data);
    notify('Thanks! You confirmed this place is open.');
  };

  const fav = async () => {
    const err = await toggleFavorite(place.id);
    if (err === 'auth_required') notify('Sign in to save places');
    else if (err === 'premium_required') notify('Saving places is a Premium feature');
    else if (err) notify(err);
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/place/${place.id}`;
    try {
      if (navigator.share) await navigator.share({ title: place.name, url });
      else { await navigator.clipboard.writeText(url); notify('Link copied'); }
    } catch { /* user cancelled */ }
  };

  const d = res?.details;
  const address = d && [d.street, place.city, place.state, d.postcode].filter(Boolean).join(', ');
  const remaining = account && !premium ? Math.max(0, account.quota - account.used_today) : null;

  return (
    <article className="panel" aria-label={place.name}>
      <header className="panel-head">
        <div>
          <p className="eyebrow">{place.kind === 'market' ? '🛒 Market' : '🍲 Restaurant'} · {place.city ? `${place.city}, ` : ''}{US_STATES[place.state] ?? place.state}</p>
          <h2>{place.name}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="badges">
        <Badge place={place} />
        <StatusBadge place={place} />
        {place.featured && <span className="badge featured">★ Featured</span>}
      </div>

      <div className="chips">{place.origins.map((o) => <span key={o} className="chip static">{originLabel(o)}</span>)}</div>

      <p className="muted small">
        {place.verification === 'verified' && place.verified_at && <>Verified by our team on {fmtDate(place.verified_at)}. </>}
        {place.confirm_count > 0 && <>{place.confirm_count} {place.confirm_count === 1 ? 'person' : 'people'} confirmed open in the last 90 days (latest {fmtDate(place.last_confirmed_at)}). </>}
        {place.verification === 'listed' && place.confirm_count === 0 && <>Listed from public business data, not yet confirmed. Been here recently? Confirm it below.</>}
      </p>

      <section className="details">
        {!d && !loading && res?.error !== 'quota_exceeded' && (
          session ? (
            <button className="btn primary block" onClick={loadDetails}>
              Show address, phone, hours & directions
              {remaining !== null && <small> · uses 1 of {remaining} free views left today</small>}
            </button>
          ) : (
            <div className="gate">
              <p><strong>Full details are for members.</strong> Free account: {account?.quota ?? 5} places a day. Premium: unlimited.</p>
              <Link className="btn primary" to="/account">Sign in free</Link>
            </div>
          )
        )}
        {loading && <p className="muted">Loading details…</p>}
        {res?.error === 'quota_exceeded' && (
          <div className="gate">
            <p><strong>You've used your {res.quota} free detail views for today.</strong> They reset at midnight UTC. Premium unlocks unlimited details and saved places.</p>
            <Link className="btn gold" to="/pricing">Go Premium</Link>
          </div>
        )}
        {d && (
          <dl className="facts">
            {address && (<><dt>Address</dt><dd>{address}</dd></>)}
            <dt>Directions</dt>
            <dd className="row-links">
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`} target="_blank" rel="noreferrer">Google Maps</a>
              <a href={`https://maps.apple.com/?daddr=${place.lat},${place.lng}`} target="_blank" rel="noreferrer">Apple Maps</a>
            </dd>
            {d.phone && (<><dt>Phone</dt><dd><a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>{d.phone}</a></dd></>)}
            {d.website && (<><dt>Website</dt><dd><a href={d.website} target="_blank" rel="noreferrer">{d.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></dd></>)}
            {d.opening_hours && (<><dt>Hours</dt><dd>{prettyHours(d.opening_hours).map((l) => <div key={l}>{l}</div>)}</dd></>)}
            {(d.instagram || d.facebook) && (<><dt>Social</dt><dd className="row-links">
              {d.instagram && <a href={d.instagram} target="_blank" rel="noreferrer">Instagram</a>}
              {d.facebook && <a href={d.facebook} target="_blank" rel="noreferrer">Facebook</a>}
            </dd></>)}
            {d.services?.length > 0 && (<><dt>Services</dt><dd>{d.services.map((s) => SERVICE_LABEL[s] ?? s).join(' · ')}</dd></>)}
            {d.description && (<><dt>About</dt><dd>{d.description}</dd></>)}
            {d.verification_note && (<><dt>Verification</dt><dd>{d.verification_note}</dd></>)}
            {!d.phone && !d.website && !d.opening_hours && !address && (<><dt>Note</dt><dd className="muted">We don't have contact details for this place yet. Know them? Use "Suggest a fix".</dd></>)}
          </dl>
        )}
      </section>

      <div className="actions">
        <button className="btn" onClick={confirmOpen}>✓ Still open</button>
        <button className="btn" onClick={fav} aria-pressed={favorites.has(place.id)}>{favorites.has(place.id) ? '♥ Saved' : '♡ Save'}</button>
        <button className="btn" onClick={share}>Share</button>
        <button className="btn ghost" onClick={() => (session ? setReporting(true) : notify('Sign in to suggest fixes'))}>Suggest a fix</button>
      </div>

      {place.source === 'overture' && (
        <p className="muted tiny">Source: <a href="https://overturemaps.org" target="_blank" rel="noreferrer">Overture Maps Foundation</a> · updated {fmtDate(place.updated_at)}</p>
      )}
      {place.source === 'community' && <p className="muted tiny">Added by the community and verified by our team.</p>}
      {reporting && <ReportDialog place={place} onClose={() => setReporting(false)} />}
    </article>
  );
}
