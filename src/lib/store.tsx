import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';
import type { Account, Place } from './types';
import { loadPlaces } from './data';

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
  userLoc: LatLng | null;
  locating: boolean;
  requestLocation: () => Promise<LatLng | null>;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

// Old builds cached the whole map in localStorage (3.6 MB, near Safari's quota). Clear it once.
try { localStorage.removeItem('dmm.places.v1'); localStorage.removeItem('dmm.places.v2'); } catch { /* private mode */ }

export interface LatLng { lat: number; lng: number }
const LOC_KEY = 'dmm.loc';
const readLoc = (): LatLng | null => {
  try { const v = sessionStorage.getItem(LOC_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [userLoc, setUserLoc] = useState<LatLng | null>(readLoc);
  const [locating, setLocating] = useState(false);
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
      const { places: data } = await loadPlaces();
      setPlaces(data);
      setPlacesError(null);
    } catch (e) {
      setPlacesError((e as Error).message);
    } finally {
      setPlacesLoading(false);
    }
  }, []);

  const requestLocation = useCallback(() => new Promise<LatLng | null>((resolve) => {
    if (!('geolocation' in navigator)) { notify('Location isn\'t available on this device'); return resolve(null); }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(loc);
        try { sessionStorage.setItem(LOC_KEY, JSON.stringify(loc)); } catch { /* ignore */ }
        setLocating(false);
        resolve(loc);
      },
      () => { setLocating(false); notify('Allow location access to see places near you'); resolve(null); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }), [notify]);

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
    () => ({ places, placesLoading, placesError, reloadPlaces, patchPlace, session, account, refreshAccount, favorites, toggleFavorite, toast, notify, userLoc, locating, requestLocation }),
    [places, placesLoading, placesError, reloadPlaces, patchPlace, session, account, refreshAccount, favorites, toggleFavorite, toast, notify, userLoc, locating, requestLocation],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
