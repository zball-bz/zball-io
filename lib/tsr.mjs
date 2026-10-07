// The site's side of the Typesetter engine, shared by posts
// (eleventy.config.js) and books (lib/books.mjs): the settings and fonts
// the site gives the engine, the page's stylesheet from the bundles, and
// the page body that hydrates them client-side.
import { readFile } from 'node:fs/promises';
import { MATH_FONT } from '../vendor/typesetter/runtime/src/shared/mathfont.gen.mjs';

// engine asset URLs are VERSIONED by the dist version, so /assets/eng/* can
// be cached immutable and an engine upgrade changes every URL at once
const engPkg = JSON.parse(await readFile(new URL('../vendor/typesetter/package.json', import.meta.url), 'utf8'));
export const ENG = `/assets/eng-${engPkg.version.replace(/^0\.0\.0-/, '')}`;

// The site's settings document (Typesetter docs/settings-table.md). The
// engine reads the whole file and skips the front matter, which is
// Eleventy's (source.frontMatter).
export const SITE = {
  fonts: {
    body: '"Crimson Text", Georgia, serif',
    cjk: '"Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", serif',
  },
  source: { frontMatter: true },
};
// What a document's language adds to them. The engine decides the language
// (the document's own $.doc, else detected from its text): 中文段首缩进两字.
export const BY_LANG = { zh: { par: { indent: 2 } } };
// The faces the site serves, declared to the engine: the worker measures
// with the same files the page paints with (pages-design.md §1).
export const FONTS = [
  { family: 'Crimson Text', src: '/fonts/crimson-400.woff2' },
  { family: 'Crimson Text', src: '/fonts/crimson-400i.woff2', style: 'italic' },
  { family: 'Crimson Text', src: '/fonts/crimson-700.woff2', weight: '700' },
];
// The switch's label for a language (its primary subtag).
const LANG_LABEL = { zh: '中文', en: 'EN' };

export const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return out;
};
export const primary = (lang) => String(lang ?? '').split('-')[0].toLowerCase();
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const cssText = (s) => String(s).replace(/[<>{};]/g, '');
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// A document's diagnostics in the build log: all of them when few, else a
// count per code (the HoTT example's cross-chapter references are ?? on
// purpose).
export function report(inputPath, diagnostics) {
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

// The page of one or more documents (a post and its translation; a book's
// chapter): docs = [{ source, bundle, inputs? }] → { lang, head, body }.
// Each gets its language key (data-zblang); inputs: what its hydration
// reads besides its source (a chapter's labels: the other chapters').
export function pageParts(docs) {
  for (const d of docs) {
    d.lang = d.bundle.docinfo.lang || 'und';
    d.key = primary(d.lang) || 'und';
  }
  if (docs.length > 1 && docs[0].key === docs[1].key) docs[1].key += '-2';
  return { lang: docs[0].bundle.docinfo.lang, head: headOf(docs), body: bodyOf(docs) };
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
  const inputs = Object.fromEntries(docs.filter((d) => d.inputs).map((d) => [d.key, d.inputs]));
  return switchUi + articles.join('') + sources.join('') +
    '<script type="module">\n' + hydration(settings, inputs, docs[0].key) + '\n</script>';
}

// The hydration module (plain source): one engine for the page, a session
// per article, each typeset when first shown and laid out again when its
// width changes; the reader's choice of language is remembered. The typeset page moves
// what the static one placed: a link's target (#id) is brought back into
// view — scroll anchoring is the host's (Typesetter shell.mjs).
function hydration(settings, inputs, mainKey) {
  return [
    `import { createEngine } from '${ENG}/runtime/src/main/shell.mjs';`,
    `const SETTINGS = ${json(settings)};`,
    `const INPUTS = ${json(inputs)};`,
    `const FONTS = ${json(FONTS)};`,
    `const engine = createEngine();`,
    `const handles = {};`,
    `let current = ${json(mainKey)};`,
    `const printBtn = document.querySelector('.print-btn');`,
    `const articleOf = (key) => document.querySelector('article[data-zblang="' + key + '"]');`,
    `const toTarget = (el) => {`,
    `  let id = '';`,
    `  try { id = decodeURIComponent(location.hash.slice(1)); } catch {}`,
    `  const target = id && document.getElementById(id);`,
    `  if (target && el.contains(target)) target.scrollIntoView();`,
    `};`,
    `const hydrate = (key) => {`,
    `  const el = articleOf(key);`,
    `  const src = document.getElementById('tsr-src-' + key);`,
    `  if (!el || !src || handles[key]) return;`,
    `  handles[key] = engine.typeset(src.textContent, el,`,
    `      { settings: SETTINGS[key], inputs: INPUTS[key], fonts: FONTS, progressive: false })`,
    `    .then((h) => {`,
    `      if (printBtn) printBtn.disabled = false;`,
    `      toTarget(el);`,
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
    `  hydrate(key);`,
    `};`,
    `for (const b of document.querySelectorAll('.lang-switch button[data-zblang]'))`,
    `  b.addEventListener('click', () => {`,
    `    activate(b.dataset.zblang);`,
    `    try { localStorage.setItem('zb-lang', b.dataset.zblang); } catch {}`,
    `  });`,
    `let start = current;`,
    `try {`,
    `  const pref = localStorage.getItem('zb-lang');`,
    `  if (pref && pref !== start && articleOf(pref)) start = pref;`,
    `} catch {}`,
    `activate(start);`,
  ].join('\n');
}
