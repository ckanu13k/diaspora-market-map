export type PlaceKind = 'market' | 'restaurant';
export type PlaceStatus = 'active' | 'possibly_closed' | 'closed' | 'removed';
export type Verification = 'listed' | 'community' | 'verified';

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  origins: string[];
  regions: string[];
  city: string | null;
  state: string;
  lat: number;
  lng: number;
  status: PlaceStatus;
  verification: Verification;
  verified_at: string | null;
  featured: boolean;
  confirm_count: number;
  last_confirmed_at: string | null;
  source: 'osm' | 'community' | 'owner' | 'admin';
  osm_id: string | null;
  updated_at: string;
}

export interface Details {
  street: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  instagram: string | null;
  facebook: string | null;
  description: string | null;
  services: string[];
  verification_note: string | null;
  updated_at: string;
}

export interface DetailsResult {
  details?: Details;
  premium?: boolean;
  used?: number;
  quota?: number | null;
  error?: 'auth_required' | 'quota_exceeded';
}

export interface Account {
  plan: 'free' | 'premium';
  plan_interval: string | null;
  plan_expires_at: string | null;
  is_admin: boolean;
  has_billing: boolean;
  used_today: number;
  quota: number;
}

export interface Report {
  id: string;
  place_id: string | null;
  user_id: string;
  kind: 'closed' | 'moved' | 'wrong_info' | 'new_place' | 'other';
  message: string | null;
  payload: Record<string, unknown>;
  status: 'open' | 'resolved' | 'rejected';
  created_at: string;
}

export const PLACE_COLUMNS =
  'id,name,kind,origins,regions,city,state,lat,lng,status,verification,verified_at,featured,confirm_count,last_confirmed_at,source,osm_id,updated_at';
