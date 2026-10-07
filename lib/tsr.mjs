// The site's side of the Typesetter engine, shared by posts
// (eleventy.config.js) and books (lib/books.mjs): the settings and fonts
// the site gives the engine, and a page's stylesheets and body from the
// bundles — what the page runtime (lib/client/zb.mjs) typesets.
import { createHash } from 'node:crypto';
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
// Each gets its language key (data-zblang) and the scope its rules apply
// under (data-zbdoc: a hash of what they are, so a page that shares them
// shares their style); inputs: what its typesetting reads besides its
// source (a chapter's labels: the other chapters'). The page runtime
// (lib/client/zb.mjs) typesets them from what body carries.
export function pageParts(docs) {
  for (const d of docs) {
    d.lang = d.bundle.docinfo.lang || 'und';
    d.key = primary(d.lang) || 'und';
    const fonts = d.bundle.settings.fonts ?? {};
    d.css = `  font-family: ${cssText(fonts.body)};\n  --tsr-cjk-font: ${cssText(fonts.cjk)};\n${d.bundle.styles.rules}`;
    d.scope = 'd' + createHash('sha256').update(d.css).digest('hex').slice(0, 10);
  }
  if (docs.length > 1 && docs[0].key === docs[1].key) docs[1].key += '-2';
  return { lang: docs[0].bundle.docinfo.lang, head: headOf(docs), body: bodyOf(docs) };
}

// The page's stylesheets, each keyed (data-zb-style) so a page shown in
// place adds the ones it lacks and drops the ones it no longer uses: the
// engine's render contract, theme and math face (the same on every page),
// and each document's rules (its defaults, the site's, its own $.set) under
// its own scope, so neither the site's chrome nor another document sees them.
function headOf(docs) {
  const { styles } = docs[0].bundle;
  const shared = `<style data-zb-style="tsr">\n` +
    `@font-face { font-family: ${JSON.stringify(MATH_FONT.family)};` +
    ` src: url(${JSON.stringify(`${ENG}/${MATH_FONT.file}`)}); font-display: block; }\n` +
    `${styles.contract}\n${styles.theme}\n</style>\n`;
  const scopes = new Map(docs.map((d) => [d.scope, `<style data-zb-style="${d.scope}">\narticle[data-zbdoc="${d.scope}"] {\n${d.css}}\n</style>\n`]));
  return shared + [...scopes.values()].join('');
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
    `<article class="post" data-zblang="${d.key}" data-zbdoc="${d.scope}" lang="${attr(d.lang)}"${i ? ' hidden' : ''}>\n${d.bundle.html}</article>\n`);
  const sources = docs.map((d) =>
    `<script type="text/plain" data-zb-src="${d.key}">${d.source.replace(/<\/script/gi, '<\\/script')}</script>\n`);
  // what the runtime typesets with: the resolved settings back verbatim,
  // the host's own rows (host.width, host.dppx, …: the browser's to say)
  // aside, and the inputs
  const data = {
    main: docs[0].key,
    docs: docs.map((d) => {
      const { host: _host, ...settings } = d.bundle.settings;
      return { key: d.key, settings, ...(d.inputs ? { inputs: d.inputs } : {}) };
    }),
  };
  return switchUi + articles.join('') + sources.join('') +
    `<script type="application/json" id="zb-docs">${json(data)}</script>\n`;
}
