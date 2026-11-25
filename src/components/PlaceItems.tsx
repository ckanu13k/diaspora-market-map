import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import type { Place } from '../lib/types';
import { ago, COMMON_ITEMS, formatPrice, isStale, parsePrice, SECTIONS, UNITS, type PlaceItem } from '../lib/items';
import { IconPlus, IconSearch, IconThumbUp } from './Icons';

const SHOW_FIRST = 8;

const IconPencil = (p: { width?: number; height?: number }) => (
  <svg width={p.width ?? 16} height={p.height ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m15.5 5.5 3 3M5 16l10.8-10.8a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4Z" />
  </svg>
);

type Draft = { id: string | null; name: string; section: string; price: string; unit: string; available: boolean; description: string };
const blank = (kind: Place['kind']): Draft => ({ id: null, name: '', section: '', price: '', unit: kind === 'restaurant' ? 'plate' : 'each', available: true, description: '' });

const ERRORS: Record<string, string> = {
  auth_required: 'Sign in to add or update items.',
  rate_limited: "You've made a lot of changes today. Try again tomorrow.",
  duplicate: 'That item is already on the list. Update it instead.',
  bad_name: 'Give the item a name (up to 80 characters).',
  not_found: 'That item was just removed. Reload the place to see the latest list.',
  forbidden: 'Only the person who added it can delete it, within a day. Mark it as changed instead.',
};

export default function PlaceItems({ place, items, website, menuUrl = null, sourceUrl = null, onItems }: {
  place: Place;
  items: PlaceItem[];
  website: string | null;
  menuUrl?: string | null;
  sourceUrl?: string | null;
  onItems: (items: PlaceItem[]) => void;
}) {
  const { session, notify } = useStore();
  const [myVotes, setMyVotes] = useState<Record<string, 1 | -1>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const uid = useId();
  const isMarket = place.kind === 'market';
  const title = isMarket ? 'Products' : 'Menu';
  const outLabel = isMarket ? 'Out of stock' : 'Not available now';

  useEffect(() => {
    setMyVotes({});
    if (!session || !items.length) return;
    supabase.from('place_item_votes').select('item_id,vote').in('item_id', items.map((i) => i.id))
      .then(({ data }) => setMyVotes(Object.fromEntries((data ?? []).map((v) => [v.item_id, v.vote]))));
  }, [session?.user.id, items.map((i) => i.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromSite = items.filter((i) => i.source === 'website').length;
  const lastChecked = useMemo(
    () => items.reduce<string | null>((m, i) => (!m || i.last_confirmed_at > m ? i.last_confirmed_at : m), null),
    [items],
  );

  // Menu order: known sections in their usual order, then anything else A–Z, then unsectioned
  const ordered = useMemo(() => {
    const order = SECTIONS[place.kind].map((x) => x.toLowerCase());
    const rank = (sec: string) => (!sec ? 1e6 : order.indexOf(sec.toLowerCase()) >= 0 ? order.indexOf(sec.toLowerCase()) : 1e3);
    return [...items].sort((a, b) => rank(a.section) - rank(b.section) || a.section.localeCompare(b.section) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [items, place.kind]);

  const needle = filter.trim().toLowerCase();
  const visible = needle ? ordered.filter((i) => `${i.name} ${i.section} ${i.description ?? ''}`.toLowerCase().includes(needle)) : ordered;
  const shown = showAll || needle ? visible : visible.slice(0, SHOW_FIRST);
  const groups = useMemo(() => {
    const m = new Map<string, PlaceItem[]>();
    for (const it of shown) m.set(it.section || 'Other', [...(m.get(it.section || 'Other') ?? []), it]);
    return [...m.entries()];
  }, [shown]);

  const vote = async (it: PlaceItem, v: 1 | -1) => {
    if (!session) return notify('Sign in to confirm items');
    const undo = myVotes[it.id] === v;
    const { error } = undo
      ? await supabase.from('place_item_votes').delete().eq('item_id', it.id).eq('user_id', session.user.id)
      : await supabase.from('place_item_votes').upsert({ item_id: it.id, user_id: session.user.id, vote: v });
    if (error) return notify(error.message);
    setMyVotes((m) => { const n = { ...m }; if (undo) delete n[it.id]; else n[it.id] = v; return n; });
    // Mirror the server's tally so the row updates without another details view
    onItems(items.map((x) => {
      if (x.id !== it.id) return x;
      const prev = myVotes[it.id];
      const c = x.confirm_count - (prev === 1 ? 1 : 0) + (!undo && v === 1 ? 1 : 0);
      const ch = x.changed_count - (prev === -1 ? 1 : 0) + (!undo && v === -1 ? 1 : 0);
      return { ...x, confirm_count: c, changed_count: ch, last_confirmed_at: !undo && v === 1 ? new Date().toISOString() : x.last_confirmed_at };
    }));
    if (!undo) notify(v === 1 ? `Thanks. Marked ${it.name} as still right.` : `Thanks. Marked ${it.name} as changed.`);
  };

  const edit = (it: PlaceItem) => setDraft({
    id: it.id, name: it.name, section: it.section, price: it.price_cents == null ? '' : (it.price_cents / 100).toFixed(2),
    unit: it.price_unit ?? (place.kind === 'restaurant' ? 'plate' : 'each'), available: it.available, description: it.description ?? '',
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const cents = parsePrice(draft.price);
    if (Number.isNaN(cents)) return notify('Enter the price as a number, like 8.99');
    setSaving(true);
    const { data, error } = await supabase.rpc('upsert_place_item', {
      p_place: place.id, p_name: draft.name, p_section: draft.section, p_description: draft.description || null,
      p_price_cents: cents, p_price_unit: cents == null ? null : draft.unit || null, p_available: draft.available, p_id: draft.id,
    });
    setSaving(false);
    if (error) return notify(error.message);
    if (data?.error) return notify(ERRORS[data.error] ?? data.error);
    const saved = { ...(data.item as PlaceItem), mine: draft.id ? items.find((i) => i.id === draft.id)?.mine ?? false : true };
    const rest = items.filter((i) => i.id !== saved.id);
    onItems([...rest, saved].sort((a, b) => a.section.localeCompare(b.section) || a.name.toLowerCase().localeCompare(b.name.toLowerCase())));
    setMyVotes((m) => { const n = { ...m }; delete n[saved.id]; return n; });
    notify(draft.id ? `Updated ${saved.name}` : `Added ${saved.name}`);
    setDraft(null);
  };

  const remove = async (it: PlaceItem) => {
    setSaving(true);
    const { data, error } = await supabase.rpc('remove_place_item', { p_id: it.id });
    setSaving(false);
    if (error) return notify(error.message);
    if (data?.error) return notify(ERRORS[data.error] ?? data.error);
    onItems(items.filter((i) => i.id !== it.id));
    notify(`Removed ${it.name}`);
    setDraft(null);
  };

  const editing = draft?.id ? items.find((i) => i.id === draft.id) ?? null : null;

  return (
    <section className="items" aria-labelledby={`${uid}-h`}>
      <div className="items-head">
        <h3 id={`${uid}-h`}>{title}</h3>
        {items.length > 0 && lastChecked && <span className="items-sub">{items.length} {items.length === 1 ? 'item' : 'items'}, last checked {ago(lastChecked)}</span>}
      </div>
      {fromSite > 0 && (
        <p className="items-src">
          {fromSite === items.length ? 'From' : `${fromSite} of these come from`} <a href={sourceUrl ?? menuUrl ?? website ?? '#'} target="_blank" rel="noreferrer">their website</a>. Prices in store can differ.
        </p>
      )}

      {items.length === 0 && !draft && (
        <p className="items-empty">
          {menuUrl
            ? <><a href={menuUrl} target="_blank" rel="noreferrer">{isMarket ? 'See what they sell on their website' : 'See their menu on their website'}</a>. Been here lately? Add {isMarket ? 'what you bought and what it cost' : 'a dish and its price'} so others can see it here.</>
            : <>{isMarket ? 'No products listed yet. Shopped here lately? Add what they sell and what it cost.' : 'No menu yet. Eaten here lately? Add a dish and its price.'}
              {website && <> You can also check <a href={website} target="_blank" rel="noreferrer">their website</a>.</>}</>}
        </p>
      )}

      {items.length > SHOW_FIRST && (
        <label className="items-filter">
          <IconSearch width={16} height={16} />
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${items.length} ${isMarket ? 'products' : 'dishes'}`} aria-label={`Search the ${title.toLowerCase()}`} />
        </label>
      )}

      {groups.map(([section, list]) => (
        <div key={section} className="item-group">
          {(groups.length > 1 || section !== 'Other') && <h4>{section}</h4>}
          <ul>
            {list.map((it) => {
              const price = formatPrice(it.price_cents, it.price_unit);
              const stale = isStale(it);
              return (
                <li key={it.id} className={`item ${it.available ? '' : 'out'}`}>
                  <div className="item-main">
                    <span className="item-name">{it.name}</span>
                    {it.description && <span className="item-desc">{it.description}</span>}
                    <span className={`item-meta ${stale ? 'stale' : ''}`}>
                      {!it.available && <span className="item-out">{outLabel}. </span>}
                      {it.source === 'website'
                        ? `From their website, checked ${ago(it.last_confirmed_at)}`
                        : stale ? `Not checked since ${ago(it.last_confirmed_at)}` : `Checked ${ago(it.last_confirmed_at)}`}
                      {it.changed_count > 0 && `, ${it.changed_count} ${it.changed_count === 1 ? 'person says' : 'people say'} it changed`}
                    </span>
                  </div>
                  <div className="item-side">
                    {price ? <span className="item-price">{price}</span> : <span className="item-noprice">No price yet</span>}
                    <span className="item-acts">
                      <button className={`mini ${myVotes[it.id] === 1 ? 'on' : ''}`} onClick={() => vote(it, 1)} aria-pressed={myVotes[it.id] === 1}
                        aria-label={`${it.name} is still right`} title="Still right">
                        <IconThumbUp width={15} height={15} />{it.confirm_count > 0 && <span>{it.confirm_count}</span>}
                      </button>
                      <button className="mini" onClick={() => (session ? edit(it) : notify('Sign in to update items'))} aria-label={`Update ${it.name}`} title="Update">
                        <IconPencil width={15} height={15} />
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {!needle && !showAll && visible.length > SHOW_FIRST && (
        <button className="linkish items-more" onClick={() => setShowAll(true)}>Show all {visible.length} {isMarket ? 'products' : 'dishes'}</button>
      )}
      {needle && visible.length === 0 && <p className="items-empty">Nothing on this list matches "{filter}".</p>}

      {draft ? (
        <form className="item-form" onSubmit={save}>
          <h4>{draft.id ? `Update ${editing?.name ?? 'item'}` : isMarket ? 'Add a product' : 'Add a dish'}</h4>
          <label className="field">Name
            <input required maxLength={80} value={draft.name} list={`${uid}-names`} autoComplete="off"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={isMarket ? 'Egusi seeds' : 'Jollof rice'} />
          </label>
          <datalist id={`${uid}-names`}>{COMMON_ITEMS[place.kind].map((n) => <option key={n} value={n} />)}</datalist>
          <div className="item-form-row">
            <label className="field">Price
              <span className="price-input"><span aria-hidden>$</span>
                <input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="8.99" aria-describedby={`${uid}-ph`} />
              </span>
            </label>
            <label className="field">Per
              <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
          <small id={`${uid}-ph`} className="field-hint">Leave blank if you don't know it.</small>
          <label className="field">Section
            <input maxLength={40} value={draft.section} list={`${uid}-sections`} autoComplete="off"
              onChange={(e) => setDraft({ ...draft, section: e.target.value })} placeholder={SECTIONS[place.kind][0]} />
          </label>
          <datalist id={`${uid}-sections`}>{SECTIONS[place.kind].map((n) => <option key={n} value={n} />)}</datalist>
          <label className="field">Notes <span className="optional">optional</span>
            <input maxLength={200} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={isMarket ? 'Brand, size or where it is in the store' : 'Comes with plantain, spicy, weekends only'} />
          </label>
          <label className="switch"><input type="checkbox" checked={draft.available} onChange={(e) => setDraft({ ...draft, available: e.target.checked })} /><span aria-hidden />
            {isMarket ? 'In stock when I was there' : 'On the menu now'}
          </label>
          <div className="item-form-actions">
            <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save update' : 'Add to list'}</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
          {editing && (
            <div className="item-form-extra">
              {editing.mine
                ? <button type="button" className="linkish danger" onClick={() => remove(editing)} disabled={saving}>Delete this item</button>
                : <button type="button" className="linkish" onClick={() => { vote(editing, -1); setDraft(null); }}>It changed, but I don't know the new details</button>}
            </div>
          )}
        </form>
      ) : (
        <button className="btn add-item" onClick={() => (session ? setDraft(blank(place.kind)) : notify('Sign in to add items'))}>
          <IconPlus width={18} height={18} />{isMarket ? 'Add a product' : 'Add a dish'}
        </button>
      )}
    </section>
  );
}
