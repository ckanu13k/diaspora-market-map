# Diaspora Market Map

African & Caribbean markets and restaurants across all 50 states + DC. Pins on a map, verified details, community confirmations, and a paid Premium tier.

**Live:** `https://ckanu13k.github.io/diaspora-market-map/` · installs on phones from the browser ("Add to Home Screen").

| Layer | Choice | Cost |
|---|---|---|
| Web + mobile | React + Vite, installable PWA | Free |
| Hosting / URL | GitHub Pages via GitHub Actions | Free |
| Map | MapLibre GL + OpenFreeMap tiles (no API key) | Free |
| Database, auth | Supabase (Postgres + Row Level Security, email-code login) | Free tier |
| Payments | Stripe Checkout + Billing Portal via Supabase Edge Functions | 2.9% + 30¢ |
| Listings | Weekly GitHub Action pulling OpenStreetMap (Overpass API) | Free |

## How "verified" works

| Badge | Meaning |
|---|---|
| **Listed** | Imported from OpenStreetMap, not yet confirmed |
| **Community confirmed** | 3+ signed-in users tapped "Still open" within 90 days |
| **Verified** | You (admin) checked it: a call, a visit, or the owner. Records the date and a note |
| **May be closed** | 2+ users reported it closed, or it disappeared from OpenStreetMap for 2 weekly runs |

The weekly import never deletes anything. Places you edit or verify are **locked**, so OSM can't overwrite your curation. A "Still open" confirmation revives a flagged place.

## Tiers

- **Free (no account):** full map, search, filters, badges.
- **Free account:** 5 full detail views/day (address, phone, hours, website, directions). Can confirm places, report problems, and suggest new places.
- **Premium:** unlimited details plus saved places. Price labels come from repo variables; the real prices are whatever you create in Stripe.

The paywall is enforced **in the database**. `place_details` has no public read policy, and the only way in is `get_place_details()`, which checks the plan and counts daily views server-side. Hiding things in the UI isn't the security layer.

---

## One-time setup (~30 min)

### 1. Supabase
1. Create a project at supabase.com and note the **Project ref** (in the URL) and the **DB password**.
2. **Settings → API:** copy the `Project URL`, the `anon` public key, and the `service_role` key.
3. **Authentication → URL Configuration:** set Site URL to `https://ckanu13k.github.io/diaspora-market-map/` and add the same URL under Redirect URLs.
4. **Authentication → Email Templates → Magic Link:** add `Your code: {{ .Token }}` to the body. Users can then type the code inside the installed app, which is more reliable than links on phones.
5. **Account → Access Tokens:** create a personal access token for GitHub Actions.

### 2. Stripe
1. **Product catalog → Add product** "Diaspora Market Map Premium" with two recurring prices (e.g. $4.99/month and $39/year). Copy both `price_…` IDs.
2. **Developers → Webhooks → Add endpoint:** `https://<PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`. Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret (`whsec_…`).
3. **Settings → Billing → Customer portal:** turn it on (lets users cancel or switch plans).
4. Use **test mode** keys first. Test card: `4242 4242 4242 4242`.

### 3. GitHub repo secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (used only by the import job) |
| `SUPABASE_ACCESS_TOKEN` | personal access token |
| `SUPABASE_PROJECT_REF` | project ref |
| `SUPABASE_DB_PASSWORD` | DB password |
| `STRIPE_SECRET_KEY` | `sk_test_…` / `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `STRIPE_PRICE_MONTHLY` | `price_…` |
| `STRIPE_PRICE_YEARLY` | `price_…` |

Optional **variables** (same page, Variables tab): `PRICE_MONTHLY_LABEL` = `$4.99/mo`, `PRICE_YEARLY_LABEL` = `$39/yr`.

### 4. Turn it on
1. **Settings → Pages → Source: GitHub Actions.**
2. **Actions → "Deploy Supabase" → Run workflow.** This creates the tables and security rules and deploys the payment functions.
3. **Actions → "Deploy to GitHub Pages" → Run workflow.** The site goes live.
4. **Actions → "Refresh listings from OpenStreetMap" → Run workflow.** This fills the map (about 30–60 min for all states) and then repeats every Monday.
5. Sign in on the site once, then make yourself admin in Supabase **SQL Editor**:
   ```sql
   update profiles set is_admin = true where email = 'you@example.com';
   ```
   **Account → Admin console** now shows reports, new-place suggestions, and the edit/verify tool.

---

## Local development
```bash
npm install
cp .env.example .env.local     # fill in Supabase URL + anon key
npm run dev                    # http://localhost:5173/diaspora-market-map/
npm test                       # runs the real migration on in-process Postgres + ingestion tests
npm run ingest:dry             # preview a Texas import without writing (needs open internet)
```

## Project map
```
shared/taxonomy.json          countries/cuisines and name keywords (drives filters AND the import)
supabase/migrations/          schema, RLS, paywall RPC, ingestion + admin functions
supabase/functions/           create-checkout, customer-portal, stripe-webhook (Deno)
scripts/ingest-osm.mjs        Overpass → Supabase, per state, flags vanished places
src/                          React app (pages/, components/, lib/)
tests/                        db.test.mjs (PGlite), ingest.test.mjs
.github/workflows/            Pages deploy, Supabase deploy, weekly import
```

**Coverage tuning:** Hispanic Caribbean (Cuban, Puerto Rican, Dominican) and North African cuisines are switched off by default so they don't swamp the map. Flip `enabled` in `shared/taxonomy.json` to include them.

## Data licence
Listing data partly comes from © OpenStreetMap contributors under the ODbL. Attribution is shown in the app and on every OSM-sourced place. ODbL has share-alike terms for derivative databases. Before charging at scale, confirm how they apply to your model. The defensible paid value is your verification layer and the places you add yourself.
