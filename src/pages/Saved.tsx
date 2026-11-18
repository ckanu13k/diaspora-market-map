import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { originLabel } from '../lib/taxonomy';
import { Badge } from '../components/Badge';

export default function Saved() {
  const { session, account, favorites, places } = useStore();
  if (!session) return <div className="card narrow"><h1>Saved places</h1><p>Sign in and go Premium to save places across devices.</p><Link className="btn primary" to="/account">Sign in</Link></div>;
  const saved = places.filter((p) => favorites.has(p.id));
  return (
    <div className="card">
      <h1>Saved places</h1>
      {account?.plan !== 'premium' && !account?.is_admin && <p className="muted">Saving is a Premium feature. <Link to="/pricing">See Premium</Link></p>}
      {!saved.length && <p className="muted">Nothing saved yet. Tap ♡ Save on any place.</p>}
      <ul className="results">
        {saved.map((p) => (
          <li key={p.id}>
            <Link className="result" to={`/place/${p.id}`}>
              <span className={`dot ${p.kind}`} aria-hidden />
              <span className="r-main"><strong>{p.name}</strong><span className="muted small">{p.city ? `${p.city}, ` : ''}{p.state} · {p.origins.map(originLabel).join(', ')}</span></span>
              <span className="r-badges"><Badge place={p} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
