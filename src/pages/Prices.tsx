// Compare prices: every product that people or stores' websites have priced, with how many places carry it.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatPrice } from '../lib/items';
import { US_STATES } from '../lib/taxonomy';
import { productPath } from '../../shared/slug.js';
import { IconSearch } from '../components/Icons';

interface ProductStat { key: string; kind: 'market' | 'restaurant'; label: string; places: number; min_cents: number | null; max_cents: number | null }

export default function Prices() {
  const [list, setList] = useState<ProductStat[] | null>(null);
  const [state, setState] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    document.title = 'Compare prices of African and Caribbean groceries and dishes | Diaspora Market Map';
    setList(null);
    supabase.rpc('product_overview', { p_state: state || null }).then(({ data }) => setList((data as ProductStat[]) ?? []));
  }, [state]);

  const n = q.trim().toLowerCase();
  const shown = useMemo(() => (list ?? []).filter((p) => !n || p.label.toLowerCase().includes(n)), [list, n]);
  const groceries = shown.filter((p) => p.kind === 'market');
  const dishes = shown.filter((p) => p.kind === 'restaurant');
  const range = (p: ProductStat) => (p.min_cents == null ? 'No prices yet' : p.min_cents === p.max_cents ? formatPrice(p.min_cents, null) : `${formatPrice(p.min_cents, null)}–${formatPrice(p.max_cents, null)}`);

  const grid = (items: ProductStat[]) => (
    <ul className="product-grid">
      {items.map((p) => (
        <li key={`${p.kind}:${p.key}`}>
          <Link to={productPath(p.kind, p.key)} className="product-card">
            <strong>{p.label}</strong>
            <span>{p.places} {p.kind === 'market' ? (p.places === 1 ? 'store' : 'stores') : (p.places === 1 ? 'restaurant' : 'restaurants')}</span>
            <span className="product-range">{range(p)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="page wide">
      <h1>Compare prices</h1>
      <p className="lede">What African and Caribbean groceries and dishes cost, and where to find them. Prices come from stores' own websites and from shoppers.</p>
      <div className="prices-filters">
        <label className="search">
          <IconSearch />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Egusi, garri, oxtail, jollof…" aria-label="Find a product" />
        </label>
        <label className="select">
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">Every state</option>
            {Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {list === null && <p className="loading">Loading prices…</p>}
      {list && !shown.length && <p className="muted">Nothing priced{state ? ` in ${US_STATES[state]}` : ''}{n ? ` matches "${q}"` : ''} yet. Add prices on any place's page.</p>}
      {groceries.length > 0 && <><h2 className="prices-h2">Groceries</h2>{grid(groceries)}</>}
      {dishes.length > 0 && <><h2 className="prices-h2">Dishes</h2>{grid(dishes)}</>}
    </div>
  );
}
