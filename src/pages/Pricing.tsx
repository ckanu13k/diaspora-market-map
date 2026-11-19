import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PRICE_MONTHLY, PRICE_YEARLY, supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { IconCheck } from '../components/Icons';

export default function Pricing() {
  const { session, account, places, notify } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const premium = account?.plan === 'premium';

  const checkout = async (interval: 'month' | 'year') => {
    setBusy(interval);
    const { data, error } = await supabase.functions.invoke('create-checkout', { body: { interval } });
    setBusy(null);
    if (error || !data?.url) return notify('Checkout isn\'t available yet. Try again shortly.');
    window.location.href = data.url;
  };

  const total = places.length ? places.length.toLocaleString() : 'Thousands of';
  const states = new Set(places.map((p) => p.state)).size || 50;

  return (
    <div className="pricing">
      <section className="pricing-hero">
        <h1>Find the taste of home, anywhere in the US.</h1>
        <p>{total} African and Caribbean markets and restaurants across {states} states, checked by our team and by people who shop and eat there.</p>
      </section>

      <div className="plans">
        <section className="plan">
          <h2>Free</h2>
          <p className="price">$0</p>
          <ul>
            <li><IconCheck />The full map, search and filters</li>
            <li><IconCheck />Address, phone, hours and directions for 5 places a day</li>
            <li><IconCheck />Confirm places and suggest fixes</li>
          </ul>
          {!session ? <Link className="btn" to="/account">Create a free account</Link> : <span className="plan-current">Your current plan{premium ? ' before Premium' : ''}</span>}
        </section>

        <section className="plan plan-premium">
          <h2>Premium</h2>
          <p className="price">{PRICE_MONTHLY}</p>
          <p className="price-alt">or {PRICE_YEARLY} billed yearly</p>
          <ul>
            <li><IconCheck />Every address, phone number and opening time</li>
            <li><IconCheck />Directions to any place in one tap</li>
            <li><IconCheck />Saved places on all your devices</li>
            <li><IconCheck />Helps keep independent shops listed and verified</li>
          </ul>
          {premium ? (
            <span className="plan-current">You're on Premium</span>
          ) : !session ? (
            <Link className="btn accent" to="/account">Sign in to subscribe</Link>
          ) : (
            <div className="plan-buttons">
              <button className="btn accent" disabled={!!busy} onClick={() => checkout('month')}>{busy === 'month' ? 'Opening checkout…' : `Subscribe monthly`}</button>
              <button className="btn ghost-light" disabled={!!busy} onClick={() => checkout('year')}>{busy === 'year' ? 'Opening checkout…' : `Pay yearly`}</button>
            </div>
          )}
        </section>
      </div>
      <p className="fineprint">Payments are handled by Stripe. Cancel any time from your account.</p>
    </div>
  );
}
