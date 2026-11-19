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
| Listings | Overture Maps places (weekly GitHub Action → `data/` → Supabase pg_cron import) | Free |

## How "verified" works

| Badge | Meaning |
|---|---|
| **Listed** | Imported from Overture Maps business data, not yet confirmed |
| **Community confirmed** | 3+ signed-in users tapped "Still open" within 90 days |
| **Verified** | You (admin) checked it: a call, a visit, or the owner. Records the date and a note |
| **May be closed** | 2+ users reported it closed, or it dropped out of the latest Overture release |

Imports never delete anything. Places you edit or verify are **locked**, so imports can't overwrite your curation. A "Still open" confirmation revives a flagged place.

## Tiers

- **Free (no account):** full map, search, filters, badges.
- **Free account:** 5 full detail views/day (address, phone, hours, website, directions). Can confirm places, report problems, and suggest new places.
- **Premium:** unlimited details plus saved places. Price labels come from repo variables; the real prices are whatever you create in Stripe.

The paywall is enforced **in the database**. `place_details` has no public read policy, and the only way in is `get_place_details()`, which checks the plan and counts daily views server-side. Hiding things in the UI isn't the security layer.

---

## Setup status

**Done:** Supabase project `isvunzeeanjvczcowses` (schema, security policies, and functions applied; auth Site URL and redirect set), GitHub Pages enabled, and the public Supabase URL and publishable key in `.env.production`.

### Remaining: GitHub repo secrets (Settings → Secrets and variables → Actions)

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens → Generate new token. |
| `SUPABASE_PROJECT_REF` | `isvunzeeanjvczcowses` |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys (`sk_test_…` first) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint `https://isvunzeeanjvczcowses.supabase.co/functions/v1/stripe-webhook` with events `checkout.session.completed` and `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` → signing secret `whsec_…` |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | Stripe product "Premium" → its two recurring `price_…` IDs |

Optional variables: `PRICE_MONTHLY_LABEL`, `PRICE_YEARLY_LABEL` (shown on the pricing page).

Then run **"Deploy Supabase payment functions"** once the Stripe secrets are in. Sign in once and make yourself admin in the Supabase SQL Editor:
```sql
update profiles set is_admin = true where email = 'you@example.com';
```

**Database changes:** paste new files from `supabase/migrations/` into the Supabase SQL Editor and run them.

**Email:** Supabase's built-in email sender is rate-limited to a few emails per hour and its templates are locked. Before launch, add a custom SMTP sender (Authentication → Emails → SMTP Settings; Resend's free tier works). Then add `{{ .Token }}` to the "Magic link or OTP" template so phone users can type a code.

## How listings stay current
1. **`.github/workflows/overture.yml`** runs weekly with no secrets. DuckDB reads the latest [Overture Maps](https://overturemaps.org) places release from public S3, keeps US places with an African/Caribbean cuisine category or name keyword (`shared/taxonomy.json`), and commits `data/manifest.json` + `data/places/<ST>.json`. It commits only when the data changed.
2. **`supabase/functions/ingest-places`** runs every 10 minutes via pg_cron (`supabase/cron.sql`). When the manifest names a new release, it imports state by state, then flags places that dropped out of the release as "may be closed".

Overture places data is CDLA-Permissive-2.0 / Apache-2.0, with no ODbL share-alike, so charging for Premium access is fine. Attribution is shown in the app.

## Local development
```bash
npm install
cp .env.example .env.local     # fill in Supabase URL + anon key
npm run dev                    # http://localhost:5173/diaspora-market-map/
npm test                       # runs the real migration on in-process Postgres + ingestion tests
pip install duckdb && python scripts/overture/extract.py /tmp/raw.jsonl && node scripts/overture/build.mjs /tmp/raw.jsonl
```

## Project map
```
shared/taxonomy.json          countries/cuisines and name keywords (drives filters AND the import)
supabase/migrations/          schema, RLS, paywall RPC, ingestion + admin functions
supabase/functions/           create-checkout, customer-portal, stripe-webhook (Deno)
scripts/overture/             extract.py (DuckDB/S3) + build.mjs (classify, split by state)
data/                         published listings the database imports
src/                          React app (pages/, components/, lib/)
tests/                        db.test.mjs (PGlite), overture.test.mjs
.github/workflows/            Pages deploy, Supabase payment functions, weekly Overture refresh
```

**Coverage tuning:** Hispanic Caribbean (Cuban, Puerto Rican, Dominican) and North African cuisines are switched off by default so they don't swamp the map. Flip `enabled` in `shared/taxonomy.json` to include them.
