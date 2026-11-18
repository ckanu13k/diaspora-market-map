import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';
import { PLACE_COLUMNS, type Account, type Place } from './types';

interface Store {
  places: Place[];
  placesLoading: boolean;
  placesError: string | null;
  reloadPlaces: () => Promise<void>;
  patchPlace: (id: string, patch: Partial<Place>) => void;
  session: Session | null;
  account: Account | null;
  refreshAccount: () => Promise<void>;
  favorites: Set<string>;
  toggleFavorite: (placeId: string) => Promise<string | null>;
  toast: string | null;
  notify: (msg: string) => void;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

const CACHE_KEY = 'dmm.places.v1';
const PAGE = 1000;

function readCache(): Place[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw).places as Place[]) : null;
  } catch {
    return null;
  }
}
function writeCache(places: Place[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), places })); } catch { /* quota/private mode */ }
}

async function fetchAllPlaces(): Promise<Place[]> {
  const first = await supabase.from('places').select(PLACE_COLUMNS, { count: 'exact' }).neq('status', 'removed').order('id').range(0, PAGE - 1);
  if (first.error) throw first.error;
  const total = first.count ?? first.data.length;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
      supabase.from('places').select(PLACE_COLUMNS).neq('status', 'removed').order('id').range((i + 1) * PAGE, (i + 2) * PAGE - 1),
    ),
  );
  const out = [...(first.data as unknown as Place[])];
  for (const r of rest) {
    if (r.error) throw r.error;
    out.push(...(r.data as unknown as Place[]));
  }
  return out;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [places, setPlaces] = useState<Place[]>(() => readCache() ?? []);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  const reloadPlaces = useCallback(async () => {
    if (!configured) { setPlacesLoading(false); return; }
    setPlacesLoading(true);
    try {
      const data = await fetchAllPlaces();
      setPlaces(data);
      writeCache(data);
      setPlacesError(null);
    } catch (e) {
      setPlacesError((e as Error).message);
    } finally {
      setPlacesLoading(false);
    }
  }, []);

  const patchPlace = useCallback((id: string, patch: Partial<Place>) => {
    setPlaces((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!configured) return;
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { setAccount(null); setFavorites(new Set()); return; }
    const [{ data: acct }, { data: favs }] = await Promise.all([
      supabase.rpc('my_account'),
      supabase.from('favorites').select('place_id'),
    ]);
    setAccount((acct as Account) ?? null);
    setFavorites(new Set((favs ?? []).map((f: { place_id: string }) => f.place_id)));
  }, []);

  const toggleFavorite = useCallback(async (placeId: string) => {
    if (!session) return 'auth_required';
    if (favorites.has(placeId)) {
      const { error } = await supabase.from('favorites').delete().eq('place_id', placeId).eq('user_id', session.user.id);
      if (error) return error.message;
      setFavorites((f) => { const n = new Set(f); n.delete(placeId); return n; });
    } else {
      const { error } = await supabase.from('favorites').insert({ place_id: placeId, user_id: session.user.id });
      if (error) return error.code === '42501' ? 'premium_required' : error.message;
      setFavorites((f) => new Set(f).add(placeId));
    }
    return null;
  }, [session, favorites]);

  useEffect(() => {
    reloadPlaces();
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [reloadPlaces]);

  useEffect(() => { refreshAccount(); }, [session?.user.id, refreshAccount]);

  const value = useMemo(
    () => ({ places, placesLoading, placesError, reloadPlaces, patchPlace, session, account, refreshAccount, favorites, toggleFavorite, toast, notify }),
    [places, placesLoading, placesError, reloadPlaces, patchPlace, session, account, refreshAccount, favorites, toggleFavorite, toast, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
