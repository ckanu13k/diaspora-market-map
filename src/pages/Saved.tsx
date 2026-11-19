import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { originLabel } from '../lib/taxonomy';
import { Badge } from '../components/Badge';
import { IconBasket, IconBowl } from '../components/Icons';

export default function Saved() {
  const { session, account, favorites, places } = useStore();
  if (!session) return <div className="page narrow"><h1>Saved places</h1><p>Sign in and go Premium to save places across devices.</p><Link className="btn primary" to="/account">Sign in</Link></div>;
  const saved = places.filter((p) => favorites.has(p.id));
  return (
    <div className="page">
      <h1>Saved places</h1>
      {account?.plan !== 'premium' && !account?.is_admin && <p className="lede">Saving places is part of Premium. <Link to="/pricing">See Premium</Link></p>}
      {!saved.length && <p className="muted">Nothing saved yet. Open any place and tap Save.</p>}
      <ul className="results">
        {saved.map((p) => (
          <li key={p.id}>
            <Link className="result" to={`/place/${p.id}`}>
              <span className={`kind-mark ${p.kind}`} aria-hidden>{p.kind === 'market' ? <IconBasket width={16} height={16} /> : <IconBowl width={16} height={16} />}</span>
              <span className="r-main"><strong>{p.name}</strong><span className="r-sub">{p.city ? `${p.city}, ` : ''}{p.state}</span><span className="r-badges"><Badge place={p} quiet /></span></span>
              <span className="r-flags">{p.origins.map(originLabel).join(', ')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
