import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PRICE_MONTHLY, PRICE_YEARLY, supabase } from '../lib/supabase';
import { useStore } from '../lib/store';

export default function Pricing() {
  const { session, account, notify } = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  const checkout = async (interval: 'month' | 'year') => {
    setBusy(interval);
    const { data, error } = await supabase.functions.invoke('create-checkout', { body: { interval } });
    setBusy(null);
    if (error || !data?.url) return notify(error?.message ?? data?.error ?? 'Checkout unavailable');
    window.location.href = data.url;
  };

  const premium = account?.plan === 'premium';
  const cta = (interval: 'month' | 'year', label: string) =>
    !session ? <Link className="btn gold block" to="/account">Sign in to subscribe</Link>
      : premium ? <button className="btn block" disabled>You're Premium ★</button>
      : <button className="btn gold block" disabled={!!busy} onClick={() => checkout(interval)}>{busy === interval ? 'Opening checkout…' : label}</button>;

  return (
    <div className="pricing">
      <h1>Find the taste of home, anywhere in the US</h1>
      <p className="lead muted">Browsing the map is free. Premium unlocks every verified detail.</p>
      <div className="tiers">
        <section className="tier">
          <h2>Explorer</h2>
          <p className="price">Free</p>
          <ul>
            <li>Nationwide map of markets & restaurants</li>
            <li>Search and filter by country, cuisine and state</li>
            <li>Verification & "may be closed" badges</li>
            <li>5 full place details per day (with free account)</li>
            <li>Confirm places & suggest fixes</li>
          </ul>
          {!session ? <Link className="btn block" to="/account">Create free account</Link> : <button className="btn block" disabled>Included</button>}
        </section>
        <section className="tier featured">
          <span className="ribbon">Best value</span>
          <h2>Premium</h2>
          <p className="price">{PRICE_MONTHLY}</p>
          <p className="muted small">or {PRICE_YEARLY}</p>
          <ul>
            <li><strong>Unlimited</strong> addresses, phones, hours & directions</li>
            <li>Save favorites across devices</li>
            <li>Support independent diaspora businesses being listed & verified</li>
          </ul>
          <div className="stack">
            {cta('month', `Subscribe ${PRICE_MONTHLY}`)}
            {!premium && session && <button className="btn block" disabled={!!busy} onClick={() => checkout('year')}>{busy === 'year' ? 'Opening checkout…' : `Pay yearly ${PRICE_YEARLY}`}</button>}
          </div>
        </section>
      </div>
      <p className="muted small center">Secure payment by Stripe. Cancel anytime from your account.</p>
    </div>
  );
}
