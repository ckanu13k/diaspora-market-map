import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase';
import { StoreProvider, useStore } from './lib/store';
import Explore from './pages/Explore';
import Account from './pages/Account';
import Pricing from './pages/Pricing';
import Saved from './pages/Saved';
import Suggest from './pages/Suggest';
import Admin from './pages/Admin';

function Shell() {
  const { account, toast } = useStore();
  const premium = account?.plan === 'premium';
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={30} height={30} />
          <span>Diaspora<b>Market</b>Map</span>
        </NavLink>
        <nav className="topnav">
          <NavLink to="/" end>Map</NavLink>
          <NavLink to="/saved">Saved</NavLink>
          <NavLink to="/suggest">Add a place</NavLink>
          {!premium && <NavLink to="/pricing" className="gold-link">Premium</NavLink>}
          <NavLink to="/account">{account ? (premium ? '★ Account' : 'Account') : 'Sign in'}</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Explore />} />
          <Route path="/place/:id" element={<Explore />} />
          <Route path="/account" element={<Account />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/suggest" element={<Suggest />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Explore />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end><span>🗺️</span>Map</NavLink>
        <NavLink to="/saved"><span>♡</span>Saved</NavLink>
        <NavLink to="/suggest"><span>＋</span>Add</NavLink>
        <NavLink to={premium ? '/account' : '/pricing'}><span>★</span>{premium ? 'Premium' : 'Upgrade'}</NavLink>
        <NavLink to="/account"><span>👤</span>{account ? 'Me' : 'Sign in'}</NavLink>
      </nav>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="card narrow" style={{ margin: '10vh auto' }}>
      <h1>Almost there</h1>
      <p>This build has no Supabase connection yet. Add the <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> repository secrets, then re-run the <em>Deploy to GitHub Pages</em> workflow. The README walks through it step by step.</p>
    </div>
  );
}

export default function App() {
  if (!configured) return <SetupNeeded />;
  return (
    <StoreProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </StoreProvider>
  );
}
