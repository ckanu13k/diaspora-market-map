import { lazy, Suspense } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { configured } from './lib/supabase';
import { StoreProvider, useStore } from './lib/store';
import { BrandMark, IconCompass, IconHeart, IconMap, IconUser } from './components/Icons';
import Discover from './pages/Discover';

// Everything except the home screen loads on demand; the map library (~300 KB gzipped) only when a map is shown.
const Explore = lazy(() => import('./pages/Explore'));
const Account = lazy(() => import('./pages/Account'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Saved = lazy(() => import('./pages/Saved'));
const Suggest = lazy(() => import('./pages/Suggest'));
const Admin = lazy(() => import('./pages/Admin'));
const Landing = lazy(() => import('./pages/Landing'));
const Prices = lazy(() => import('./pages/Prices'));
const Compare = lazy(() => import('./pages/Compare'));
const Claim = lazy(() => import('./pages/Claim'));
const OwnerEdit = lazy(() => import('./pages/OwnerEdit'));

function Loading() {
  return <div className="route-loading" role="status"><span className="spinner" aria-hidden />Loading…</div>;
}

function Shell() {
  const { account, toast } = useStore();
  const { pathname } = useLocation();
  const premium = account?.plan === 'premium';
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Diaspora Market Map, home">
          <BrandMark />
          <span className="wordmark">Diaspora <span>Market Map</span></span>
        </NavLink>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/" end>Discover</NavLink>
          <NavLink to="/map">Map</NavLink>
          <NavLink to="/prices">Compare prices</NavLink>
          <NavLink to="/saved">Saved</NavLink>
          {!premium && <NavLink to="/pricing">Premium</NavLink>}
          <NavLink to="/account" className="nav-account">{account ? 'Account' : 'Sign in'}</NavLink>
        </nav>
      </header>
      <main className="main" id="main">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Discover />} />
            <Route path="/map" element={<Explore />} />
            <Route path="/place/:id" element={<Explore />} />
            <Route path="/us/:state" element={<Landing />} />
            <Route path="/us/:state/:city" element={<Landing />} />
            <Route path="/us/:state/:city/:cuisine" element={<Landing />} />
            <Route path="/cuisine/:cuisine" element={<Landing />} />
            <Route path="/prices" element={<Prices />} />
            <Route path="/groceries/:key" element={<Compare kind="market" />} />
            <Route path="/dishes/:key" element={<Compare kind="restaurant" />} />
            <Route path="/claim/:id" element={<Claim />} />
            <Route path="/owner/:id" element={<OwnerEdit />} />
            <Route path="/account" element={<Account />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/suggest" element={<Suggest />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Discover />} />
          </Routes>
        </Suspense>
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end><IconCompass />Discover</NavLink>
        <NavLink to="/map" className={({ isActive }) => (isActive || /^\/(place|us|cuisine)\//.test(pathname) ? 'active' : '')}><IconMap />Map</NavLink>
        <NavLink to="/saved"><IconHeart />Saved</NavLink>
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
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </StoreProvider>
  );
}
