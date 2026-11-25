import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { ORIGIN, prettyHours, SERVICE_LABEL, US_STATES } from '../lib/taxonomy';
import type { DetailsResult, Place } from '../lib/types';
import { Badge, StatusBadge } from './Badge';
import { IconCheck, IconClock, IconClose, IconFlag, IconGlobe, IconHeart, IconHeartFilled, IconLock, IconPhone, IconPin, IconRoute, IconShare, IconThumbDown, IconThumbUp } from './Icons';
import ReportDialog from './ReportDialog';
import { formatMiles, miles } from '../lib/geo';

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);

export default function PlacePanel({ place, onClose }: { place: Place; onClose: () => void }) {
  const { session, account, refreshAccount, favorites, toggleFavorite, notify, patchPlace, userLoc } = useStore();
  const [res, setRes] = useState<DetailsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reporting, setReporting] = useState<false | 'fix' | 'wrong'>(false);
  const [myVote, setMyVote] = useState<1 | -1 | null>(null);
  const [voting, setVoting] = useState(false);
  const premium = account?.plan === 'premium' || account?.is_admin;

  const loadDetails = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_place_details', { p_place: place.id });
    setLoading(false);
    if (error) return notify(error.message);
    setRes(data as DetailsResult);
    refreshAccount();
  };

  // Premium members see details straight away; free members choose when to use a daily view.
  useEffect(() => {
    setRes(null);
    if (session && premium) loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, session?.user.id, premium]);

  // The signed-in user's own thumbs up/down for this place, if any
  useEffect(() => {
    setMyVote(null);
    if (!session) return;
    supabase.from('detail_votes').select('vote').eq('place_id', place.id).eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => setMyVote((data?.vote as 1 | -1 | undefined) ?? null));
  }, [place.id, session?.user.id]);

  const vote = async (v: 1 | -1) => {
    if (!session) return notify('Sign in to rate these details');
    if (voting) return;
    setVoting(true);
    const undo = myVote === v;
    const { error } = undo
      ? await supabase.from('detail_votes').delete().eq('place_id', place.id).eq('user_id', session.user.id)
      : await supabase.from('detail_votes').upsert({ user_id: session.user.id, place_id: place.id, vote: v });
    if (error) { setVoting(false); return notify(error.message); }
    setMyVote(undo ? null : v);
    const { data } = await supabase.from('places').select('accurate_votes,inaccurate_votes').eq('id', place.id).single();
    if (data) patchPlace(place.id, data);
    setVoting(false);
    if (undo) notify('Rating removed');
    else if (v === 1) notify('Thanks. Marked these details as correct.');
    else setReporting('wrong');
  };

  const confirmOpen = async () => {
    if (!session) return notify('Sign in to confirm a place is open');
    const { error } = await supabase.from('confirmations').upsert({ user_id: session.user.id, place_id: place.id, confirmed_at: new Date().toISOString() });
    if (error) return notify(error.message);
    const { data } = await supabase.from('places').select('confirm_count,last_confirmed_at,verification,status').eq('id', place.id).single();
    if (data) patchPlace(place.id, data);
    notify('Confirmed. Thanks for keeping the map current.');
  };

  const fav = async () => {
    const err = await toggleFavorite(place.id);
    if (err === 'auth_required') notify('Sign in to save places');
    else if (err === 'premium_required') notify('Saving places is part of Premium');
    else if (err) notify(err);
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/place/${place.id}`;
    try {
      if (navigator.share) await navigator.share({ title: place.name, url });
      else { await navigator.clipboard.writeText(url); notify('Link copied'); }
    } catch { /* share sheet dismissed */ }
  };

  const d = res?.details;
  const address = d && [d.street, place.city, place.state, d.postcode].filter(Boolean).join(', ');
  const remaining = account && !premium ? Math.max(0, account.quota - account.used_today) : null;
  const where = `${place.city ? `${place.city}, ` : ''}${US_STATES[place.state] ?? place.state}`;
  const saved = favorites.has(place.id);

  return (
    <article className="panel" aria-label={place.name}>
      <header className="panel-head">
        <div>
          <h2>{place.name}</h2>
          <p className="panel-where">{place.kind === 'market' ? 'Market' : 'Restaurant'} in {where}{userLoc && <>, {formatMiles(miles(userLoc, place))} away</>}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose width={18} height={18} /></button>
      </header>

      <div className="cuisines">
        {place.origins.map((o) => <span key={o} className="cuisine"><span aria-hidden>{ORIGIN.get(o)?.flag}</span>{ORIGIN.get(o)?.label.replace(' (general)', '') ?? o}</span>)}
      </div>

      <div className="trust">
        <div className="badges"><Badge place={place} /><StatusBadge place={place} />{place.featured && <span className="badge featured">Featured</span>}</div>
        <p>
          {place.verification === 'verified' && place.verified_at && <>Checked by our team on {fmtDate(place.verified_at)}. </>}
          {place.confirm_count > 0 && <>{place.confirm_count} {place.confirm_count === 1 ? 'person has' : 'people have'} confirmed it's open in the last 90 days. </>}
          {place.verification === 'listed' && place.confirm_count === 0 && <>From public business data. Been here lately? Tap "Still open" to confirm it.</>}
        </p>
        {place.accurate_votes + place.inaccurate_votes > 0 && (
          <p className="vote-summary">
            {place.accurate_votes} of {place.accurate_votes + place.inaccurate_votes} {place.accurate_votes + place.inaccurate_votes === 1 ? 'person says' : 'people say'} the details are correct.
          </p>
        )}
      </div>

      <section className="details" aria-live="polite">
        {!d && !loading && res?.error !== 'quota_exceeded' && (
          session ? (
            <button className="reveal" onClick={loadDetails}>
              <IconLock width={18} height={18} />
              <span>
                <strong>Show address, phone, hours and directions</strong>
                {remaining !== null && <small>Uses 1 of your {remaining} free views left today</small>}
              </span>
            </button>
          ) : (
            <div className="gate">
              <p><strong>Contact details are for members.</strong> A free account shows {account?.quota ?? 5} places a day. Premium shows every place.</p>
              <Link className="btn primary" to="/account">Create a free account</Link>
            </div>
          )
        )}
        {loading && <p className="loading">Loading details…</p>}
        {res?.error === 'quota_exceeded' && (
          <div className="gate">
            <p><strong>You've used today's {res.quota} free views.</strong> They reset at midnight UTC. Premium shows every place, any time.</p>
            <Link className="btn accent" to="/pricing">See Premium</Link>
          </div>
        )}
        {d && (
          <ul className="facts">
            {address && <li><IconPin /><span>{address}</span></li>}
            <li><IconRoute /><span className="links">
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`} target="_blank" rel="noreferrer">Directions in Google Maps</a>
              <a href={`https://maps.apple.com/?daddr=${place.lat},${place.lng}`} target="_blank" rel="noreferrer">Apple Maps</a>
            </span></li>
            {d.phone && <li><IconPhone /><a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>{d.phone}</a></li>}
            {d.website && <li><IconGlobe /><a href={d.website} target="_blank" rel="noreferrer">{d.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></li>}
            {d.opening_hours && <li><IconClock /><span>{prettyHours(d.opening_hours).map((l) => <span key={l} className="hours-line">{l}</span>)}</span></li>}
            {(d.instagram || d.facebook) && <li><IconShare /><span className="links">
              {d.instagram && <a href={d.instagram} target="_blank" rel="noreferrer">Instagram</a>}
              {d.facebook && <a href={d.facebook} target="_blank" rel="noreferrer">Facebook</a>}
            </span></li>}
            {d.services?.length > 0 && <li><IconCheck /><span>{d.services.map((s) => SERVICE_LABEL[s] ?? s).join(', ')}</span></li>}
            {d.description && <li className="about"><span>{d.description}</span></li>}
            {d.verification_note && <li className="note"><span>Verification note: {d.verification_note}</span></li>}
            {!d.phone && !d.website && !d.opening_hours && !address && <li className="note"><span>We don't have contact details for this place yet. If you know them, use "Suggest a fix".</span></li>}
          </ul>
        )}
        {d && (
          <div className="vote" role="group" aria-label="Are these details correct?">
            <span className="vote-q">Are these details correct?</span>
            <span className="vote-btns">
            <button className={`vote-btn up ${myVote === 1 ? 'on' : ''}`} onClick={() => vote(1)} aria-pressed={myVote === 1} disabled={voting}>
              <IconThumbUp width={18} height={18} />Yes{place.accurate_votes > 0 && <span className="vote-n">{place.accurate_votes}</span>}
            </button>
            <button className={`vote-btn down ${myVote === -1 ? 'on' : ''}`} onClick={() => vote(-1)} aria-pressed={myVote === -1} disabled={voting}>
              <IconThumbDown width={18} height={18} />No{place.inaccurate_votes > 0 && <span className="vote-n">{place.inaccurate_votes}</span>}
            </button>
            </span>
          </div>
        )}
      </section>

      <div className="panel-actions">
        <button className="action" onClick={confirmOpen}><IconCheck />Still open</button>
        <button className="action" onClick={fav} aria-pressed={saved}>{saved ? <IconHeartFilled /> : <IconHeart />}{saved ? 'Saved' : 'Save'}</button>
        <button className="action" onClick={share}><IconShare />Share</button>
        <button className="action" onClick={() => (session ? setReporting('fix') : notify('Sign in to suggest a fix'))}><IconFlag />Suggest a fix</button>
      </div>

      {place.source === 'overture' && <p className="source">Listing from Overture Maps Foundation, updated {fmtDate(place.updated_at)}.</p>}
      {place.source === 'community' && <p className="source">Added by the community and checked by our team.</p>}
      {reporting === 'fix' && <ReportDialog place={place} onClose={() => setReporting(false)} />}
      {reporting === 'wrong' && <ReportDialog place={place} title="Thanks. What's wrong with these details?" onClose={() => setReporting(false)} />}
    </article>
  );
}
