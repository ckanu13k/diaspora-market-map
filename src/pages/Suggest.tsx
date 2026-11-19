import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { ORIGIN, ORIGINS, REGIONS, US_STATES } from '../lib/taxonomy';

const empty = { name: '', kind: 'restaurant', street: '', city: '', state: '', postcode: '', phone: '', website: '', instagram: '', opening_hours: '', description: '' };

export default function Suggest() {
  const { session, notify } = useStore();
  const [f, setF] = useState(empty);
  const [origins, setOrigins] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!session) return <div className="page narrow"><h1>Add a place</h1><p>Sign in (free) to suggest a market or restaurant.</p><Link className="btn primary" to="/account">Sign in</Link></div>;
  if (done) return <div className="page narrow"><h1>Thank you!</h1><p>We'll verify it and add it to the map, usually within a few days.</p><button className="btn" onClick={() => { setF(empty); setOrigins([]); setCoords(null); setDone(false); }}>Add another</button></div>;

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const here = () => navigator.geolocation.getCurrentPosition(
    (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); notify('Location added'); },
    () => notify('Could not get your location'),
    { enableHighAccuracy: true },
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!origins.length) return notify('Pick at least one origin / cuisine');
    setBusy(true);
    const payload = {
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])),
      origins,
      regions: [...new Set(origins.map((o) => ORIGIN.get(o)!.region))],
      ...(coords ?? {}),
    };
    const { error } = await supabase.from('reports').insert({ kind: 'new_place', user_id: session.user.id, payload });
    setBusy(false);
    if (error) return notify(error.message);
    setDone(true);
  };

  return (
    <form className="page narrow stack" onSubmit={submit}>
      <h1>Add a market or restaurant</h1>
      <p className="lede">Know a spot that's missing? Tell us about it and we'll check it before it goes on the map.</p>
      <label className="field">Name<input required value={f.name} onChange={set('name')} /></label>
      <div className="seg">
        {['restaurant', 'market'].map((k) => (
          <button type="button" key={k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>{k === 'market' ? 'Market or grocery' : 'Restaurant or food spot'}</button>
        ))}
      </div>
      <div className="field">Origin / cuisine
        <div className="chips wrap">
          {REGIONS.flatMap((r) => ORIGINS.filter((o) => o.region === r.key)).map((o) => (
            <button type="button" key={o.key} className={`chip ${origins.includes(o.key) ? 'on' : ''}`}
              onClick={() => setOrigins((s) => (s.includes(o.key) ? s.filter((x) => x !== o.key) : [...s, o.key]))}>{o.flag} {o.label}</button>
          ))}
        </div>
      </div>
      <label className="field">Street address<input value={f.street} onChange={set('street')} /></label>
      <div className="filter-row">
        <label className="field">City<input required value={f.city} onChange={set('city')} /></label>
        <label className="field">State
          <select required value={f.state} onChange={set('state')}><option value="" />{Object.keys(US_STATES).map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field">ZIP<input value={f.postcode} onChange={set('postcode')} inputMode="numeric" /></label>
      </div>
      <button type="button" className="btn" onClick={here}>{coords ? `Location added (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})` : "I'm here now: use my location"}</button>
      <label className="field">Phone<input type="tel" value={f.phone} onChange={set('phone')} /></label>
      <label className="field">Website<input type="url" placeholder="https://" value={f.website} onChange={set('website')} /></label>
      <label className="field">Instagram<input placeholder="https://instagram.com/…" value={f.instagram} onChange={set('instagram')} /></label>
      <label className="field">Hours<input placeholder="Mo-Sa 10:00-20:00; Su 12:00-18:00" value={f.opening_hours} onChange={set('opening_hours')} /></label>
      <label className="field">What's good here?<textarea rows={3} value={f.description} onChange={set('description')} placeholder="Fresh goat meat, ugu, palm oil… / best jerk in town" /></label>
      <button className="btn primary" disabled={busy}>Submit for verification</button>
    </form>
  );
}
