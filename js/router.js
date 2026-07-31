/* ============================================================
   WealthForge AI — history router
   HTML5 history routing (/dashboard, /holdings/:type, …) with:
     - Router.go(path)      push + render
     - Router.replace(path) replace + render
     - Router.path()        current normalized path
   Legacy #/x deep links redirect to /x so old bookmarks keep
   working. Internal <a href="/x"> clicks are intercepted.
   Vercel serves index.html for every route (see vercel.json).
   ============================================================ */

const Router = (() => {
  let onChange = null;

  function normalize(p) {
    if (!p) return '/dashboard';
    if (p.startsWith('#')) p = p.slice(1);
    if (!p.startsWith('/')) p = '/' + p;
    // trim trailing slash (except root)
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p === '/' || p === '/index.html' ? '/dashboard' : p;
  }

  function path() { return normalize(location.pathname); }

  function dispatch() { if (onChange) onChange(); }

  function go(p) {
    p = normalize(p);
    try {
      if (p !== normalize(location.pathname)) history.pushState({}, '', p);
    } catch (e) { /* file:// or sandboxed context — render anyway */ }
    dispatch();
  }

  function replace(p) {
    p = normalize(p);
    try { history.replaceState({}, '', p); } catch (e) { /* ignore */ }
    dispatch();
  }

  // Redirect legacy hash routes (#/x → /x) without adding a history entry
  function migrateLegacyHash() {
    if (location.hash && location.hash.startsWith('#/')) {
      try { history.replaceState({}, '', location.hash.slice(1) + location.search); } catch (e) { /* ignore */ }
    }
  }

  function init(cb) {
    onChange = cb;
    migrateLegacyHash();
    window.addEventListener('popstate', dispatch);
    // someone may still set a #/x hash (old links inside cached pages)
    window.addEventListener('hashchange', () => {
      if (location.hash.startsWith('#/')) { migrateLegacyHash(); dispatch(); }
    });
    // intercept internal link clicks so <a href="/x"> stays a real,
    // shareable link but navigates client-side
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a || a.target || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#/')) { e.preventDefault(); go(href.slice(1)); return; }
      if (href.startsWith('/') && !href.startsWith('//')) { e.preventDefault(); go(href); }
    });
  }

  return { init, go, replace, path, normalize };
})();

if (typeof globalThis !== 'undefined') globalThis.Router = Router;
