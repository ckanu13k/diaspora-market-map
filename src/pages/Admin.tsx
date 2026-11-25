import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { originLabel, ORIGINS } from '../lib/taxonomy';
import type { Details, Place, PlaceStatus, Report } from '../lib/types';
import { ago, formatPrice } from '../lib/items';

type Tab = 'reports' | 'new' | 'disputed' | 'items' | 'places';

export default function Admin() {
  const { account, places, reloadPlaces, notify } = useStore();
  const [tab, setTab] = useState<Tab>('reports');
  const [reports, setReports] = useState<Report[]>([]);
  const [editing, setEditing] = useState<Place | null>(null);

  const [itemQueue, setItemQueue] = useState<ItemQueue>({ flagged: [], recent: [] });
  const loadItems = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_item_queue');
    if (error) notify(error.message); else setItemQueue(data as ItemQueue);
  }, [notify]);
  useEffect(() => { if (account?.is_admin) loadItems(); }, [account?.is_admin, loadItems]);
  const setHidden = async (id: string, hidden: boolean) => {
    const { error } = await supabase.rpc('admin_set_item_hidden', { p_id: id, p_hidden: hidden });
    if (error) return notify(error.message);
    notify(hidden ? 'Item hidden' : 'Item restored');
    loadItems();
  };

  const loadReports = useCallback(async () => {
    const { data, error } = await supabase.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(500);
    if (error) notify(error.message); else setReports(data as Report[]);
  }, [notify]);
  useEffect(() => { if (account?.is_admin) loadReports(); }, [account?.is_admin, loadReports]);

  const stats = useMemo(() => {
    const s = { total: places.length, verified: 0, community: 0, possibly_closed: 0, markets: 0, disputed: 0 };
    for (const p of places) {
      if (p.inaccurate_votes > 0) s.disputed++;
      if (p.verification === 'verified') s.verified++;
      if (p.verification === 'community') s.community++;
      if (p.status === 'possibly_closed') s.possibly_closed++;
      if (p.kind === 'market') s.markets++;
    }
    return s;
  }, [places]);

  if (!account?.is_admin) return <div className="page narrow"><h1>Admin</h1><p>This page is for the site owner only.</p><Link to="/map">Back to the map</Link></div>;

  const resolve = async (id: string, status: 'resolved' | 'rejected') => {
    const { error } = await supabase.from('reports').update({ status, resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) return notify(error.message);
    setReports((r) => r.filter((x) => x.id !== id));
  };

  const disputed = places.filter((p) => p.inaccurate_votes > 0)
    .sort((a, b) => b.inaccurate_votes - a.inaccurate_votes || a.accurate_votes - b.accurate_votes);
  const review = (p: Place) => { setEditing(p); setTab('places'); };
  const fixes = reports.filter((r) => r.kind !== 'new_place');
  const suggestions = reports.filter((r) => r.kind === 'new_place');

  return (
    <div className="page wide">
      <h1>Admin console</h1>
      <div className="stats">
        <div><b>{stats.total.toLocaleString()}</b>places</div>
        <div><b>{stats.markets.toLocaleString()}</b>markets</div>
        <div><b>{stats.verified}</b>verified</div>
        <div><b>{stats.community}</b>community</div>
        <div><b>{stats.possibly_closed}</b>may be closed</div>
        <div><b>{stats.disputed}</b>with disputed details</div>
      </div>
      <div className="seg">
        <button className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>Fix reports ({fixes.length})</button>
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>New places ({suggestions.length})</button>
        <button className={tab === 'disputed' ? 'on' : ''} onClick={() => setTab('disputed')}>Disputed details ({disputed.length})</button>
        <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>Menus and products ({itemQueue.flagged.length})</button>
        <button className={tab === 'places' ? 'on' : ''} onClick={() => { setEditing(null); setTab('places'); }}>Edit and verify</button>
      </div>

      {tab === 'reports' && (
        <ul className="admin-list">
          {!fixes.length && <li className="muted">No open reports.</li>}
          {fixes.map((r) => {
            const p = places.find((x) => x.id === r.place_id);
            return (
              <li key={r.id}>
                <div><strong>{r.kind.replace('_', ' ')}</strong> · {p ? <Link to={`/place/${p.id}`}>{p.name}</Link> : 'unknown place'} {p && <span className="muted">({p.city ?? ''} {p.state})</span>}</div>
                {r.message && <p>{r.message}</p>}
                <p className="muted tiny">{new Date(r.created_at).toLocaleString()}</p>
                <div className="actions">
                  {p && r.kind === 'closed' && <button className="btn" onClick={async () => { await supabase.rpc('admin_set_status', { p_place: p.id, p_status: 'closed' }); await resolve(r.id, 'resolved'); reloadPlaces(); }}>Mark closed</button>}
                  <button className="btn primary" onClick={() => resolve(r.id, 'resolved')}>Resolved</button>
                  <button className="btn ghost" onClick={() => resolve(r.id, 'rejected')}>Reject</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'new' && (
        <ul className="admin-list">
          {!suggestions.length && <li className="muted">No suggestions waiting.</li>}
          {suggestions.map((r) => <Suggestion key={r.id} report={r} onDone={() => { setReports((x) => x.filter((y) => y.id !== r.id)); reloadPlaces(); }} onReject={() => resolve(r.id, 'rejected')} />)}
        </ul>
      )}

      {tab === 'disputed' && (
        <ul className="admin-list">
          {!disputed.length && <li className="muted">No one has flagged details as wrong.</li>}
          {disputed.slice(0, 200).map((p) => (
            <li key={p.id} className="disputed-row">
              <div>
                <strong>{p.name}</strong> <span className="muted">{p.city ? `${p.city}, ` : ''}{p.state}</span>
                <p className="muted small">{p.inaccurate_votes} say wrong, {p.accurate_votes} say correct. Check open reports for what they said.</p>
              </div>
              <div className="actions">
                <Link className="btn" to={`/place/${p.id}`}>View on map</Link>
                <button className="btn primary" onClick={() => review(p)}>Review and fix</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {tab === 'items' && (
        <>
          <h2 className="admin-h2">People say these changed</h2>
          <ul className="admin-list">
            {!itemQueue.flagged.length && <li className="muted">No menu or product items are flagged.</li>}
            {itemQueue.flagged.map((it) => (
              <li key={it.id} className="disputed-row">
                <div>
                  <strong>{it.name}</strong> {formatPrice(it.price_cents, it.price_unit) && <span>{formatPrice(it.price_cents, it.price_unit)}</span>}
                  <p className="muted small">{it.place_name}, {it.city ? `${it.city}, ` : ''}{it.state}. {it.changed_count} say changed, {it.confirm_count} say still right.{it.hidden && ` Hidden (${it.hidden_reason === 'votes' ? 'by votes' : 'by you'}).`} Updated {ago(it.updated_at)}.</p>
                </div>
                <div className="actions">
                  <Link className="btn" to={`/place/${it.place_id}`}>View place</Link>
                  {it.hidden
                    ? <button className="btn primary" onClick={() => setHidden(it.id, false)}>Restore</button>
                    : <button className="btn" onClick={() => setHidden(it.id, true)}>Hide</button>}
                </div>
              </li>
            ))}
          </ul>
          <h2 className="admin-h2">Recent changes</h2>
          <ul className="admin-list">
            {!itemQueue.recent.length && <li className="muted">No one has added items yet.</li>}
            {itemQueue.recent.map((e) => (
              <li key={e.id}>
                <strong>{e.name}</strong> at <Link to={`/place/${e.place_id}`}>{e.place_name}</Link>
                <span className="muted small"> {e.action === 'add' ? 'added' : e.action === 'update' ? 'updated' : e.action === 'remove' ? 'deleted' : e.action === 'hide' ? 'hidden' : 'restored'}
                  {e.action === 'update' && e.before_price !== e.after_price && ` (price ${formatPrice(e.before_price, null) ?? 'none'} to ${formatPrice(e.after_price, null) ?? 'none'})`}
                  {' '}by {e.user_email ?? 'a deleted account'}, {ago(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'places' && <PlaceEditor key={editing?.id ?? 'search'} initial={editing} />}
    </div>
  );
}

type ItemQueue = {
  flagged: { id: string; place_id: string; place_name: string; city: string | null; state: string; name: string; price_cents: number | null;
    price_unit: string | null; changed_count: number; confirm_count: number; hidden: boolean; hidden_reason: string | null; updated_at: string }[];
  recent: { id: number; action: string; created_at: string; place_id: string; place_name: string; user_email: string | null; name: string;
    before_price: number | null; after_price: number | null }[];
};

function Suggestion({ report, onDone, onReject }: { report: Report; onDone: () => void; onReject: () => void }) {
  const { notify } = useStore();
  const p = report.payload as Record<string, string | number | string[] | null>;
  const [coords, setCoords] = useState(p.lat != null ? `${p.lat}, ${p.lng}` : '');
  const approve = async () => {
    const [lat, lng] = coords.split(',').map((s) => Number(s.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return notify('Paste coordinates as "lat, lng" (right-click the spot in Google Maps to copy them)');
    const { error } = await supabase.rpc('admin_approve_new_place', { p_report: report.id, p_lat: lat, p_lng: lng });
    if (error) return notify(error.message);
    notify('Added to the map as verified');
    onDone();
  };
  const q = encodeURIComponent([p.name, p.street, p.city, p.state].filter(Boolean).join(' '));
  return (
    <li>
      <strong>{String(p.name)}</strong> · {String(p.kind)} · {[p.street, p.city, p.state, p.postcode].filter(Boolean).join(', ')}
      <p className="muted small">{(p.origins as string[] | null)?.map(originLabel).join(', ')} {p.phone && `· ${p.phone}`} {p.website && `· ${p.website}`}</p>
      {p.description && <p>{String(p.description)}</p>}
      <div className="filter-row">
        <input placeholder="lat, lng" value={coords} onChange={(e) => setCoords(e.target.value)} />
        <a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer">Look it up</a>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={approve}>Approve & verify</button>
        <button className="btn ghost" onClick={onReject}>Reject</button>
      </div>
    </li>
  );
}

const DETAIL_FIELDS: (keyof Details)[] = ['street', 'postcode', 'phone', 'website', 'opening_hours', 'instagram', 'facebook', 'description', 'verification_note'];

function PlaceEditor({ initial = null }: { initial?: Place | null }) {
  const { places, patchPlace, notify } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Place | null>(null);
  const [d, setD] = useState<Partial<Details>>({});
  const [meta, setMeta] = useState<Partial<Place>>({});

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n.length < 2 ? [] : places.filter((p) => `${p.name} ${p.city ?? ''} ${p.state}`.toLowerCase().includes(n)).slice(0, 25);
  }, [q, places]);

  const open = async (p: Place) => {
    setSel(p);
    setMeta({ name: p.name, kind: p.kind, city: p.city, origins: p.origins, featured: p.featured, status: p.status });
    const { data } = await supabase.from('place_details').select('*').eq('place_id', p.id).maybeSingle();
    setD((data as Details) ?? {});
  };

  useEffect(() => { if (initial) open(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async (verify: boolean) => {
    if (!sel) return;
    const origins = meta.origins ?? [];
    const placePatch = { ...meta, regions: [...new Set(origins.map((o) => ORIGINS.find((x) => x.key === o)?.region).filter(Boolean))] as string[] };
    const { status, ...rest } = placePatch;
    const e1 = (await supabase.from('places').update(rest).eq('id', sel.id)).error;
    if (e1) return notify(e1.message);
    if (status && status !== sel.status) await supabase.rpc('admin_set_status', { p_place: sel.id, p_status: status as PlaceStatus });
    const detailRow = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, (d[k] as string | null | undefined)?.toString().trim() || null]));
    const e2 = (await supabase.from('place_details').upsert({ place_id: sel.id, ...detailRow, locked: true })).error;
    if (e2) return notify(e2.message);
    if (verify) {
      const e3 = (await supabase.rpc('admin_verify_place', { p_place: sel.id, p_note: d.verification_note || null })).error;
      if (e3) return notify(e3.message);
    }
    const { data } = await supabase.from('places').select('*').eq('id', sel.id).single();
    if (data) { patchPlace(sel.id, data as Place); setSel(data as Place); }
    notify(verify ? 'Saved and verified' : 'Saved');
  };

  return (
    <div className="editor">
      <input className="search" placeholder="Find a place by name or city…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!sel && <ul className="admin-list">{matches.map((p) => <li key={p.id}><button className="linkish" onClick={() => open(p)}>{p.name}</button> <span className="muted">{p.city} {p.state} · {p.verification} · {p.status}</span></li>)}</ul>}
      {sel && (
        <div className="stack">
          <p><button className="linkish" onClick={() => setSel(null)}>← back to search</button> · <Link to={`/place/${sel.id}`}>view on map</Link></p>
          <label className="field">Name<input value={meta.name ?? ''} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
          <div className="filter-row">
            <label className="field">Kind<select value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value as Place['kind'] })}><option value="restaurant">Restaurant</option><option value="market">Market</option></select></label>
            <label className="field">City<input value={meta.city ?? ''} onChange={(e) => setMeta({ ...meta, city: e.target.value || null })} /></label>
            <label className="field">Status<select value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value as PlaceStatus })}>
              <option value="active">Active</option><option value="possibly_closed">Possibly closed</option><option value="closed">Closed</option><option value="removed">Removed (hide)</option>
            </select></label>
          </div>
          <div className="field">Origins
            <div className="chips wrap">{ORIGINS.map((o) => (
              <button type="button" key={o.key} className={`chip ${meta.origins?.includes(o.key) ? 'on' : ''}`}
                onClick={() => setMeta({ ...meta, origins: meta.origins?.includes(o.key) ? meta.origins.filter((x) => x !== o.key) : [...(meta.origins ?? []), o.key] })}>{o.flag} {o.label}</button>
            ))}</div>
          </div>
          <label className="toggles"><input type="checkbox" checked={!!meta.featured} onChange={(e) => setMeta({ ...meta, featured: e.target.checked })} /> Featured (paid listing / editor's pick)</label>
          {DETAIL_FIELDS.map((k) => (
            <label key={k} className="field">{k.replace('_', ' ')}
              {k === 'description' || k === 'verification_note'
                ? <textarea rows={2} value={(d[k] as string) ?? ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} placeholder={k === 'verification_note' ? 'e.g. Called and confirmed hours, 11/18/2026' : ''} />
                : <input value={(d[k] as string) ?? ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} />}
            </label>
          ))}
          <p className="muted tiny">Saving locks this place, so listing imports won't overwrite your edits. "Save and mark verified" also resets the thumbs up/down count, because older ratings no longer apply.</p>
          <div className="actions">
            <button className="btn primary" onClick={() => save(true)}>Save and mark verified</button>
            <button className="btn" onClick={() => save(false)}>Save only</button>
          </div>
        </div>
      )}
    </div>
  );
}
