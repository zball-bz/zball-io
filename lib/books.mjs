// Books (docs/books.md): a book is a Typesetter project in a repository of
// its own, mounted at books/<slug>/ as a submodule (or a working copy
// elsewhere: ZB_BOOK_<slug>, books.local.json), rendered as one project —
// references across chapters, numbering continued (renderProject) — into a
// page per document under /books/<slug>/. The site reads none of the
// book's content: its contents page, numbering and reference forms are the
// engine's and the book's. Its files are referenced relative to the book's
// root, where its chapters lie flat: the same paths hold in the editor's
// preview, a Typesetter export and here.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CONTINUED_COUNTERS, renderProject } from '../vendor/typesetter/runtime/src/node/project.mjs';
import { renderTsm } from '../vendor/typesetter/runtime/src/node/render.mjs';
import { BY_LANG, FONTS, SITE, merge, pageParts, primary, report } from './tsr.mjs';

const BOOKS = 'books';
const LOCAL = 'books.local.json';
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const STATUS = new Set(['published', 'draft']);
// the diagnostics that fail a published chapter (a draft's are warnings): a
// reference that resolves nowhere, a label declared twice, a module or
// labels file that did not load (a bibliography that did not is an error)
const FATAL_CODES = new Set(['ref-unresolved', 'label-duplicate', 'use-module', 'labels-import']);

const isUrl = (s) => /^[a-z][a-z0-9+.-]*:/i.test(s);
const inside = (root, p) => p.startsWith(root + sep);
const expand = (p) => resolve(String(p).replace(/^~(?=$|\/)/, homedir()));

// The books' roots: books/<slug>/ (a submodule), and the working copies
// that stand in for one or add one — books.local.json ({ slug: path }, not
// committed), then ZB_BOOK_<slug>=<path> (ZB_BOOK_my_book names
// books/my-book too: a shell variable has no '-').
export function bookRoots() {
  const roots = new Map();
  if (existsSync(BOOKS))
    for (const e of readdirSync(BOOKS, { withFileTypes: true }))
      if (e.isDirectory()) roots.set(e.name, { root: resolve(BOOKS, e.name), local: false });
  const local = existsSync(LOCAL) ? JSON.parse(readFileSync(LOCAL, 'utf8')) : {};
  const env = Object.entries(process.env).filter(([k, v]) => k.startsWith('ZB_BOOK_') && v).map(([k, v]) => [k.slice(8), v]);
  for (const [name, path] of [...Object.entries(local), ...env]) {
    const slug = [...roots.keys()].find((s) => s === name || s.replace(/-/g, '_') === name) ?? name;
    roots.set(slug, { root: expand(path), local: true });
  }
  for (const slug of roots.keys())
    if (!SLUG.test(slug)) throw new Error(`books: "${slug}" is not a book's slug (a-z, 0-9, -)`);
  return roots;
}

// A book's files, for --serve: what changes them is a change of the book.
// (Its working tree minus .git and node_modules; a book is small.)
function fingerprint(root) {
  const parts = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const st = statSync(p);
        parts.push(`${relative(root, p)}\0${st.size}\0${st.mtimeMs}`);
      }
    }
  };
  walk(root);
  return parts.sort().join('\n');
}

// tsm.project.json: the Typesetter project (files in book order, settings,
// continue, offset) and the site's block, book
function readProject(slug, root) {
  const config = JSON.parse(readFileSync(join(root, 'tsm.project.json'), 'utf8'));
  const where = `books/${slug}: tsm.project.json`;
  const book = config.book;
  if (!book || typeof book.title !== 'string' || !book.title) throw new Error(`${where}: book.title is required`);
  if (!Array.isArray(config.files) || !config.files.length) throw new Error(`${where}: "files" lists the documents in book order`);
  const keys = config.files.map((f) => {
    const key = String(f).replace(/\.tsm$/, '');
    if (!String(f).endsWith('.tsm') || !KEY.test(key))
      throw new Error(`${where}: "${f}" — a document is <key>.tsm at the book's root (key: a-z, 0-9, -, _)`);
    return key;
  });
  if (!keys.includes('index')) throw new Error(`${where}: the book's home page index.tsm is not in "files"`);
  const status = {};
  for (const key of keys) {
    // a chapter not listed is a draft; the home page is published unless listed
    const s = book.status?.[key] ?? (key === 'index' ? 'published' : 'draft');
    if (!STATUS.has(s)) throw new Error(`${where}: book.status.${key} is "${s}" (published or draft)`);
    status[key] = s;
  }
  let settings = config.settings ?? {};
  if (typeof settings === 'string') settings = JSON.parse(readFileSync(join(root, settings), 'utf8'));
  // the site's rows: its faces and its render (ids) are the site's to say
  const { fonts, render, ...own } = settings;
  if (fonts || render)
    console.warn(`[book] ${where}: settings.${fonts ? 'fonts' : 'render'}${fonts && render ? ' and settings.render' : ''} ignored (the site's)`);
  return { config, book, keys, status, settings: own };
}

// One book: its documents rendered as a project with the site's settings,
// what its language adds and its own; its pages; the files they reference.
async function renderBook(slug, root) {
  const { config, book, keys, status, settings: own } = readProject(slug, root);
  const lang = primary(book.lang);
  const settings = merge(merge(merge(SITE, lang ? { doc: { lang: book.lang } } : {}), BY_LANG[lang] ?? {}), own);
  const base = `/books/${slug}/`;
  const urls = Object.fromEntries(keys.map((k) => [k, k === 'index' ? base : base + k]));
  const files = keys.map((key) => ({
    doc: key, source: readFileSync(join(root, `${key}.tsm`), 'utf8'), baseDir: root, rootDir: root,
  }));
  const project = await renderProject({
    files, settings, urls, continue: config.continue ?? CONTINUED_COUNTERS, offset: config.offset ?? {},
    render: (source, opts) => renderTsm(source, { ...opts, fonts: FONTS }),
  });
  for (const d of project.diagnostics) console.warn(`[book] books/${slug}: ${d}`);

  // a label is the book's: two documents that declare it are an error
  const declared = new Map();
  for (const [key, m] of Object.entries(project.manifests))
    for (const l of JSON.parse(m).labels ?? []) declared.set(l.label, [...(declared.get(l.label) ?? []), key]);

  const realRoot = realpathSync(root);
  const assets = new Map();  // the book's files the pages reference: path below the root → file
  const failures = [];
  const docs = project.docs.map((r, i) => {
    const key = keys[i];
    const path = `books/${slug}/${key}.tsm`;
    if (!r.ok) throw new Error(`${path}: tsm render failed:\n${r.diagnostics}`);
    // what fails a published document and warns on a draft: a reference
    // that resolves nowhere, a label declared twice, a file that is not there
    const severity = status[key] === 'published' ? 'error' : 'warning';
    const issues = r.diagnostics.split('\n').filter((l) => FATAL_CODES.has(l.split(' ')[1]));
    for (const l of JSON.parse(r.labels).labels ?? []) {
      const others = declared.get(l.label).filter((k) => k !== key);
      if (others.length) issues.push(`${severity} label-duplicate label '${l.label}' is declared in ${others.map((k) => `${k}.tsm`).join(', ')} too`);
    }
    // what fails any document: a file the page would not find
    const broken = [];
    for (const m of r.resources ?? []) {
      if (m.role === 'font' || m.role === 'font-metrics') continue;  // the site's faces
      // an image is its reference; a load (a module, a bibliography) the
      // file it resolved to, and the reference as written (ref)
      const written = m.requester === 'image' ? m.url : m.ref;
      if (written !== undefined && isUrl(written)) {
        if (m.status === 'denied') broken.push(`${m.role} "${written}" is not allowed`);
        continue;
      }
      if (written?.startsWith('/')) {
        broken.push(`${m.role} "${written}" is a site-root path: write it relative to the book's root`);
        continue;
      }
      let file = m.url;
      if (m.requester === 'image') {
        try { file = resolve(root, decodeURIComponent(m.url.split(/[?#]/)[0])); } catch { file = resolve(root, m.url); }
      }
      if (m.status === 'denied' || !inside(root, file)) {
        broken.push(`${m.role} "${written ?? file}" is outside the book's root`);
        continue;
      }
      if (m.status === 'failed' || !existsSync(file)) {
        issues.push(`${severity} resource-missing ${m.role} "${relative(root, file)}" is not in the book`);
        continue;
      }
      if (!inside(realRoot, realpathSync(file))) {
        broken.push(`${m.role} "${relative(root, file)}" is a link to outside the book's root`);
        continue;
      }
      assets.set(relative(root, file).split(sep).join('/'), file);
    }
    if (key === 'index' && (JSON.parse(r.labels).totals?.heading ?? 0) > 0)
      broken.push('the home page has a numbered heading: it would take the first chapter\'s number');
    if (broken.length) failures.push(`${path}:\n  ${broken.join('\n  ')}`);
    if (status[key] === 'published') {
      report(path, r.diagnostics);
      if (issues.length) failures.push(`${path} (published):\n  ${issues.join('\n  ')}`);
    } else {
      // a draft: everything is a warning (the engine's diagnostics hold its own)
      report(path, [r.diagnostics.trim(), ...issues.filter((l) => !r.diagnostics.includes(l))].filter(Boolean).join('\n'));
    }
    return { key, bundle: r, source: files[i].source, url: urls[key], status: status[key] };
  });
  if (failures.length) throw new Error(`books/${slug}:\n${failures.join('\n')}`);

  const title = (d) => d.bundle.docinfo.title || d.key;
  const chapters = docs.filter((d) => d.key !== 'index');
  const partOf = (key) => (book.parts ?? []).find((p) => (p.chapters ?? []).includes(key))?.title ?? '';
  const meta = {
    slug, url: base, title: book.title, subtitle: book.subtitle ?? '',
    chapters: chapters.length, published: chapters.filter((d) => d.status === 'published').length,
  };
  const pages = docs.map((d) => {
    const at = chapters.indexOf(d);
    const near = (c) => c && { url: c.url, title: title(c) };
    // its hydration reads the other documents' manifests (Typesetter
    // tools/tsm-project.mjs); its settings, the bundle's, hold project.*
    const others = keys.filter((k) => k !== d.key).map((k) => project.manifests[k]);
    const parts = pageParts([{ source: d.source, bundle: d.bundle, inputs: { labels: `[${others.join(',')}]` } }]);
    return {
      book: meta, key: d.key, url: d.url, home: d.key === 'index',
      permalink: d.key === 'index' ? `${base}index.html` : `${base}${d.key}.html`,
      title: d.key === 'index' ? book.title : `${title(d)} · ${book.title}`,
      part: d.key === 'index' ? '' : partOf(d.key),
      draft: d.status === 'draft',
      prev: at > 0 ? near(chapters[at - 1]) : null,
      next: at >= 0 ? near(chapters[at + 1]) : null,
      tsr: parts,
    };
  });
  return { meta, pages, assets, root };
}

// Every book, each rendered once a build — again only when its files
// changed (--serve). → { list: [book], pages: [page], assets: [{ slug, files }] }
const cache = new Map();
export async function loadBooks() {
  const list = [], pages = [], assets = [];
  for (const [slug, { root, local }] of bookRoots()) {
    if (!existsSync(join(root, 'tsm.project.json'))) {
      const why = `books/${slug}: no tsm.project.json at ${root}` +
        (local ? '' : ' (a submodule not checked out? git submodule update --init)');
      if (process.env.CI) throw new Error(why);
      console.warn(`[book] ${why}; skipped`);
      continue;
    }
    const print = fingerprint(root);
    let built = cache.get(slug);
    if (!built || built.root !== root || built.print !== print) {
      built = { root, print, book: await renderBook(slug, root) };
      cache.set(slug, built);
      console.log(`[book] books/${slug}: ${built.book.pages.length} pages${local ? ` (from ${root})` : ''}`);
    }
    list.push(built.book.meta);
    pages.push(...built.book.pages);
    assets.push({ slug, files: built.book.assets });
  }
  return { list, pages, assets };
}

// The files the books' pages reference, beside the pages: /books/<slug>/<path>
export async function copyBookAssets(books, outDir) {
  for (const { slug, files } of books.assets)
    for (const [path, file] of files) {
      const to = join(outDir, BOOKS, slug, path);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(file, to);
    }
}
