import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

export const supabase: SupabaseClient = configured
  ? createClient(url!, key!, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
  : (null as unknown as SupabaseClient);

/** Where Supabase auth emails and Stripe should send people back to (this deployment's root). */
export const appRoot = () => `${window.location.origin}${import.meta.env.BASE_URL}`;

export const PRICE_MONTHLY = (import.meta.env.VITE_PRICE_MONTHLY_LABEL as string) || '$4.99/mo';
export const PRICE_YEARLY = (import.meta.env.VITE_PRICE_YEARLY_LABEL as string) || '$39/yr';
