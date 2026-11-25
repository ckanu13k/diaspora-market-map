// Owners (and admins) edit a listing's details. Saved details are kept even when the weekly import runs.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import type { DetailsResult } from '../lib/types';
import { placePath } from '../../shared/slug.js';

const FIELDS: { key: string; label: string; hint?: string; long?: boolean; type?: string }[] = [
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'website', label: 'Website', hint: 'Starts with https://', type: 'url' },
  { key: 'menu_url', label: 'Link to your menu or online shop', type: 'url' },
  { key: 'opening_hours', label: 'Opening hours', hint: 'For example: Mon–Sat 10am–8pm; Sun closed' },
  { key: 'street', label: 'Street address' },
  { key: 'postcode', label: 'ZIP code' },
  { key: 'description', label: 'About your business', long: true },
  { key: 'instagram', label: 'Instagram link', type: 'url' },
  { key: 'facebook', label: 'Facebook link', type: 'url' },
];

export default function OwnerEdit() {
  const { id = '' } = useParams();
  const { session, account, places, notify } = useStore();
  const place = places.find((p) => p.id === id);
  const [res, setRes] = useState<DetailsResult | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('get_place_details', { p_place: id }).then(({ data }) => {
      setRes(data as DetailsResult);
      const d = (data as DetailsResult)?.details as unknown as Record<string, string | null> | undefined;
      if (d) setForm(Object.fromEntries(FIELDS.map((f) => [f.key, d[f.key] ?? ''])));
    });
  }, [id, session?.user.id]);

  const allowed = res?.owner?.you || account?.is_admin;
  if (!session) return <div className="page narrow"><h1>Edit your listing</h1><p>Sign in first.</p><Link className="btn primary" to="/account">Sign in</Link></div>;
  if (!place || !res) return <div className="page narrow"><h1>Edit your listing</h1><p className="loading">Loading…</p></div>;
  if (!allowed) return <div className="page narrow"><h1>Edit {place.name}</h1><p>Only a confirmed owner can edit this listing.</p><Link className="btn primary" to={`/claim/${place.id}`}>Claim this listing</Link></div>;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc('owner_update_place', { p_place: place.id, p: form });
    setBusy(false);
    if (error) return notify(error.message);
    if (data?.error === 'bad_website') return notify('The website needs to start with https:// and be a full address.');
    if (data?.error) return notify(data.error);
    notify('Saved. Everyone sees your changes now.');
  };

  return (
    <div className="page narrow">
      <p className="crumbs"><Link to={placePath(place)}>{place.name}</Link></p>
      <h1>Edit your listing</h1>
      <p className="lede">Changes show to everyone straight away. To update your {place.kind === 'market' ? 'products' : 'menu'} and prices, open <Link to={placePath(place)}>your place</Link> and use Add or the pencil on each item.</p>
      <form className="stack" onSubmit={save}>
        {FIELDS.map((f) => (
          <label key={f.key} className="field">{f.label}{f.hint && <span className="optional"> {f.hint}</span>}
            {f.long
              ? <textarea rows={4} maxLength={600} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              : <input type={f.type ?? 'text'} maxLength={300} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
          </label>
        ))}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
  );
}
