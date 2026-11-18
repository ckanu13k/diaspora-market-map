// POST → { url } (Stripe Billing Portal: cancel, change card, switch monthly/yearly)
import { admin, APP_URL, cors, getUser, json, stripe } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = await getUser(req);
    if (!user) return json({ error: 'Sign in first' }, 401);
    const { data } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (!data?.stripe_customer_id) return json({ error: 'No billing account yet' }, 400);
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${APP_URL}#/account`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
