import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase';
import { StoreProvider, useStore } from './lib/store';
import { BrandMark, IconHeart, IconMap, IconPlus, IconStar, IconUser } from './components/Icons';
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
        <NavLink to="/" className="brand" aria-label="Diaspora Market Map, home">
          <BrandMark />
          <span className="wordmark">Diaspora <span>Market Map</span></span>
        </NavLink>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/" end>Map</NavLink>
          <NavLink to="/saved">Saved</NavLink>
          <NavLink to="/suggest">Add a place</NavLink>
          {!premium && <NavLink to="/pricing">Premium</NavLink>}
          <NavLink to="/account" className="nav-account">{account ? 'Account' : 'Sign in'}</NavLink>
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
        <NavLink to="/" end><IconMap />Map</NavLink>
        <NavLink to="/saved"><IconHeart />Saved</NavLink>
        <NavLink to="/suggest"><IconPlus />Add</NavLink>
        <NavLink to={premium ? '/account' : '/pricing'}><IconStar />Premium</NavLink>
        <NavLink to="/account"><IconUser />{account ? 'Account' : 'Sign in'}</NavLink>
      </nav>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="page narrow" style={{ marginTop: '10vh' }}>
      <h1>Almost there</h1>
      <p>This build has no database connection yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.production</code>, then re-run the deploy workflow.</p>
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
