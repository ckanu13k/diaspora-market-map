import { Link } from 'react-router-dom';
import { placePath } from '../../shared/slug.js';
import { useStore } from '../lib/store';
import { originLabel } from '../lib/taxonomy';
import { Badge, MenuSign } from '../components/Badge';
import { IconBasket, IconBowl } from '../components/Icons';

export default function Saved() {
  const { session, account, favorites, places } = useStore();
  if (!session) return <div className="page narrow"><h1>Saved places</h1><p>Sign in to save places on all your devices. Free accounts save up to 10.</p><Link className="btn primary" to="/account">Sign in</Link></div>;
  const saved = places.filter((p) => favorites.has(p.id));
  return (
    <div className="page">
      <h1>Saved places</h1>
      {account?.plan !== 'premium' && !account?.is_admin && <p className="lede">{saved.length} of {account?.saved_limit ?? 10} free saves used. <Link to="/pricing">Premium</Link> saves as many as you like.</p>}
      {!saved.length && <p className="muted">Nothing saved yet. Open any place and tap Save.</p>}
      <ul className="results">
        {saved.map((p) => (
          <li key={p.id}>
            <Link className="result" to={placePath(p)} state={{ backLabel: 'Saved places' }}>
              <span className={`kind-mark ${p.kind}`} aria-hidden>{p.kind === 'market' ? <IconBasket width={16} height={16} /> : <IconBowl width={16} height={16} />}</span>
              <span className="r-main"><span className="r-name"><strong>{p.name}</strong><MenuSign place={p} /></span><span className="r-sub">{p.city ? `${p.city}, ` : ''}{p.state}</span><span className="r-badges"><Badge place={p} quiet /></span></span>
              <span className="r-flags">{p.origins.map(originLabel).join(', ')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
