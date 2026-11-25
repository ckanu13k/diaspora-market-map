// One product across places: everyone sees where it's sold and the price range; Premium sees each price, cheapest first.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { ago, formatPrice } from '../lib/items';
import { US_STATES } from '../lib/taxonomy';
import { placePath } from '../../shared/slug.js';
import { IconLocate, IconLock } from '../components/Icons';

interface Row { place_id: string; name: string; city: string | null; state: string; item: string; available: boolean; checked: string; source: string;
  price_cents: number | null; price_unit: string | null; per_lb_cents: number | null; miles: number | null }
interface Result { error?: string; product: { key: string; kind: 'market' | 'restaurant'; label: string }; places: number; min_cents: number | null; max_cents: number | null; premium: boolean; rows: Row[] }

export default function Compare({ kind }: { kind: 'market' | 'restaurant' }) {
  const { key = '' } = useParams();
  const { userLoc, requestLocation, locating, session } = useStore();
  const [res, setRes] = useState<Result | null>(null);
  const [state, setState] = useState('');

  useEffect(() => {
    setRes(null);
    supabase.rpc('compare_prices', { p_kind: kind, p_key: key, p_lat: userLoc?.lat ?? null, p_lng: userLoc?.lng ?? null, p_state: state || null, lim: 200 })
      .then(({ data }) => setRes(data as Result));
  }, [kind, key, userLoc?.lat, userLoc?.lng, state, session?.user.id]);

  useEffect(() => { if (res?.product) document.title = `${res.product.label} prices${state ? ` in ${US_STATES[state]}` : ''} | Diaspora Market Map`; }, [res?.product, state]);

  if (res?.error) return <div className="page"><h1>Not found</h1><p>We don't track that product. <Link to="/prices">See everything we compare</Link></p></div>;
  const where = kind === 'market' ? 'stores' : 'restaurants';
  const range = res && res.min_cents != null ? (res.min_cents === res.max_cents ? formatPrice(res.min_cents, null) : `${formatPrice(res.min_cents, null)} to ${formatPrice(res.max_cents, null)}`) : null;

  return (
    <div className="page wide">
      <p className="crumbs"><Link to="/prices">Compare prices</Link></p>
      <h1>{res?.product.label ?? '…'}</h1>
      {res && (
        <p className="lede">
          {res.places ? `${res.places} ${where}${state ? ` in ${US_STATES[state]}` : ''} list it` : `No ${where} list it${state ? ` in ${US_STATES[state]}` : ''} yet`}
          {range && `, typically ${range}`}. {res.premium ? 'Cheapest first, by the pound where the weight is known.' : userLoc ? 'Nearest first.' : ''}
        </p>
      )}
      <div className="prices-filters">
        <label className="select">
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">Every state</option>
            {Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {!userLoc && <button className="btn" onClick={() => requestLocation()} disabled={locating}><IconLocate width={16} height={16} />{locating ? 'Finding you…' : 'Show distances from me'}</button>}
      </div>
      {res && !res.premium && res.places > 0 && (
        <div className="callout callout-premium compare-upsell">
          <h2>See every price, cheapest first</h2>
          <p>Premium lines up each {kind === 'market' ? 'store' : 'restaurant'}'s price for {res.product.label.toLowerCase()}, per pound where it can, so you know where to go before you leave home.</p>
          <Link className="btn accent" to="/pricing">See Premium</Link>
        </div>
      )}
      {res === null && <p className="loading">Loading…</p>}
      {res && res.rows.length > 0 && (
        <ul className="compare-list">
          {res.rows.map((r) => (
            <li key={r.place_id}>
              <div className="cmp-main">
                <Link to={placePath({ id: r.place_id, name: r.name, city: r.city, state: r.state })} state={{ backLabel: `${res.product.label} prices` }}><strong>{r.name}</strong></Link>
                <span className="r-sub">{r.miles != null ? `${r.miles} mi, ` : ''}{r.city ? `${r.city}, ` : ''}{r.state}</span>
                <span className="cmp-item">{r.item}{!r.available && <span className="item-out"> Out of stock</span>}<span className="muted">. {r.source === 'website' ? 'From their website' : r.source === 'owner' ? 'From the owner' : 'From a shopper'}, {ago(r.checked)}</span></span>
              </div>
              <div className="cmp-price">
                {res.premium
                  ? (r.price_cents != null ? <><strong>{formatPrice(r.price_cents, r.price_unit)}</strong>{r.per_lb_cents != null && r.price_unit !== 'lb' && <span className="muted">{formatPrice(r.per_lb_cents, null)}/lb</span>}</> : <span className="muted">No price</span>)
                  : <span className="locked"><IconLock width={14} height={14} />Premium</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
