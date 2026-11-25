-- 1. Contact details, menus and prices at each place are free for everyone (no sign-in, no daily limit).
--    Premium is now: comparing a product's price across stores, and unlimited saved places.
-- 2. Products: menu and shop items are matched to a shared catalog (shared/products.json) so the same
--    thing can be compared across places.
-- 3. Owner claims: an owner verifies by signing in with an email at the business's own web domain,
--    by putting a code on their website, or by an admin's review. Owners keep details and menus current.
-- 4. A public export the page builder uses to make one web page per place, city, cuisine and product.

-- ───────── owner claims table (used below)
create table if not exists public.place_claims (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references public.places (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'revoked')),
  method        text check (method in ('email_domain', 'website_code', 'admin')),
  code          text not null default ('dmm-' || substr(md5(gen_random_uuid()::text), 1, 16)),
  contact_name  text check (char_length(contact_name) <= 100),
  contact_phone text check (char_length(contact_phone) <= 40),
  role          text check (char_length(role) <= 60),
  message       text check (char_length(message) <= 1000),
  web_requests  bigint[],
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  note          text,
  unique (place_id, user_id)
);
alter table public.place_claims enable row level security;
create policy claims_read on public.place_claims for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.place_claims from anon, authenticated;
grant select on public.place_claims to authenticated;
grant all on public.place_claims to service_role;

create or replace function public.is_owner(p_place uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.place_claims where place_id = p_place and user_id = auth.uid() and status = 'verified')
$$;


-- ───────── 1. free details, saved places
create or replace function public.free_saved_limit() returns int language sql immutable as $$ select 10 $$;
create or replace function public.my_favorite_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.favorites where user_id = auth.uid()
$$;
drop policy if exists fav_insert on public.favorites;
create policy fav_insert on public.favorites for insert with check (
  user_id = auth.uid() and (public.is_premium() or public.is_admin() or public.my_favorite_count() < public.free_saved_limit()));

create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plan',            case when public.is_premium() then 'premium' else 'free' end,
    'plan_interval',   p.plan_interval,
    'plan_expires_at', p.plan_expires_at,
    'is_admin',        p.is_admin,
    'has_billing',     p.stripe_customer_id is not null,
    'saved',           (select count(*) from public.favorites f where f.user_id = p.id),
    'saved_limit',     public.free_saved_limit(),
    'owns',            coalesce((select jsonb_agg(c.place_id) from public.place_claims c where c.user_id = p.id and c.status = 'verified'), '[]'::jsonb),
    'used_today',      0,
    'quota',           0
  )
  from public.profiles p where p.id = auth.uid()
$$;

-- ───────── 2. products
create table if not exists public.product_catalog (
  kind    public.place_kind not null,
  key     text not null,
  label   text not null,
  pattern text not null,
  sort    int not null,
  primary key (kind, key)
);
truncate public.product_catalog;
insert into public.product_catalog (kind, key, label, pattern, sort) values
  ('market', 'bitter-kola', 'Bitter kola', '\mbitter ?kola\M', 10),
  ('market', 'kola-nut', 'Kola nut', '\mkola ?nuts?\M|\mobi abata\M', 11),
  ('market', 'plantain-chips', 'Plantain chips', '\mplantain (chips?|crisps?)\M', 12),
  ('market', 'pounded-yam-flour', 'Pounded yam flour', '\mpounded yam\M|\mpoundo\M|\miyan\M', 13),
  ('market', 'yam-flour', 'Yam flour (elubo)', '\melubo\M|\myam flour\M|\mamala\M', 14),
  ('market', 'plantain-flour', 'Plantain flour', '\mplantain flour\M', 15),
  ('market', 'cassava-flour', 'Cassava flour', '\mcassava flour\M|\mlafun\M', 16),
  ('market', 'fufu-flour', 'Fufu flour', '\mfufu\M', 17),
  ('market', 'garri', 'Garri', '\mgarr?i\M', 18),
  ('market', 'egusi', 'Egusi (melon seeds)', '\megusi\M', 19),
  ('market', 'ogbono', 'Ogbono', '\mogbono\M', 20),
  ('market', 'palm-oil', 'Palm oil', '\mpalm oil\M|\mred oil\M|\mzomi\M', 21),
  ('market', 'crayfish', 'Crayfish', '\mcray ?fish\M', 22),
  ('market', 'stockfish', 'Stockfish', '\mstock ?fish\M|\mokporoko\M', 23),
  ('market', 'smoked-fish', 'Smoked or dried fish', '\m(smoked|dried|dry) (cat ?fish|fish|mackerel|herring|tilapia|bonga)\M|\mbonga\M', 24),
  ('market', 'locust-beans', 'Locust beans (iru)', '\miru\M|\mlocust beans?\M|\mdawadawa\M|\mogiri\M', 25),
  ('market', 'bitter-leaf', 'Bitter leaf', '\mbitter ?leaf\M|\monugbu\M', 26),
  ('market', 'ugu', 'Ugu (pumpkin leaves)', '\mugu\M|\mpumpkin leaf\M|\mpumpkin leaves\M', 27),
  ('market', 'scotch-bonnet', 'Scotch bonnet peppers', '\mscotch ?bonnets?\M|\mhabaneros?\M|\mata rodo\M', 28),
  ('market', 'uziza', 'Uziza', '\muziza\M', 29),
  ('market', 'ehuru', 'Ehuru (calabash nutmeg)', '\mehuru\M|\mcalabash nutmeg\M|\mariwo\M', 30),
  ('market', 'suya-spice', 'Suya spice (yaji)', '\msuya\M|\myaji\M', 31),
  ('market', 'seasoning-cubes', 'Maggi / Knorr cubes', '\mmaggi\M|\mknorr\M|\mbouillon cubes?\M', 32),
  ('market', 'honey-beans', 'Honey beans (oloyin)', '\mhoney beans?\M|\moloyin\M', 33),
  ('market', 'black-eyed-peas', 'Black-eyed peas', '\mblack[ -]?eyed? (peas|beans)\M', 34),
  ('market', 'ofada-rice', 'Ofada rice', '\mofada\M', 35),
  ('market', 'semolina', 'Semovita / semolina', '\msemovita\M|\msemolina\M', 36),
  ('market', 'banku-mix', 'Banku mix', '\mbanku\M', 37),
  ('market', 'kenkey', 'Kenkey', '\mkenkey\M', 38),
  ('market', 'shito', 'Shito', '\mshito\M', 39),
  ('market', 'shea-butter', 'Shea butter', '\mshea butter\M', 40),
  ('market', 'black-soap', 'African black soap', '\mblack soap\M|\mose dudu\M|\malata samina\M', 41),
  ('market', 'tiger-nuts', 'Tiger nuts', '\mtiger ?nuts?\M', 42),
  ('market', 'teff-flour', 'Teff flour', '\mteff\M', 43),
  ('market', 'injera', 'Injera', '\minjera\M', 44),
  ('market', 'berbere', 'Berbere', '\mberbere\M', 45),
  ('market', 'mitmita', 'Mitmita', '\mmitmita\M', 46),
  ('market', 'niter-kibbeh', 'Niter kibbeh', '\mniter ?kibb?eh\M|\mkibe\M', 47),
  ('market', 'maize-meal', 'Maize meal (ugali)', '\mmaize meal\M|\mugali\M|\mmealie\M', 48),
  ('market', 'ackee', 'Ackee', '\mackee\M', 49),
  ('market', 'saltfish', 'Saltfish', '\msalt ?fish\M|\mbacalao\M|\mcod ?fish\M', 50),
  ('market', 'callaloo', 'Callaloo', '\mcallaloo\M', 51),
  ('market', 'jerk-seasoning', 'Jerk seasoning', '\mjerk (seasoning|marinade|sauce|rub|spice)\M', 52),
  ('market', 'hard-dough-bread', 'Hard dough bread', '\mhard ?dough\M|\mhardo\M', 53),
  ('market', 'coco-bread', 'Coco bread', '\mcoco bread\M', 54),
  ('market', 'sorrel', 'Sorrel / hibiscus (zobo)', '\msorrel\M|\mhibiscus\M|\mzobo\M|\mbissap\M', 55),
  ('market', 'ginger-beer', 'Ginger beer', '\mginger beer\M', 56),
  ('market', 'malta', 'Malta', '\mmalta\M', 57),
  ('market', 'cassava', 'Cassava (yuca)', '\mcassava\M|\myuca\M', 58),
  ('market', 'dasheen', 'Dasheen / taro', '\mdasheen\M|\mtaro\M|\meddoes?\M|\mcocoyams?\M', 59),
  ('market', 'breadfruit', 'Breadfruit', '\mbreadfruit\M', 60),
  ('market', 'plantain', 'Plantain', '\mplantains?\M', 61),
  ('market', 'yam', 'Yam', '\m(puna |african |white |ghana )?yams?\M', 62),
  ('market', 'goat-meat', 'Goat meat', '\mgoat\M', 63),
  ('market', 'oxtail', 'Oxtail', '\moxtails?\M', 64),
  ('market', 'cow-skin', 'Cow skin (ponmo)', '\mponmo\M|\mkpomo\M|\mcow ?skin\M', 65),
  ('market', 'cow-foot', 'Cow foot', '\mcow ?(foot|feet|leg)\M', 66),
  ('market', 'indomie', 'Indomie noodles', '\mindomie\M', 67),
  ('market', 'milo', 'Milo', '\mmilo\M', 68),
  ('market', 'evaporated-milk', 'Evaporated milk (Peak)', '\mpeak (milk|evaporated)\M|\mevaporated milk\M', 69),
  ('market', 'chin-chin', 'Chin chin', '\mchin ?-?chin\M', 70),
  ('restaurant', 'jerk-chicken', 'Jerk chicken', '\mjerk chicken\M', 10),
  ('restaurant', 'jerk-pork', 'Jerk pork', '\mjerk pork\M', 11),
  ('restaurant', 'curry-goat', 'Curry goat', '\mcurr(y|ied) goat\M|\mgoat curry\M', 12),
  ('restaurant', 'oxtail', 'Oxtail', '\moxtails?\M', 13),
  ('restaurant', 'ackee-saltfish', 'Ackee and saltfish', '\mackee\M', 14),
  ('restaurant', 'rice-and-peas', 'Rice and peas', '\mrice (and|&|n) peas\M', 15),
  ('restaurant', 'escovitch-fish', 'Escovitch fish', '\mescovitch\M|\mescoveitch\M', 16),
  ('restaurant', 'beef-patty', 'Jamaican patty', '\mpatt(y|ies)\M', 17),
  ('restaurant', 'doubles', 'Doubles', '\mdoubles\M', 18),
  ('restaurant', 'roti', 'Roti', '\mroti\M', 19),
  ('restaurant', 'pelau', 'Pelau', '\mpelau\M', 20),
  ('restaurant', 'bake-and-shark', 'Bake and shark', '\mbake (and|&|n) shark\M', 21),
  ('restaurant', 'griot', 'Griot', '\mgriot\M', 22),
  ('restaurant', 'djon-djon', 'Diri ak djon djon', '\mdjon ?djon\M', 23),
  ('restaurant', 'cou-cou', 'Cou-cou and flying fish', '\mcou ?-?cou\M', 24),
  ('restaurant', 'festival', 'Festival', '\mfestivals?\M', 25),
  ('restaurant', 'jollof-rice', 'Jollof rice', '\mjollof\M', 26),
  ('restaurant', 'fried-rice', 'Fried rice', '\mfried rice\M', 27),
  ('restaurant', 'egusi-soup', 'Egusi soup', '\megusi\M', 28),
  ('restaurant', 'ogbono-soup', 'Ogbono soup', '\mogbono\M', 29),
  ('restaurant', 'efo-riro', 'Efo riro', '\mefo\M', 30),
  ('restaurant', 'okra-soup', 'Okra soup', '\mokr[ao] soup\M', 31),
  ('restaurant', 'pepper-soup', 'Pepper soup', '\mpepper ?soup\M', 32),
  ('restaurant', 'banga-soup', 'Banga soup', '\mbanga\M', 33),
  ('restaurant', 'pounded-yam', 'Pounded yam', '\mpounded yam\M|\miyan\M', 34),
  ('restaurant', 'fufu', 'Fufu', '\mfufu\M', 35),
  ('restaurant', 'eba', 'Eba', '\meba\M|\mgarri\M', 36),
  ('restaurant', 'amala', 'Amala', '\mamala\M', 37),
  ('restaurant', 'suya', 'Suya', '\msuya\M', 38),
  ('restaurant', 'asun', 'Asun', '\masun\M', 39),
  ('restaurant', 'moi-moi', 'Moi moi', '\mmoi ?-?moi\M|\mmoin ?-?moin\M', 40),
  ('restaurant', 'puff-puff', 'Puff puff', '\mpuff ?-?puff\M', 41),
  ('restaurant', 'meat-pie', 'Meat pie', '\mmeat ?pies?\M', 42),
  ('restaurant', 'chin-chin', 'Chin chin', '\mchin ?-?chin\M', 43),
  ('restaurant', 'waakye', 'Waakye', '\mwaakye\M', 44),
  ('restaurant', 'kelewele', 'Kelewele', '\mkelewele\M', 45),
  ('restaurant', 'banku', 'Banku', '\mbanku\M', 46),
  ('restaurant', 'kenkey', 'Kenkey', '\mkenkey\M', 47),
  ('restaurant', 'red-red', 'Red red', '\mred ?-?red\M', 48),
  ('restaurant', 'thieboudienne', 'Thieboudienne', '\mthieb|\mceebu\M|\mthiebou', 49),
  ('restaurant', 'yassa', 'Yassa', '\myassa\M', 50),
  ('restaurant', 'mafe', 'Mafe (peanut stew)', '\mmaa?fe\M|\m(peanut|groundnut) (stew|soup)\M', 51),
  ('restaurant', 'attieke', 'Attiéké', '\matti[eé]k[eé]\M', 52),
  ('restaurant', 'alloco', 'Alloco', '\malloco\M', 53),
  ('restaurant', 'doro-wat', 'Doro wat', '\mdoro\M', 54),
  ('restaurant', 'tibs', 'Tibs', '\mtibs\M', 55),
  ('restaurant', 'kitfo', 'Kitfo', '\mkitfo\M', 56),
  ('restaurant', 'shiro', 'Shiro', '\mshiro\M', 57),
  ('restaurant', 'sambusa', 'Sambusa', '\msamb[ou]sas?\M|\msamosas?\M', 58),
  ('restaurant', 'nyama-choma', 'Nyama choma', '\mnyama ?choma\M', 59),
  ('restaurant', 'ugali', 'Ugali', '\mugali\M', 60),
  ('restaurant', 'pilau', 'Pilau', '\mpilau\M', 61),
  ('restaurant', 'chapati', 'Chapati', '\mchapati\M', 62),
  ('restaurant', 'bobotie', 'Bobotie', '\mbobotie\M', 63),
  ('restaurant', 'bunny-chow', 'Bunny chow', '\mbunny ?chow\M', 64),
  ('restaurant', 'callaloo', 'Callaloo', '\mcallaloo\M', 65),
  ('restaurant', 'fried-plantain', 'Fried plantain', '\mplantains?\M|\mdodo\M', 66),
  ('restaurant', 'sorrel-drink', 'Sorrel / zobo / bissap', '\msorrel\M|\mzobo\M|\mbissap\M|\mhibiscus\M', 67),
  ('restaurant', 'ginger-beer', 'Ginger beer', '\mginger beer\M', 68),
  ('restaurant', 'malta', 'Malta', '\mmalta\M', 69),
  ('restaurant', 'chapman', 'Chapman', '\mchapman\M', 70),
  ('restaurant', 'injera', 'Injera', '\minjera\M', 71);
alter table public.product_catalog enable row level security;
create policy product_catalog_read on public.product_catalog for select using (true);
grant select on public.product_catalog to anon, authenticated;

alter table public.place_items add column if not exists product_key text;
create index if not exists place_items_product_idx on public.place_items (product_key) where not hidden and product_key is not null;

create or replace function public.match_product(p_kind public.place_kind, p_name text) returns text
language sql stable set search_path = public as $$
  select c.key from public.product_catalog c where c.kind = p_kind and p_name ~* c.pattern order by c.sort limit 1
$$;
create or replace function public.set_item_product() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.product_key := public.match_product((select kind from public.places where id = new.place_id), new.name);
  return new;
end $$;
drop trigger if exists place_items_product on public.place_items;
create trigger place_items_product before insert or update of name on public.place_items
  for each row execute function public.set_item_product();
update public.place_items i set product_key = public.match_product(p.kind, i.name) from public.places p where p.id = i.place_id;

-- Weight in pounds from "4 lb", "(2kg)", "16 oz" in the unit or the name, for a price per pound
create or replace function public.item_pounds(p_name text, p_unit text) returns numeric
language plpgsql immutable as $$
declare m text[];
begin
  if lower(coalesce(p_unit, '')) in ('lb', 'lbs', 'pound') then return 1; end if;
  if lower(coalesce(p_unit, '')) = 'kg' then return 2.20462; end if;
  m := regexp_match(coalesce(p_unit, '') || ' ' || coalesce(p_name, ''), '(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kg|oz|g)\M', 'i');
  if m is null then return null; end if;
  return case lower(m[2]) when 'kg' then m[1]::numeric * 2.20462 when 'oz' then m[1]::numeric / 16
    when 'g' then m[1]::numeric / 453.592 else m[1]::numeric end;
end $$;

-- Every product with how many places carry it and the price range (public)
create or replace function public.product_overview(p_state text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'label', c.label, 'places', s.places,
           'min_cents', s.min_cents, 'max_cents', s.max_cents) order by s.places desc, c.label), '[]'::jsonb)
  from public.product_catalog c
  join lateral (
    select count(distinct i.place_id) places, min(i.price_cents) filter (where i.price_cents > 0) min_cents,
           max(i.price_cents) filter (where i.price_cents > 0) max_cents
    from public.place_items i join public.places p on p.id = i.place_id
    where i.product_key = c.key and p.kind = c.kind and not i.hidden and p.status in ('active', 'possibly_closed')
      and (p_state is null or p.state = upper(p_state))
  ) s on s.places > 0
$$;

-- Compare one product across places. Everyone sees which places carry it and the overall range;
-- Premium sees each place's price, cheapest first (per pound where the weight is known).
create or replace function public.compare_prices(p_kind public.place_kind, p_key text, p_lat float8 default null,
  p_lng float8 default null, p_state text default null, lim int default 150) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  prem boolean := public.is_premium() or public.is_admin();
  c    public.product_catalog;
  rows jsonb;
  rng  record;
begin
  select * into c from public.product_catalog where kind = p_kind and key = p_key;
  if c.key is null then return jsonb_build_object('error', 'not_found'); end if;
  select count(distinct i.place_id) places, min(i.price_cents) filter (where i.price_cents > 0) min_cents,
         max(i.price_cents) filter (where i.price_cents > 0) max_cents
    into rng
  from public.place_items i join public.places p on p.id = i.place_id
  where i.product_key = p_key and p.kind = p_kind and not i.hidden and p.status in ('active', 'possibly_closed')
    and (p_state is null or p.state = upper(p_state));

  select coalesce(jsonb_agg(x order by (x->>'sort_key')::numeric nulls last, (x->>'miles')::numeric nulls last), '[]'::jsonb) into rows
  from (
    select jsonb_build_object(
      'place_id', p.id, 'name', p.name, 'city', p.city, 'state', p.state, 'lat', p.lat, 'lng', p.lng,
      'item', i.name, 'available', i.available, 'checked', i.last_confirmed_at, 'source', i.source,
      'price_cents', case when prem then i.price_cents end,
      'price_unit',  case when prem then i.price_unit end,
      'per_lb_cents', case when prem and i.price_cents > 0 and public.item_pounds(i.name, i.price_unit) > 0
                           then round(i.price_cents / public.item_pounds(i.name, i.price_unit)) end,
      'miles', case when p_lat is not null then round((3958.8 * 2 * asin(sqrt(power(sin(radians(p.lat - p_lat) / 2), 2)
                 + cos(radians(p_lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - p_lng) / 2), 2))))::numeric, 1) end,
      -- Premium: cheapest first (per pound when known); everyone else: nearest first
      'sort_key', case when prem then coalesce(
                    case when i.price_cents > 0 and public.item_pounds(i.name, i.price_unit) > 0 then i.price_cents / public.item_pounds(i.name, i.price_unit) end,
                    i.price_cents::numeric) end
    ) x
    from (
      select distinct on (i.place_id) i.* from public.place_items i
      where i.product_key = p_key and not i.hidden
      -- each place's best deal: in stock first, then cheapest per pound (or per item when no weight)
      order by i.place_id, i.available desc,
        coalesce(case when i.price_cents > 0 and public.item_pounds(i.name, i.price_unit) > 0 then i.price_cents / public.item_pounds(i.name, i.price_unit) end,
                 i.price_cents::numeric) nulls last
    ) i
    join public.places p on p.id = i.place_id
    where p.kind = p_kind and p.status in ('active', 'possibly_closed') and (p_state is null or p.state = upper(p_state))
    order by case when p_lat is not null then power(p.lat - p_lat, 2) + power((p.lng - p_lng) * cos(radians(p_lat)), 2) end nulls last
    limit least(greatest(lim, 1), 500)
  ) q;

  return jsonb_build_object('product', jsonb_build_object('key', c.key, 'kind', c.kind, 'label', c.label),
    'places', rng.places, 'min_cents', rng.min_cents, 'max_cents', rng.max_cents, 'premium', prem, 'rows', rows);
end $$;

-- ───────── 3. owner claims
-- The site's registrable domain: www.shop.example.com → example.com
create or replace function public.site_domain(p_url text) returns text
language sql immutable as $$
  select nullif(array_to_string((string_to_array(h, '.'))[greatest(array_length(string_to_array(h, '.'), 1) - 1, 1):], '.'), '')
  from (select lower(regexp_replace(regexp_replace(coalesce(p_url, ''), '^[a-z]+://', '', 'i'), '[/:?#].*$', '')) h) s
$$;

create or replace function public.claim_place(p_place uuid, p_name text default null, p_phone text default null,
  p_role text default null, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  email text;
  site  text;
  st    text;
  cl    public.place_claims;
  free_mail constant text[] := array['gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com','outlook.com','live.com','msn.com',
    'icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','comcast.net','att.net','sbcglobal.net','verizon.net','gmx.com','mail.com','zoho.com'];
  hosted constant text[] := array['wixsite.com','wix.com','squarespace.com','weebly.com','wordpress.com','godaddysites.com','square.site',
    'facebook.com','instagram.com','linktr.ee','toasttab.com','doordash.com','ubereats.com','grubhub.com','yelp.com','google.com','business.site','shopify.com','myshopify.com','clover.com','chownow.com'];
begin
  if uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  if not exists (select 1 from public.places where id = p_place and status <> 'removed') then return jsonb_build_object('error', 'not_found'); end if;
  if (select count(*) from public.place_claims where user_id = uid and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  insert into public.place_claims (place_id, user_id, contact_name, contact_phone, role, message)
  values (p_place, uid, left(p_name, 100), left(p_phone, 40), left(p_role, 60), left(p_message, 1000))
  on conflict (place_id, user_id) do update set contact_name = excluded.contact_name, contact_phone = excluded.contact_phone,
    role = excluded.role, message = excluded.message,
    status = case when place_claims.status in ('rejected', 'revoked') then 'pending' else place_claims.status end
  returning * into cl;

  -- Instant: the signed-in email is at the business's own web domain (sign-in already proved the mailbox)
  select lower(u.email) into email from auth.users u where u.id = uid;
  select site_domain(d.website), d.website_status into site, st from public.place_details d where d.place_id = p_place;
  if cl.status = 'pending' and site is not null and email like '%@%'
     and split_part(email, '@', 2) = site and not (site = any (free_mail)) and not (site = any (hosted))
     and coalesce(st, 'ok') not in ('social', 'ordering_platform') then
    update public.place_claims set status = 'verified', method = 'email_domain', decided_at = now() where id = cl.id returning * into cl;
  end if;
  return jsonb_build_object('id', cl.id, 'status', cl.status, 'method', cl.method, 'code', cl.code, 'site', site,
    'site_ok', site is not null and not (site = any (hosted)));
end $$;

-- Website code: ask the database to fetch their home page and /diaspora-market-map.txt (pg_net) …
create or replace function public.start_website_check(p_claim uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cl public.place_claims; site text; r1 bigint; r2 bigint;
begin
  select * into cl from public.place_claims where id = p_claim and user_id = auth.uid();
  if cl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if cl.status <> 'pending' then return jsonb_build_object('status', cl.status); end if;
  select d.website into site from public.place_details d where d.place_id = cl.place_id;
  if site is null then return jsonb_build_object('error', 'no_website'); end if;
  site := regexp_replace(site, '^(https?://[^/?#]+).*$', '\1');
  r1 := net.http_get(url := site || '/', timeout_milliseconds := 10000);
  r2 := net.http_get(url := site || '/diaspora-market-map.txt', timeout_milliseconds := 10000);
  update public.place_claims set web_requests = array[r1, r2] where id = cl.id;
  return jsonb_build_object('started', true);
end $$;

-- … then look for the code in what came back
create or replace function public.finish_website_check(p_claim uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cl public.place_claims; found boolean; waiting int;
begin
  select * into cl from public.place_claims where id = p_claim and user_id = auth.uid();
  if cl.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if cl.status <> 'pending' or cl.web_requests is null then return jsonb_build_object('status', cl.status); end if;
  select count(*) into waiting from unnest(cl.web_requests) rid where not exists (select 1 from net._http_response r where r.id = rid);
  select exists (select 1 from net._http_response r where r.id = any (cl.web_requests) and r.status_code between 200 and 299
                 and position(cl.code in coalesce(r.content, '')) > 0) into found;
  if found then
    update public.place_claims set status = 'verified', method = 'website_code', decided_at = now() where id = cl.id;
    return jsonb_build_object('status', 'verified');
  end if;
  return jsonb_build_object('status', 'pending', 'waiting', waiting > 0);
end $$;

create or replace function public.admin_claims() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'method', c.method, 'created_at', c.created_at,
      'place_id', p.id, 'place_name', p.name, 'city', p.city, 'state', p.state, 'listed_phone', d.phone, 'website', d.website,
      'email', u.email, 'contact_name', c.contact_name, 'contact_phone', c.contact_phone, 'role', c.role, 'message', c.message)
      order by (c.status = 'pending') desc, c.created_at desc)
    from public.place_claims c join public.places p on p.id = c.place_id
    left join public.place_details d on d.place_id = c.place_id join auth.users u on u.id = c.user_id), '[]'::jsonb);
end $$;

create or replace function public.admin_decide_claim(p_claim uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.place_claims set status = case when p_approve then 'verified' else 'rejected' end,
    method = case when p_approve then coalesce(method, 'admin') else method end, decided_at = now(), note = p_note
  where id = p_claim;
end $$;

-- Owners (and admins) edit their place's details. Edited details are locked against the weekly import.
create or replace function public.owner_update_place(p_place uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare clean text;
begin
  if not (public.is_owner(p_place) or public.is_admin()) then return jsonb_build_object('error', 'forbidden'); end if;
  if p ? 'website' and coalesce(p->>'website', '') <> '' and (p->>'website') !~* '^https?://[^ ]+\.[a-z]{2,}' then
    return jsonb_build_object('error', 'bad_website');
  end if;
  insert into public.place_details as d (place_id) values (p_place) on conflict (place_id) do nothing;
  update public.place_details d set
    phone         = case when p ? 'phone'         then nullif(left(btrim(p->>'phone'), 40), '')          else d.phone end,
    website       = case when p ? 'website'       then nullif(left(btrim(p->>'website'), 300), '')       else d.website end,
    menu_url      = case when p ? 'menu_url'      then nullif(left(btrim(p->>'menu_url'), 300), '')      else d.menu_url end,
    opening_hours = case when p ? 'opening_hours' then nullif(left(btrim(p->>'opening_hours'), 300), '') else d.opening_hours end,
    description   = case when p ? 'description'   then nullif(left(btrim(p->>'description'), 600), '')   else d.description end,
    street        = case when p ? 'street'        then nullif(left(btrim(p->>'street'), 200), '')        else d.street end,
    postcode      = case when p ? 'postcode'      then nullif(left(btrim(p->>'postcode'), 10), '')       else d.postcode end,
    instagram     = case when p ? 'instagram'     then nullif(left(btrim(p->>'instagram'), 300), '')     else d.instagram end,
    facebook      = case when p ? 'facebook'      then nullif(left(btrim(p->>'facebook'), 300), '')      else d.facebook end,
    services      = case when p ? 'services'      then coalesce(array(select jsonb_array_elements_text(p->'services')), '{}') else d.services end,
    website_status = case when p ? 'website' then 'owner' else d.website_status end,
    locked = true, updated_at = now()
  where d.place_id = p_place;
  update public.places set status = 'active', status_reason = null where id = p_place and status = 'possibly_closed';
  return jsonb_build_object('ok', true);
end $$;

-- Item edits: owners' items are theirs (source 'owner'); the community can vote on them but not overwrite them
create or replace function public.upsert_place_item(
  p_place uuid, p_name text, p_section text default '', p_description text default null,
  p_price_cents int default null, p_price_unit text default null, p_available boolean default true,
  p_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  adm    boolean := public.is_admin();
  own    boolean := public.is_owner(p_place);
  edits  int;
  cur    public.place_items;
  res    public.place_items;
  nm     text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  sec    text := btrim(coalesce(p_section, ''));
  unit   text := nullif(lower(btrim(coalesce(p_price_unit, ''))), '');
  descr  text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  if not exists (select 1 from public.places where id = p_place and status <> 'removed') then
    return jsonb_build_object('error', 'not_found');
  end if;
  if char_length(nm) < 1 or char_length(nm) > 80 then return jsonb_build_object('error', 'bad_name'); end if;
  if not adm and not own then
    select count(*) into edits from public.place_item_edits where user_id = uid and created_at > now() - interval '1 day';
    if edits >= public.item_edit_limit() then return jsonb_build_object('error', 'rate_limited'); end if;
  end if;

  if p_id is not null then
    select * into cur from public.place_items where id = p_id and place_id = p_place;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
  else
    select * into cur from public.place_items
    where place_id = p_place and lower(btrim(name)) = lower(nm) and coalesce(lower(price_unit), '') = coalesce(unit, '');
  end if;

  if cur.id is not null and cur.source = 'owner' and not (adm or own) then
    return jsonb_build_object('error', 'owner_item');
  end if;

  if cur.id is null then
    insert into public.place_items (place_id, section, name, description, price_cents, price_unit, available,
                                    source, created_by, updated_by)
    values (p_place, sec, nm, descr, p_price_cents, unit, coalesce(p_available, true),
            case when own then 'owner' when adm then 'admin' else 'community' end, uid, uid)
    returning * into res;
    insert into public.place_item_edits (item_id, place_id, user_id, action, after)
    values (res.id, p_place, uid, 'add', to_jsonb(res));
  else
    update public.place_items set
      section = sec, name = nm, description = descr, price_cents = p_price_cents, price_unit = unit,
      available = coalesce(p_available, true), updated_by = uid, updated_at = now(), last_confirmed_at = now(),
      confirm_count = 0, changed_count = 0, hidden = false, hidden_reason = null,
      source = case when own then 'owner' when adm then 'admin' else 'community' end   -- a person's edit takes it over from the website copy
    where id = cur.id
    returning * into res;
    insert into public.place_item_edits (item_id, place_id, user_id, action, before, after)
    values (res.id, p_place, uid, 'update', to_jsonb(cur), to_jsonb(res));
  end if;

  perform public.refresh_place_item_summary(p_place);
  return jsonb_build_object('item', to_jsonb(res) - 'created_by' - 'updated_by');
exception when unique_violation then
  return jsonb_build_object('error', 'duplicate');
end $$;

create or replace function public.remove_place_item(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur public.place_items;
begin
  if uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  select * into cur from public.place_items where id = p_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not (public.is_admin() or public.is_owner(cur.place_id) or (cur.created_by = uid and cur.created_at > now() - interval '1 day')) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  delete from public.place_items where id = p_id;
  insert into public.place_item_edits (item_id, place_id, user_id, action, before)
  values (p_id, cur.place_id, uid, 'remove', to_jsonb(cur));
  perform public.refresh_place_item_summary(cur.place_id);
  return jsonb_build_object('ok', true);
end $$;

-- Details: free for everyone, with the menu, product matches and who owns the listing
create or replace function public.get_place_details(p_place uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  d     jsonb;
  items jsonb;
begin
  if uid is not null and not exists (select 1 from public.detail_views where user_id = uid and place_id = p_place and day = public.utc_today()) then
    insert into public.detail_views (user_id, place_id) values (uid, p_place) on conflict do nothing;   -- usage stats only
  end if;
  select to_jsonb(pd) - 'locked' - 'website_dropped' into d from public.place_details pd where pd.place_id = p_place;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'section', i.section, 'name', i.name, 'description', i.description,
           'price_cents', i.price_cents, 'price_unit', i.price_unit, 'available', i.available,
           'source', i.source, 'updated_at', i.updated_at, 'last_confirmed_at', i.last_confirmed_at,
           'confirm_count', i.confirm_count, 'changed_count', i.changed_count, 'product_key', i.product_key,
           'mine', uid is not null and i.created_by = uid and i.created_at > now() - interval '1 day')
         order by i.section, lower(i.name)), '[]'::jsonb)
    into items
  from public.place_items i where i.place_id = p_place and not i.hidden;
  return jsonb_build_object(
    'details', coalesce(d, '{}'::jsonb),
    'items', items,
    'premium', public.is_premium() or public.is_admin(),
    'owner', jsonb_build_object(
      'claimed', exists (select 1 from public.place_claims c where c.place_id = p_place and c.status = 'verified'),
      'you', uid is not null and public.is_owner(p_place),
      'pending', uid is not null and exists (select 1 from public.place_claims c where c.place_id = p_place and c.user_id = uid and c.status = 'pending'))
  );
end $$;

-- ───────── 4. public export for the page builder (everything here is shown free on the site anyway)
create or replace function public.export_public_places(p_after uuid default null, p_limit int default 500) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'id'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'name', p.name, 'kind', p.kind, 'origins', p.origins, 'city', p.city, 'state', p.state, 'lat', p.lat, 'lng', p.lng,
      'status', p.status, 'verification', p.verification, 'verified_at', p.verified_at, 'confirm_count', p.confirm_count,
      'updated_at', p.updated_at,
      'street', d.street, 'postcode', d.postcode, 'phone', d.phone, 'website', d.website, 'menu_url', d.menu_url,
      'opening_hours', d.opening_hours, 'description', d.description, 'services', d.services,
      'claimed', exists (select 1 from public.place_claims c where c.place_id = p.id and c.status = 'verified'),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'section', i.section, 'price_cents', i.price_cents,
                  'price_unit', i.price_unit, 'available', i.available, 'product_key', i.product_key) order by i.section, lower(i.name)), '[]'::jsonb)
                from (select * from public.place_items i where i.place_id = p.id and not i.hidden order by i.section, lower(i.name) limit 80) i)
    ) x
    from public.places p left join public.place_details d on d.place_id = p.id
    where p.status in ('active', 'possibly_closed') and (p_after is null or p.id > p_after)
    order by p.id
    limit least(greatest(p_limit, 1), 1000)
  ) q
$$;

grant execute on function public.get_place_details(uuid) to anon, authenticated;
grant execute on function public.export_public_places(uuid, int) to anon, authenticated;
grant execute on function public.product_overview(text) to anon, authenticated;
grant execute on function public.compare_prices(public.place_kind, text, float8, float8, text, int) to anon, authenticated;
revoke execute on function public.claim_place(uuid, text, text, text, text) from public, anon;
grant  execute on function public.claim_place(uuid, text, text, text, text) to authenticated;
revoke execute on function public.start_website_check(uuid) from public, anon;
revoke execute on function public.finish_website_check(uuid) from public, anon;
grant  execute on function public.start_website_check(uuid) to authenticated;
grant  execute on function public.finish_website_check(uuid) to authenticated;
revoke execute on function public.owner_update_place(uuid, jsonb) from public, anon;
grant  execute on function public.owner_update_place(uuid, jsonb) to authenticated;
revoke execute on function public.upsert_place_item(uuid, text, text, text, int, text, boolean, uuid) from public, anon;
grant  execute on function public.upsert_place_item(uuid, text, text, text, int, text, boolean, uuid) to authenticated;
revoke execute on function public.remove_place_item(uuid) from public, anon;
grant  execute on function public.remove_place_item(uuid) to authenticated;
revoke execute on function public.admin_claims() from public, anon;
grant  execute on function public.admin_claims() to authenticated;
revoke execute on function public.admin_decide_claim(uuid, boolean, text) from public, anon;
grant  execute on function public.admin_decide_claim(uuid, boolean, text) to authenticated;
