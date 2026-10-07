// zball.io's page runtime (served as /js/zb.mjs; lib/tsr.mjs writes what
// it reads). The engine typesets each page's documents — the static page
// is the first paint —, and a link to another page of the site is followed
// in place: the page fetched, its document typeset out of sight by the
// engine already running, then put in at once — no blank page between, no
// static page turning into the typeset one. What both pages share stays as
// it is: the header, a book's sidebar (data-zb-persist). A page that cannot
// be shown so is loaded the ordinary way.
//
// In a page: #zb-site {eng, fonts, js} (the engine's assets, the faces it
// measures with); #zb-shell, what a page shows; in it #zb-docs {main, docs:
// [{key, settings, inputs}]}, an article[data-zblang] and a
// script[data-zb-src] per document; head: style[data-zb-style], keyed.

const SITE_JSON = document.getElementById('zb-site')?.textContent ?? '{}';
const site = JSON.parse(SITE_JSON);
const LANG = 'zb-lang';  // the reader's choice of language
const TOC = 'zb-toc';    // a book's sidebar closed (wide screens)
const NARROW = matchMedia('(max-width: 1100px)');  // the sidebar is a drawer
const SLOW_MS = 3000;  // a page that typesets longer is shown static meanwhile

let enginePromise = null;
const engine = () =>
  (enginePromise ??= import(`${site.eng}/runtime/src/main/shell.mjs`).then((m) => m.createEngine()));

// ---- a page's documents --------------------------------------------------

// the documents of a page (root: its #zb-shell) — none on a list
function pageOf(root, url) {
  const node = root.querySelector('#zb-docs');
  const data = node ? JSON.parse(node.textContent) : { docs: [] };
  const docs = new Map();
  for (const d of data.docs) {
    const el = root.querySelector(`article[data-zblang="${d.key}"]`);
    const src = root.querySelector(`script[data-zb-src="${d.key}"]`);
    if (el && src) docs.set(d.key, { ...d, el, source: src.textContent, handle: null, observer: null });
  }
  let current = data.main;
  try {
    const pref = localStorage.getItem(LANG);
    if (pref && docs.has(pref)) current = pref;
  } catch {}
  return { root, url, docs, current, disposed: false };
}

// typeset a document once; laid out again when its width changes
function typeset(p, key) {
  const d = p.docs.get(key);
  if (!d) return Promise.resolve(null);
  d.handle ??= engine()
    .then((e) => e.typeset(d.source, d.el, {
      settings: d.settings, inputs: d.inputs, fonts: site.fonts, progressive: false, baseUrl: p.url,
    }))
    .then((h) => {
      if (p.disposed) {
        h.dispose();
        return null;
      }
      let width = d.el.getBoundingClientRect().width, queued = false;
      d.observer = new ResizeObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const w = d.el.getBoundingClientRect().width;
          if (p.disposed || d.el.hidden || Math.abs(w - width) < 1) return;
          width = w;
          h.relayout(w).catch((e) => console.warn('tsr relayout failed', e));
        });
      });
      d.observer.observe(d.el);
      if (key === p.current) enablePrint(p);
      return h;
    })
    .catch((e) => {
      console.warn('tsr typeset failed; the static page stands', e);
      return null;
    });
  return d.handle;
}

function dispose(p) {
  p.disposed = true;
  for (const d of p.docs.values()) {
    d.observer?.disconnect();
    d.handle?.then((h) => h?.dispose());
  }
}

const enablePrint = (p) => {
  const b = p.root.querySelector('.print-btn');
  if (b) b.disabled = false;
};

// the language shown (a page with a translation)
function select(p, key) {
  p.current = key;
  for (const d of p.docs.values()) d.el.hidden = d.key !== key;
  for (const b of p.root.querySelectorAll('.lang-switch button[data-zblang]'))
    b.classList.toggle('on', b.dataset.zblang === key);
  return typeset(p, key);
}

// the element a link's #id names, when it is on the page
function targetOf(hash) {
  let id = '';
  try { id = decodeURIComponent(hash.slice(1)); } catch {}
  return id ? document.getElementById(id) : null;
}

// ---- the page shown --------------------------------------------------------

let page = null;

function show(p, { hash = '' } = {}) {
  page = p;
  select(p, p.current).then(() => {
    // the typeset page moves what the static one placed: a link's target is
    // brought back into view (scroll anchoring is the host's, shell.mjs)
    if (page !== p || !hash) return;
    const t = targetOf(hash);
    if (t && p.root.contains(t)) t.scrollIntoView();
  });
  bookSidebar();
}

// ---- following a link in place --------------------------------------------

const routable = (url) => url.origin === location.origin && !/\.(?!html$)[a-z0-9]+$/i.test(url.pathname);
const samePage = (url) => url.pathname === location.pathname && url.search === location.search;

// pages fetched, briefly kept (a prefetch on hover, then the click)
const fetched = new Map();
function fetchPage(url) {
  const key = url.origin + url.pathname + url.search;
  const hit = fetched.get(key);
  if (hit && performance.now() - hit.at < 30000) return hit.text;
  const text = fetch(key, { headers: { accept: 'text/html' } }).then((r) => {
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`${r.status} ${key}`);
    return r.text();
  });
  fetched.set(key, { at: performance.now(), text });
  text.catch(() => fetched.delete(key));
  if (fetched.size > 24) fetched.delete(fetched.keys().next().value);
  return text;
}

// where each history entry was scrolled to (this session's)
const scrolls = new Map();
let entry = 0;
const newEntry = () => `${Date.now().toString(36)}-${++entry}`;
const entryKey = () => history.state?.zbk;

let nav = 0;
async function go(url, { push, restore = null }) {
  const id = ++nav;
  if (push) history.pushState({ zbk: newEntry() }, '', url);
  const busy = setTimeout(() => document.documentElement.classList.add('zb-loading'), 150);
  try {
    const doc = new DOMParser().parseFromString(await fetchPage(url), 'text/html');
    if (id !== nav) return;
    // another deploy (its engine, its runtime): the page is loaded whole
    if (doc.getElementById('zb-site')?.textContent !== SITE_JSON) throw new Error('another deploy');
    const next = document.adoptNode(doc.getElementById('zb-shell'));
    const styles = [...doc.head.querySelectorAll('style[data-zb-style]')];
    for (const s of styles)
      if (!document.head.querySelector(`style[data-zb-style="${s.dataset.zbStyle}"]`)) document.head.append(document.adoptNode(s));
    // out of sight, at the width it will have
    next.classList.add('zb-offstage');
    document.body.append(next);
    const p = pageOf(next, url.href);
    await Promise.race([select(p, p.current), new Promise((r) => setTimeout(r, SLOW_MS))]);
    if (id !== nav) {
      dispose(p);
      next.remove();
      return;
    }
    // at once: what both pages keep stays, the rest is the next page's
    const old = document.getElementById('zb-shell');
    for (const keep of next.querySelectorAll('[data-zb-persist]')) {
      const mine = old.querySelector(`[data-zb-persist="${CSS.escape(keep.dataset.zbPersist)}"]`);
      if (mine) keep.replaceWith(mine);
    }
    next.classList.remove('zb-offstage');
    old.replaceWith(next);
    document.title = doc.title;
    document.documentElement.lang = doc.documentElement.lang;
    const keys = new Set(styles.map((s) => s.dataset.zbStyle));
    for (const s of document.head.querySelectorAll('style[data-zb-style]'))
      if (!keys.has(s.dataset.zbStyle)) s.remove();
    if (page) dispose(page);
    const t = url.hash && targetOf(url.hash);
    if (restore !== null) scrollTo(0, restore);
    else if (t) t.scrollIntoView();
    else scrollTo(0, 0);
    document.documentElement.removeAttribute('data-toc-open');
    next.querySelector('main')?.focus({ preventScroll: true });
    show(p, { hash: restore === null ? url.hash : '' });
  } catch (e) {
    if (id === nav) location.replace(url);
  } finally {
    clearTimeout(busy);
    if (id === nav) document.documentElement.classList.remove('zb-loading');
  }
}

document.addEventListener('click', (e) => {
  // the page's own controls
  const lang = e.target.closest?.('.lang-switch button[data-zblang]');
  if (lang && page) {
    select(page, lang.dataset.zblang);
    try { localStorage.setItem(LANG, lang.dataset.zblang); } catch {}
    return;
  }
  if (e.target.closest?.('.print-btn') && page) {
    page.docs.get(page.current)?.handle?.then((h) => h?.print({ title: document.title }));
    return;
  }
  const toggle = e.target.closest?.('[data-zb-toggle="toc"]');
  if (toggle) {
    toggleToc();
    return;
  }
  // a link to another page of the site
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (!routable(url)) return;
  if (samePage(url)) {
    if (url.hash) {
      document.documentElement.removeAttribute('data-toc-open');
      return;  // the browser jumps
    }
    e.preventDefault();
    scrollTo(0, 0);
    return;
  }
  e.preventDefault();
  scrolls.set(entryKey(), scrollY);
  go(url, { push: true });
});

// a link the pointer rests on is fetched ahead
const prefetch = (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  const url = new URL(a.href, location.href);
  if (!routable(url) || samePage(url)) return;
  fetchPage(url).catch(() => {});
  engine();  // (a list's page loads none until a link is near)
};
document.addEventListener('pointerover', prefetch, { passive: true });
document.addEventListener('focusin', prefetch);

history.scrollRestoration = 'manual';
if (!entryKey()) history.replaceState({ ...(history.state ?? {}), zbk: newEntry() }, '');
addEventListener('scroll', () => scrolls.set(entryKey(), scrollY), { passive: true });
addEventListener('popstate', () => {
  const url = new URL(location.href);
  if (page && url.pathname === new URL(page.url).pathname && url.search === new URL(page.url).search) return;
  go(url, { push: false, restore: scrolls.get(entryKey()) ?? 0 });
});

// ---- a book's sidebar ------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.documentElement.removeAttribute('data-toc-open');
});

function toggleToc() {
  const root = document.documentElement;
  if (NARROW.matches) {
    root.toggleAttribute('data-toc-open');
    return;
  }
  const closed = root.dataset.toc !== 'closed';
  if (closed) root.dataset.toc = 'closed';
  else delete root.dataset.toc;
  try { localStorage.setItem(TOC, closed ? 'closed' : 'open'); } catch {}
}

// the document shown marked, its entry open; the section read marked as
// the page scrolls
let spy = null;
function bookSidebar() {
  if (spy) removeEventListener('scroll', spy);
  spy = null;
  const nav = document.querySelector('.book-toc');
  if (!nav) return;
  const here = location.pathname;
  for (const a of nav.querySelectorAll('a[href]')) {
    const url = new URL(a.href);
    if (url.hash) continue;
    if (url.pathname === here) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  for (const li of nav.querySelectorAll('li.toc-ch')) {
    const on = !!li.querySelector(':scope > details > summary a[aria-current], :scope > a[aria-current]');
    const details = li.querySelector(':scope > details');
    if (details) details.open = on;
  }
  const sections = [...nav.querySelectorAll('a[href*="#"]')]
    .filter((a) => new URL(a.href).pathname === here)
    .map((a) => ({ a, id: decodeURIComponent(new URL(a.href).hash.slice(1)) }));
  if (!sections.length) return;
  let queued = false;
  spy = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      let on = null;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) on = s;
      }
      for (const s of sections) s.a.classList.toggle('active', s === on);
      if (on && !NARROW.matches) {  // keep it in the sidebar's view (not the page's)
        const box = nav.getBoundingClientRect(), r = on.a.getBoundingClientRect();
        if (r.top < box.top || r.bottom > box.bottom) nav.scrollTop += r.top - box.top - box.height / 3;
      }
    });
  };
  addEventListener('scroll', spy, { passive: true });
  spy();
}

// ---- the first page --------------------------------------------------------

show(pageOf(document.getElementById('zb-shell') ?? document.body, location.href), { hash: location.hash });
