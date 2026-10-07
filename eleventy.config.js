// zball.io — Eleventy over the Typesetter engine.
// .tsm is a first-class template language: the engine renders each file at
// build time into a bundle (renderTsm: resolver-complete semantic HTML with
// static highlighting, its stylesheet, its resolved settings, its language),
// and the page is progressively upgraded to the typeset rendering
// client-side with the bundle's own settings (vendor/typesetter: the
// engine's rolling dist; lib/tsr.mjs: the site's side of it). Books — a
// project of .tsm files in a repository of its own — are lib/books.mjs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import rssPlugin from '@11ty/eleventy-plugin-rss';
import { renderTsm } from './vendor/typesetter/runtime/src/node/render.mjs';
import { BY_LANG, ENG, FONTS, SITE, merge, pageParts, primary, report } from './lib/tsr.mjs';
import { bookRoots, copyBookAssets, loadBooks } from './lib/books.mjs';

const PUBLIC = 'public';
// The page runtime (lib/client/zb.mjs: typesetting, pages shown in place),
// its URL versioned by its content; with the engine's assets and faces it
// is what a page tells the runtime (#zb-site) — a page of another deploy is
// loaded whole
const RUNTIME = 'lib/client/zb.mjs';
const runtimeVersion = createHash('sha256').update(readFileSync(RUNTIME)).digest('hex').slice(0, 10);
const ZB = { eng: ENG, fonts: FONTS, js: `/js/zb.mjs?v=${runtimeVersion}` };

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
  const feed = await render(source, inputPath, { profile: 'feed' });
  return { ...pageParts(docs), feed: feed.html };
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

  // books (lib/books.mjs): each rendered once a build into its pages
  // (src/books/pages.njk paginates books.pages), its files copied beside
  // them; a book's root is watched wherever it is (a working copy too)
  let books = { list: [], pages: [], assets: [] };
  eleventyConfig.addGlobalData('books', async () => (books = await loadBooks()));
  eleventyConfig.on('eleventy.after', ({ directories }) => copyBookAssets(books, directories.output));
  for (const { root } of bookRoots().values()) eleventyConfig.addWatchTarget(root);

  eleventyConfig.addFilter('postDate', (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  });

  // the dist as it is packed (runtime, wasm, highlighting grammars,
  // hyphenation patterns, the math font): the runtime's relative imports hold
  eleventyConfig.addPassthroughCopy({
    'vendor/typesetter': ENG.slice(1),
    [RUNTIME]: 'js/zb.mjs',
    [PUBLIC]: '/',
  });
  eleventyConfig.addGlobalData('zb', ZB);

  // feed.njk: the filters (dates, absolute URLs)
  eleventyConfig.addPlugin(rssPlugin);

  return {
    dir: { input: 'src', includes: '_includes' },
  };
}
