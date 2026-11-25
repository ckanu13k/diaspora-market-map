import type { PlaceKind } from './types';

export interface PlaceItem {
  id: string;
  section: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  price_unit: string | null;
  available: boolean;
  source: 'community' | 'owner' | 'admin';
  updated_at: string;
  last_confirmed_at: string;
  confirm_count: number;
  changed_count: number;
  mine: boolean;
}

/** Section names offered when adding an item. People can type their own. */
export const SECTIONS: Record<PlaceKind, string[]> = {
  restaurant: ['Mains', 'Soups & stews', 'Rice dishes', 'Grills & suya', 'Swallow', 'Sides', 'Snacks & pastries', 'Drinks', 'Desserts', 'Specials'],
  market: ['Grains & flours', 'Soup ingredients', 'Spices & seasonings', 'Fresh produce', 'Frozen meat & fish', 'Dried & smoked fish', 'Oils & sauces', 'Snacks & sweets', 'Drinks', 'Beauty & household'],
};

/** Common names, offered as typing suggestions so the same thing gets the same spelling. */
export const COMMON_ITEMS: Record<PlaceKind, string[]> = {
  restaurant: [
    'Jollof rice', 'Fried rice', 'Egusi soup', 'Ogbono soup', 'Efo riro', 'Okra soup', 'Pepper soup', 'Banga soup',
    'Pounded yam', 'Fufu', 'Eba', 'Amala', 'Suya', 'Asun', 'Moi moi', 'Puff puff', 'Meat pie', 'Chin chin',
    'Waakye', 'Kelewele', 'Banku and tilapia', 'Kenkey', 'Light soup', 'Red red',
    'Thieboudienne', 'Yassa chicken', 'Mafe', 'Attiéké', 'Alloco',
    'Injera', 'Doro wat', 'Tibs', 'Kitfo', 'Shiro', 'Sambusa',
    'Nyama choma', 'Ugali', 'Pilau', 'Chapati', 'Bobotie', 'Bunny chow',
    'Jerk chicken', 'Curry goat', 'Oxtail', 'Ackee and saltfish', 'Rice and peas', 'Escovitch fish', 'Beef patty',
    'Doubles', 'Roti', 'Pelau', 'Callaloo', 'Bake and shark', 'Griot', 'Diri ak djon djon', 'Pikliz', 'Cou-cou and flying fish',
    'Fried plantain', 'Festival', 'Sorrel', 'Ginger beer', 'Malta', 'Zobo', 'Chapman',
  ],
  market: [
    'Egusi seeds', 'Ogbono', 'Garri (white)', 'Garri (yellow)', 'Pounded yam flour', 'Yam (tuber)', 'Elubo (yam flour)', 'Semovita',
    'Plantain', 'Palm oil', 'Crayfish', 'Stockfish', 'Dried fish', 'Smoked catfish', 'Locust beans (iru)', 'Bitter leaf', 'Ugu leaves',
    'Scotch bonnet peppers', 'Uziza', 'Ehuru', 'Suya spice (yaji)', 'Maggi cubes', 'Knorr cubes', 'Honey beans', 'Ofada rice',
    'Fufu flour', 'Banku mix', 'Kenkey', 'Shito', 'Shea butter', 'Black soap', 'Kola nut', 'Bitter kola', 'Tiger nuts',
    'Teff flour', 'Injera', 'Berbere', 'Mitmita', 'Niter kibbeh', 'Ugali flour (maize meal)',
    'Ackee (canned)', 'Saltfish', 'Callaloo (canned)', 'Jerk seasoning', 'Hard dough bread', 'Coco bread', 'Scotch bonnet sauce',
    'Green seasoning', 'Sorrel (dried)', 'Ginger beer', 'Malta', 'Cassava', 'Dasheen', 'Breadfruit', 'Goat meat', 'Oxtail', 'Cow foot',
  ],
};

export const UNITS = ['each', 'lb', 'kg', 'oz', 'bag', 'pack', 'bottle', 'can', 'bunch', 'plate', 'bowl', 'piece', 'dozen'];

export const formatPrice = (cents: number | null, unit: string | null) => {
  if (cents == null) return null;
  const amount = cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
  return unit && unit !== 'each' && unit !== 'plate' && unit !== 'bowl' ? `${amount}/${unit}` : amount;
};

/** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago" */
export const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
};

/** An item counts as "fresh" if someone checked it in the last 60 days. */
export const isStale = (it: PlaceItem) => Date.now() - new Date(it.last_confirmed_at).getTime() > 60 * 86_400_000;

/** Turn "$8.99", "8.99", "8" into cents; blank → null; anything else → NaN. */
export const parsePrice = (s: string) => {
  const t = s.replace(/[$,\s]/g, '');
  if (!t) return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
};
