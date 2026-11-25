// Search with suggestions: cuisines, cities, states and places, keyboard-navigable (combobox pattern).
import { useDeferredValue, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { ORIGINS, US_STATES } from '../lib/taxonomy';
import { topCities } from '../lib/insights';
import { IconBasket, IconBowl, IconPin, IconSearch } from './Icons';
import productsRaw from '../../shared/products.json';
import { placePath, productPath } from '../../shared/slug.js';

const PRODUCTS = (productsRaw.products as [string, number, string, string, string][]).map(([kind, , key, label]) => ({ kind: kind as 'market' | 'restaurant', key, label }));

type Suggestion =
  | { type: 'cuisine'; key: string; label: string; flag: string }
  | { type: 'city'; key: string; label: string; count: number }
  | { type: 'state'; key: string; label: string }
  | { type: 'place'; key: string; label: string; sub: string; kind: 'market' | 'restaurant'; path: string }
  | { type: 'product'; key: string; label: string; kind: 'market' | 'restaurant' };

export default function SearchBox({ placeholder = 'Search a cuisine, city or place', size = 'md', onSearch }: {
  placeholder?: string; size?: 'md' | 'lg'; onSearch?: (q: string) => void;
}) {
  const { places } = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const deferred = useDeferredValue(q);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const cities = useMemo(() => topCities(places, 400), [places]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const n = deferred.trim().toLowerCase();
    if (n.length < 2) return [];
    const out: Suggestion[] = [];
    for (const o of ORIGINS) {
      if (o.label.toLowerCase().includes(n) || o.keywords.some((k) => k.toLowerCase().startsWith(n)))
        out.push({ type: 'cuisine', key: o.key, label: o.label.replace(' (general)', ''), flag: o.flag });
      if (out.length >= 3) break;
    }
    for (const c of cities) {
      if (c.city.toLowerCase().startsWith(n)) out.push({ type: 'city', key: c.key, label: `${c.city}, ${c.state}`, count: c.count });
      if (out.filter((s) => s.type === 'city').length >= 3) break;
    }
    let prods = 0;
    for (const pr of PRODUCTS) {
      if (pr.label.toLowerCase().split(/[\s/(]+/).some((w) => w.startsWith(n)) || pr.label.toLowerCase().startsWith(n)) {
        out.push({ type: 'product', key: pr.key, label: pr.label, kind: pr.kind });
        if (++prods >= 2) break;
      }
    }
    for (const [code, name] of Object.entries(US_STATES)) {
      if (name.toLowerCase().startsWith(n) || code.toLowerCase() === n) { out.push({ type: 'state', key: code, label: name }); break; }
    }
    let shown = 0;
    for (const p of places) {
      if (p.name.toLowerCase().includes(n)) {
        out.push({ type: 'place', key: p.id, label: p.name, sub: p.city ? `${p.city}, ${p.state}` : US_STATES[p.state], kind: p.kind, path: placePath(p) });
        if (++shown >= 5) break;
      }
    }
    return out.slice(0, 10);
  }, [deferred, places, cities]);

  const choose = (s: Suggestion) => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    if (s.type === 'cuisine') navigate(`/map?origin=origin:${s.key}`);
    else if (s.type === 'city') navigate(`/map?city=${encodeURIComponent(s.key)}`);
    else if (s.type === 'state') navigate(`/map?state=${s.key}`);
    else if (s.type === 'product') navigate(productPath(s.kind, s.key));
    else navigate(s.path);
  };

  const submit = () => {
    const text = q.trim();
    if (active >= 0 && suggestions[active]) return choose(suggestions[active]);
    if (!text) return;
    setOpen(false);
    if (onSearch) onSearch(text); else navigate(`/map?q=${encodeURIComponent(text)}`);
  };

  return (
    <div className={`searchbox ${size}`} role="search">
      <label className="search">
        <IconSearch />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, suggestions.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)); }
            else if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
          aria-label="Search"
        />
      </label>
      {open && suggestions.length > 0 && (
        <ul className="suggestions" id={listId} role="listbox">
          {suggestions.map((s, i) => (
            <li key={`${s.type}-${s.key}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); choose(s); }}>
              <span className="sg-icon" aria-hidden>
                {s.type === 'cuisine' ? s.flag : s.type === 'place' || s.type === 'product' ? (s.kind === 'market' ? <IconBasket width={16} height={16} /> : <IconBowl width={16} height={16} />) : <IconPin width={16} height={16} />}
              </span>
              <span className="sg-text">
                <strong>{s.label}</strong>
                <small>
                  {s.type === 'cuisine' && 'Cuisine'}
                  {s.type === 'city' && `${s.count.toLocaleString()} ${s.count === 1 ? 'place' : 'places'}`}
                  {s.type === 'state' && 'State'}
                  {s.type === 'place' && s.sub}
                  {s.type === 'product' && (s.kind === 'market' ? 'Compare grocery prices' : 'Compare dish prices')}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

