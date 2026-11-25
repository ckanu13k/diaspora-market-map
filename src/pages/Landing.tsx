// State, city and cuisine pages (/us/texas/, /us/texas/houston/, /us/texas/houston/nigerian/, /cuisine/nigerian/).
// Search engines get a pre-built copy of each (scripts/seo/build-pages.mjs); here they open the map with those filters.
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import Explore from './Explore';
import { useStore } from '../lib/store';
import { ORIGINS, US_STATES } from '../lib/taxonomy';
import { topCities } from '../lib/insights';
import { slugify } from '../../shared/slug.js';

export default function Landing() {
  const { state: stateSlug, city: citySlug, cuisine: cuisineSlug } = useParams();
  const { places } = useStore();

  const view = useMemo(() => {
    const st = stateSlug ? Object.entries(US_STATES).find(([, name]) => slugify(name) === stateSlug) : null;
    const origin = cuisineSlug ? ORIGINS.find((o) => slugify(o.key) === cuisineSlug) : null;
    const city = st && citySlug ? topCities(places.filter((p) => p.state === st[0]), 5000).find((c) => slugify(c.city) === citySlug) : null;
    const q = new URLSearchParams();
    if (st && !city) q.set('state', st[0]);
    if (city) q.set('city', city.key);
    if (origin) q.set('origin', `origin:${origin.key}`);
    const food = origin ? origin.label.replace(' (general)', '') : 'African and Caribbean';
    // Before the listings load, name the city from its address (houston → Houston)
    const cityGuess = !city && st && citySlug ? citySlug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : null;
    const where = city ? `${city.city}, ${city.state}` : cityGuess ? `${cityGuess}, ${st![0]}` : st ? st[1] : 'the US';
    return { preset: `?${q}`, heading: `${food} markets and restaurants in ${where}` };
  }, [stateSlug, citySlug, cuisineSlug, places]);

  useEffect(() => { document.title = `${view.heading} | Diaspora Market Map`; }, [view.heading]);
  return <Explore preset={view.preset} heading={view.heading} />;
}
