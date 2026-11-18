// POST { interval: 'month' | 'year' } → { url } (Stripe Checkout for the Premium subscription)
import { admin, APP_URL, cors, getUser, json, stripe } from '../_shared/util.ts';

const PRICES: Record<string, string | undefined> = {
  month: Deno.env.get('STRIPE_PRICE_MONTHLY'),
  year: Deno.env.get('STRIPE_PRICE_YEARLY'),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = await getUser(req);
    if (!user) return json({ error: 'Sign in first' }, 401);

    const { interval = 'month' } = await req.json().catch(() => ({}));
    const price = PRICES[interval];
    if (!price) return json({ error: 'Unknown plan' }, 400);

    const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    let customer = profile?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripe.customers.create({ email: user.email, metadata: { supabase_user_id: user.id } });
      customer = c.id;
      await admin.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: { metadata: { supabase_user_id: user.id } },
      success_url: `${APP_URL}#/account?checkout=success`,
      cancel_url: `${APP_URL}#/pricing?checkout=cancelled`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
