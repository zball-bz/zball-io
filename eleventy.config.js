// zball.io — Eleventy over the Typesetter engine.
// .tsm is a first-class template language: the engine renders each file at
// build time into a bundle (renderTsm: resolver-complete semantic HTML with
// static highlighting, its stylesheet, its resolved settings, its language),
// and the page is progressively upgraded to the typeset rendering
// client-side with the bundle's own settings (vendor/typesetter: the
// engine's rolling dist).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import rssPlugin from '@11ty/eleventy-plugin-rss';
import { renderTsm } from './vendor/typesetter/runtime/src/node/render.mjs';
import { MATH_FONT } from './vendor/typesetter/runtime/src/shared/mathfont.gen.mjs';

// engine asset URLs are VERSIONED by the dist version, so /assets/eng/* can
// be cached immutable and an engine upgrade changes every URL at once
const engPkg = JSON.parse(await readFile('./vendor/typesetter/package.json', 'utf8'));
const ENG = `/assets/eng-${engPkg.version.replace(/^0\.0\.0-/, '')}`;

// The site's settings document (Typesetter docs/settings-table.md). The
// engine reads the whole file and skips the front matter, which is
// Eleventy's (source.frontMatter).
const SITE = {
  fonts: {
    body: '"Crimson Text", Georgia, serif',
    cjk: '"Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", serif',
  },
  source: { frontMatter: true },
};
// What a document's language adds to them. The engine decides the language
// (the document's own $.doc, else detected from its text): 中文段首缩进两字.
const BY_LANG = { zh: { par: { indent: 2 } } };
// The faces the site serves, declared to the engine: the worker measures
// with the same files the page paints with (pages-design.md §1).
const FONTS = [
  { family: 'Crimson Text', src: '/fonts/crimson-400.woff2' },
  { family: 'Crimson Text', src: '/fonts/crimson-400i.woff2', style: 'italic' },
  { family: 'Crimson Text', src: '/fonts/crimson-700.woff2', weight: '700' },
];
// The switch's label for a language (its primary subtag).
const LANG_LABEL = { zh: '中文', en: 'EN' };
const PUBLIC = 'public';

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return out;
};
const primary = (lang) => String(lang ?? '').split('-')[0].toLowerCase();
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const cssText = (s) => String(s).replace(/[<>{};]/g, '');
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// A document's diagnostics in the build log: all of them when few, else a
// count per code (the HoTT example's cross-chapter references are ?? on
// purpose).
function report(inputPath, diagnostics) {
  const lines = diagnostics.trim().split('\n').filter(Boolean);
  if (!lines.length) return;
  if (lines.length <= 8) {
    console.warn(`[tsm] ${inputPath}\n  ${lines.join('\n  ')}`);
    return;
  }
  const codes = {};
  for (const l of lines) {
    const code = l.split(' ').slice(0, 2).join(' ');
    codes[code] = (codes[code] ?? 0) + 1;
  }
  console.warn(`[tsm] ${inputPath}: ` + Object.entries(codes).map(([c, n]) => `${n}× ${c}`).join(', '));
}

// The images a document references must be served: a site-root path is a
// file under public/; a relative one would resolve against the page's URL,
// where nothing is (write /images/x.png).
function checkResources(inputPath, bundle) {
  for (const r of bundle.resources ?? []) {
    if (r.role !== 'image' || r.status === 'denied' || /^[a-z][a-z0-9+.-]*:/i.test(r.url)) continue;
    const path = r.url.split(/[?#]/)[0];
    if (!path.startsWith('/'))
      throw new Error(`${inputPath}: image "${r.url}" is relative; write a site-root path (/images/…)`);
    if (!existsSync(join(PUBLIC, decodeURIComponent(path))))
      throw new Error(`${inputPath}: image "${r.url}" is not under ${PUBLIC}/`);
  }
}

// One document, rendered with the site's settings and what its language
// adds. idPrefix: a second document on the page gets its own ids.
async function render(source, inputPath, { idPrefix, profile } = {}) {
  const opts = { baseDir: dirname(inputPath), rootDir: PUBLIC, fonts: FONTS, profile };
  const base = idPrefix ? merge(SITE, { render: { idPrefix } }) : SITE;
  let bundle = await renderTsm(source, { ...opts, settings: base });
  const extra = profile === 'feed' ? null : BY_LANG[primary(bundle.docinfo.lang)];
  if (extra) bundle = await renderTsm(source, { ...opts, settings: merge(base, extra) });
  if (!bundle.ok) throw new Error(`${inputPath}: tsm render failed:\n${bundle.diagnostics}`);
  return bundle;
}

// The page of a .tsm file: its document and, for a post, the sibling
// translation xxx.en.tsm (no front matter). → { lang, head, body, feed }
async function pageOf(inputPath) {
  const docs = [];
  const source = await readFile(inputPath, 'utf8');
  const main = await render(source, inputPath);
  report(inputPath, main.diagnostics);
  checkResources(inputPath, main);
  docs.push({ source, bundle: main });
  const enPath = inputPath.replace(/\.tsm$/, '.en.tsm');
  if (enPath !== inputPath && existsSync(enPath)) {
    const enSource = await readFile(enPath, 'utf8');
    const en = await render(enSource, enPath, { idPrefix: 'tsr-en-' });
    report(enPath, en.diagnostics);
    checkResources(enPath, en);
    docs.push({ source: enSource, bundle: en });
  }
  for (const d of docs) {
    d.lang = d.bundle.docinfo.lang || 'und';
    d.key = primary(d.lang) || 'und';
  }
  if (docs.length > 1 && docs[0].key === docs[1].key) docs[1].key += '-2';
  const feed = await render(source, inputPath, { profile: 'feed' });
  return { lang: main.docinfo.lang, head: headOf(docs), body: bodyOf(docs), feed: feed.html };
}

// The page's stylesheet: the engine's render contract and theme, the math
// face when a formula is set, and each document's rules (its defaults, the
// site's, its own $.set) under its own article, so neither the site's
// chrome nor the other language sees them.
function headOf(docs) {
  const { styles } = docs[0].bundle;
  const math = docs.some((d) => /class="tsr-math[" ]/.test(d.bundle.html));
  const scoped = docs.map((d) => {
    const fonts = d.bundle.settings.fonts ?? {};
    return `article[data-zblang="${d.key}"] {\n` +
      `  font-family: ${cssText(fonts.body)};\n` +
      `  --tsr-cjk-font: ${cssText(fonts.cjk)};\n` +
      `${d.bundle.styles.rules}}\n`;
  });
  return [
    math ? `@font-face { font-family: ${JSON.stringify(MATH_FONT.family)};` +
           ` src: url(${JSON.stringify(`${ENG}/${MATH_FONT.file}`)}); font-display: block; }\n` : '',
    styles.contract, '\n', styles.theme, '\n', ...scoped,
  ].join('');
}

function bodyOf(docs) {
  const switchUi = [
    '<div class="lang-switch" role="group" aria-label="tools">',
    docs.length < 2 ? '' : docs.map((d, i) =>
      `<button data-zblang="${d.key}"${i === 0 ? ' class="on"' : ''}>${LANG_LABEL[d.key] ?? d.key.toUpperCase()}</button>`).join(''),
    '<button class="print-btn" title="分页打印 / 导出 PDF" disabled>打印</button>',
    '</div>\n',
  ].join('');
  const articles = docs.map((d, i) =>
    `<article class="post" data-zblang="${d.key}" lang="${attr(d.lang)}"${i ? ' hidden' : ''}>\n${d.bundle.html}</article>\n`);
  const sources = docs.map((d) =>
    `<script type="text/plain" id="tsr-src-${d.key}">${d.source.replace(/<\/script/gi, '<\\/script')}</script>\n`);
  // hydration: the resolved settings back verbatim, the host's own rows
  // (host.width, host.dppx, …: the browser's to say) aside
  const settings = Object.fromEntries(docs.map((d) => {
    const { host: _host, ...pageSettings } = d.bundle.settings;
    return [d.key, pageSettings];
  }));
  return switchUi + articles.join('') + sources.join('') +
    '<script type="module">\n' + hydration(settings, docs[0].key) + '\n</script>';
}

// The hydration module (plain source): one engine for the page, a session
// per article, each typeset when first shown and laid out again when its
// width changes; the language choice is remembered.
function hydration(settings, mainKey) {
  return [
    `import { createEngine } from '${ENG}/runtime/src/main/shell.mjs';`,
    `const SETTINGS = ${json(settings)};`,
    `const FONTS = ${json(FONTS)};`,
    `const engine = createEngine();`,
    `const handles = {};`,
    `let current = ${json(mainKey)};`,
    `const printBtn = document.querySelector('.print-btn');`,
    `const articleOf = (key) => document.querySelector('article[data-zblang="' + key + '"]');`,
    `const hydrate = (key) => {`,
    `  const el = articleOf(key);`,
    `  const src = document.getElementById('tsr-src-' + key);`,
    `  if (!el || !src || handles[key]) return;`,
    `  handles[key] = engine.typeset(src.textContent, el, { settings: SETTINGS[key], fonts: FONTS, progressive: false })`,
    `    .then((h) => {`,
    `      if (printBtn) printBtn.disabled = false;`,
    `      let width = el.getBoundingClientRect().width, queued = false;`,
    `      new ResizeObserver(() => {`,
    `        if (queued) return;`,
    `        queued = true;`,
    `        requestAnimationFrame(() => {`,
    `          queued = false;`,
    `          const w = el.getBoundingClientRect().width;`,
    `          if (el.hidden || Math.abs(w - width) < 1) return;`,
    `          width = w;`,
    `          h.relayout(w).catch((e) => console.warn('tsr relayout failed', e));`,
    `        });`,
    `      }).observe(el);`,
    `      return h;`,
    `    })`,
    `    .catch((e) => { console.warn('tsr hydrate failed; static page stands', e); return null; });`,
    `};`,
    `printBtn?.addEventListener('click', async () => {`,
    `  const h = await handles[current];`,
    `  if (h) h.print({ title: document.title });`,
    `});`,
    `const activate = (key) => {`,
    `  current = key;`,
    `  for (const a of document.querySelectorAll('article[data-zblang]')) a.hidden = a.dataset.zblang !== key;`,
    `  for (const b of document.querySelectorAll('.lang-switch button[data-zblang]'))`,
    `    b.classList.toggle('on', b.dataset.zblang === key);`,
    `  try { localStorage.setItem('zb-lang', key); } catch {}`,
    `  hydrate(key);`,
    `};`,
    `for (const b of document.querySelectorAll('.lang-switch button[data-zblang]'))`,
    `  b.addEventListener('click', () => activate(b.dataset.zblang));`,
    `let start = current;`,
    `try {`,
    `  const pref = localStorage.getItem('zb-lang');`,
    `  if (pref && pref !== start && articleOf(pref)) start = pref;`,
    `} catch {}`,
    `activate(start);`,
  ].join('\n');
}

export default function (eleventyConfig) {
  // bilingual posts (in-page switch): xxx.tsm + an optional sibling
  // xxx.en.tsm (its translation, no front matter), set on the same page
  eleventyConfig.ignores.add('src/posts/*.en.tsm');
  eleventyConfig.addWatchTarget('src/posts/*.en.tsm');
  eleventyConfig.addTemplateFormats('tsm');
  eleventyConfig.addExtension('tsm', {
    outputFileExtension: 'html',
    // the page is rendered with the template's data, so the layout's head
    // and the feed read it (tsr: { lang, head, body, feed })
    getData: async (inputPath) => ({ tsr: await pageOf(inputPath) }),
    compile: () => async (data) => data.tsr.body,
  });

  eleventyConfig.addFilter('postDate', (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  });

  // the dist as it is packed (runtime, wasm, highlighting grammars,
  // hyphenation patterns, the math font): the runtime's relative imports hold
  eleventyConfig.addPassthroughCopy({
    'vendor/typesetter': ENG.slice(1),
    [PUBLIC]: '/',
  });

  // feed.njk: the filters (dates, absolute URLs)
  eleventyConfig.addPlugin(rssPlugin);

  return {
    dir: { input: 'src', includes: '_includes' },
  };
}
