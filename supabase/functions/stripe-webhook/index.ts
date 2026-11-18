// Stripe → Supabase: keeps profiles.plan / plan_expires_at in sync with the subscription.
// Deployed with verify_jwt = false (Stripe can't send a Supabase JWT); authenticity comes
// from the Stripe signature instead.
import Stripe from 'npm:stripe@17';
import { admin, stripe } from '../_shared/util.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();
const ACTIVE = new Set(['active', 'trialing', 'past_due']); // past_due keeps access during Stripe's retry window

async function syncSubscription(sub: Stripe.Subscription) {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  // current_period_end moved from the subscription to the item in newer API versions
  const periodEnd = (item as unknown as { current_period_end?: number }).current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const active = ACTIVE.has(sub.status);

  const update = {
    plan: active ? 'premium' : 'free',
    plan_interval: item?.price?.recurring?.interval ?? null,
    plan_expires_at: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };

  const { data } = await admin.from('profiles').update(update).eq('stripe_customer_id', customer).select('id');
  if (!data?.length && sub.metadata?.supabase_user_id) {
    await admin.from('profiles').update({ ...update, stripe_customer_id: customer }).eq('id', sub.metadata.supabase_user_id);
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`Bad signature: ${(e as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          if (s.client_reference_id && s.customer) {
            await admin.from('profiles').update({ stripe_customer_id: s.customer as string }).eq('id', s.client_reference_id);
          }
          await syncSubscription(sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
    }
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response('Handler error', { status: 500 });
  }
});
