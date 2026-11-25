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
        <h1>Know where it's cheapest before you leave home.</h1>
        <p>Everything about {total} African and Caribbean markets and restaurants across {states} states is free. Premium compares prices across them.</p>
      </section>

      <div className="plans">
        <section className="plan">
          <h2>Free</h2>
          <p className="price">$0</p>
          <ul>
            <li><IconCheck />The full map, search and filters</li>
            <li><IconCheck />Address, phone, hours and directions for every place</li>
            <li><IconCheck />Menus and product lists with prices</li>
            <li><IconCheck />Which places sell a product, and the price range</li>
            <li><IconCheck />Save up to 10 places</li>
          </ul>
          {!session ? <Link className="btn" to="/account">Create a free account</Link> : <span className="plan-current">Your current plan{premium ? ' before Premium' : ''}</span>}
        </section>

        <section className="plan plan-premium">
          <h2>Premium</h2>
          <p className="price">{PRICE_MONTHLY}</p>
          <p className="price-alt">or {PRICE_YEARLY} billed yearly</p>
          <ul>
            <li><IconCheck />Compare prices: every store's price for a product, cheapest first</li>
            <li><IconCheck />Price per pound worked out where the size is listed</li>
            <li><IconCheck />Save as many places as you like, on all your devices</li>
            <li><IconCheck />Helps keep independent shops listed and checked</li>
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
