// Claim a listing. Verified instantly when the owner signs in with an email at the business's own web domain;
// otherwise by putting a short code on their website, or by our team calling the business.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { placePath } from '../../shared/slug.js';

interface ClaimResult { id: string; status: 'pending' | 'verified' | 'rejected' | 'revoked'; method: string | null; code: string; site: string | null; site_ok: boolean; error?: string }
const ERRORS: Record<string, string> = { auth_required: 'Sign in first.', rate_limited: "You've sent several claims today. Try again tomorrow.", not_found: "We couldn't find that place." };

export default function Claim() {
  const { id = '' } = useParams();
  const { session, places, notify, refreshAccount } = useStore();
  const place = places.find((p) => p.id === id);
  const [form, setForm] = useState({ name: '', role: 'Owner', phone: '', message: '' });
  const [claim, setClaim] = useState<ClaimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<'idle' | 'checking' | 'not_found'>('idle');

  useEffect(() => { document.title = `Claim ${place?.name ?? 'a listing'} | Diaspora Market Map`; }, [place?.name]);

  if (!session) return (
    <div className="page narrow">
      <h1>Claim {place?.name ?? 'this listing'}</h1>
      <p className="lede">Sign in to claim it. Tip: sign in with an email at your business's own website (like you@yourrestaurant.com) and we can confirm you straight away.</p>
      <Link className="btn primary" to="/account">Sign in</Link>
    </div>
  );
  if (!place) return <div className="page narrow"><h1>Claim a listing</h1><p className="loading">Loading…</p></div>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc('claim_place', { p_place: place.id, p_name: form.name, p_phone: form.phone, p_role: form.role, p_message: form.message });
    setBusy(false);
    if (error) return notify(error.message);
    if (data?.error) return notify(ERRORS[data.error] ?? data.error);
    setClaim(data as ClaimResult);
    if (data.status === 'verified') refreshAccount();
  };

  const checkWebsite = async () => {
    if (!claim) return;
    setChecking('checking');
    const start = await supabase.rpc('start_website_check', { p_claim: claim.id });
    if (start.error || start.data?.error) { setChecking('idle'); return notify(start.data?.error === 'no_website' ? 'This listing has no website to check.' : start.error?.message ?? 'Could not start the check'); }
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data } = await supabase.rpc('finish_website_check', { p_claim: claim.id });
      if (data?.status === 'verified') { setClaim({ ...claim, status: 'verified', method: 'website_code' }); setChecking('idle'); refreshAccount(); return; }
      if (data && !data.waiting) break;
    }
    setChecking('not_found');
  };

  if (claim?.status === 'verified') return (
    <div className="page narrow">
      <h1>You're confirmed as the owner</h1>
      <p className="lede">{place.name} now shows "Run by the owner". Keep its hours, contact details and {place.kind === 'market' ? 'products' : 'menu'} up to date, and we'll show your changes to everyone straight away.</p>
      <div className="stack">
        <Link className="btn primary" to={`/owner/${place.id}`}>Edit your listing</Link>
        <Link className="btn" to={placePath(place)}>{place.kind === 'market' ? 'Add your products and prices' : 'Add your menu and prices'}</Link>
      </div>
    </div>
  );

  if (claim) return (
    <div className="page">
      <h1>Confirm you run {place.name}</h1>
      <p className="lede">Pick whichever is easiest. Your claim is saved, so you can come back to this page.</p>
      <div className="stack">
        {claim.site_ok && claim.site && (
          <section className="claim-way">
            <h2>Put a code on your website (fastest)</h2>
            <p>Add this code anywhere on the home page of <strong>{claim.site}</strong>, or save it as a file at <code>{claim.site}/diaspora-market-map.txt</code>:</p>
            <p className="claim-code"><code>{claim.code}</code> <button className="linkish" onClick={() => { navigator.clipboard?.writeText(claim.code); notify('Code copied'); }}>Copy</button></p>
            <button className="btn primary" onClick={checkWebsite} disabled={checking === 'checking'}>{checking === 'checking' ? 'Checking your website…' : 'Check my website'}</button>
            {checking === 'not_found' && <p className="muted">We didn't find the code yet. Website changes can take a few minutes to appear; try again shortly.</p>}
          </section>
        )}
        {claim.site_ok && claim.site && (
          <section className="claim-way">
            <h2>Or sign in with your business email</h2>
            <p>If you have an email address at <strong>@{claim.site}</strong>, sign out, sign back in with it, and claim again. We'll confirm you straight away.</p>
          </section>
        )}
        <section className="claim-way">
          <h2>{claim.site_ok ? 'Or let us check' : 'We\'ll check with you'}</h2>
          <p>Our team will call the number listed for {place.name} to confirm, usually within a few days. You can close this page; your listing unlocks as soon as we've confirmed.</p>
        </section>
      </div>
    </div>
  );

  return (
    <div className="page narrow">
      <p className="crumbs"><Link to={placePath(place)}>{place.name}</Link></p>
      <h1>Claim this listing</h1>
      <p className="lede">Owners and managers can keep their hours, contact details and {place.kind === 'market' ? 'products' : 'menu'} up to date. It's free.</p>
      <form className="stack" onSubmit={submit}>
        <label className="field">Your name<input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
        <label className="field">Your role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option>Owner</option><option>Manager</option><option>Staff</option><option>Marketing or agency</option>
          </select>
        </label>
        <label className="field">Phone we can reach you on<input maxLength={40} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></label>
        <label className="field">Anything we should know <span className="optional">optional</span><textarea rows={3} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
        <p className="muted small">Signed in as {session.user.email}.</p>
        <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Claim this listing'}</button>
      </form>
    </div>
  );
}
