import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { appRoot, supabase } from '../lib/supabase';
import { useStore } from '../lib/store';

export function SignIn() {
  const { notify } = useStore();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: appRoot() } });
    setBusy(false);
    if (error) return notify(error.message);
    setSent(true);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) return notify(error.message);
    notify('Signed in');
  };

  return (
    <div className="page narrow">
      <h1>Sign in</h1>
      <p className="lede">A free account shows the address, phone, hours and directions for 5 places a day. There's no password: we email you a sign-in link.</p>
      {!sent ? (
        <form onSubmit={send} className="stack">
          <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn primary" disabled={busy}>Email me a sign-in link</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p>We emailed a sign-in link to <strong>{email}</strong>. Open it on this device. If the email shows a code instead, enter it here.</p>
          <label className="field">Code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button className="btn primary" disabled={busy}>Sign in</button>
          <button type="button" className="btn ghost" onClick={() => setSent(false)}>Use a different email</button>
        </form>
      )}
    </div>
  );
}

export default function Account() {
  const { session, account, refreshAccount, notify } = useStore();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);

  // Stripe redirects here after checkout; the webhook may land a moment later, so poll briefly.
  useEffect(() => {
    if (params.get('checkout') !== 'success') return;
    notify('Payment received, activating Premium…');
    let n = 0;
    const t = window.setInterval(() => { refreshAccount(); if (++n >= 6) window.clearInterval(t); }, 2000);
    return () => window.clearInterval(t);
  }, [params, refreshAccount, notify]);

  if (!session) return <SignIn />;

  const portal = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('customer-portal');
    setBusy(false);
    if (error || !data?.url) return notify(error?.message ?? data?.error ?? 'Could not open billing');
    window.location.href = data.url;
  };

  const premium = account?.plan === 'premium';
  return (
    <div className="page narrow">
      <h1>Your account</h1>
      <p className="lede">{session.user.email}</p>
      <div className={`plan-box ${premium ? 'premium' : ''}`}>
        <strong>{premium ? 'Premium' : 'Free plan'}</strong>
        {premium ? (
          <p>Unlimited details and saved places.{account?.plan_expires_at && <> Renews {new Date(account.plan_expires_at).toLocaleDateString()}.</>}</p>
        ) : (
          <p>{account ? `${account.used_today} of ${account.quota}` : '…'} free detail views used today.</p>
        )}
      </div>
      <div className="stack">
        {!premium && <Link to="/pricing" className="btn accent">Upgrade to Premium</Link>}
        {account?.has_billing && <button className="btn" onClick={portal} disabled={busy}>Manage billing</button>}
        {account?.is_admin && <Link to="/admin" className="btn">Admin console</Link>}
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}
