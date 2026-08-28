// zball.io — Eleventy over the Typesetter engine.
// .tsm is a first-class template language: build-time semantic HTML with
// static tree-sitter highlighting (vendor/typesetter, the engine's rolling
// dist), progressively upgraded to the full typeset rendering client-side.
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { feedPlugin } from '@11ty/eleventy-plugin-rss';
import { renderTsm } from './vendor/typesetter/runtime/src/node/render.mjs';
import { TSR_CSS, TSR_CJK_FONT } from './vendor/typesetter/runtime/src/main/shell.mjs';

// engine asset URLs are VERSIONED by the dist version, so /assets/eng/* can
// be cached immutable and an engine upgrade changes every URL at once
const engPkg = JSON.parse(await readFile('./vendor/typesetter/package.json', 'utf8'));
const ENG = `/assets/eng-${engPkg.version.replace(/^0\.0\.0-/, '')}`;

export default function (eleventyConfig) {
  // bilingual posts (in-page switch): xxx.tsm (zh) + optional sibling
  // xxx.en.tsm (translation, no front matter). Both semantic versions ship
  // in the page; each language typesets lazily in its own engine instance.
  eleventyConfig.ignores.add('src/posts/*.en.tsm');
  eleventyConfig.addTemplateFormats('tsm');
  eleventyConfig.addExtension('tsm', {
    outputFileExtension: 'html',
    compile: async function (inputContent, inputPath) {
      // document language from front matter (lang: en) — supplement words
      // (Figure/图) and the client engine follow it; resources such as
      // #bibliography(src) resolve against the document and the site root
      const raw = await readFile(inputPath, 'utf8');
      const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? '';
      const mainLang = /^lang:\s*(\S+)/m.exec(fm)?.[1] ?? 'zh';
      const res = { baseDir: dirname(inputPath), rootDir: 'public' };
      const { html, diags, ok } = await renderTsm(inputContent, { ...res, lang: mainLang === 'zh' ? 'zh-CN' : mainLang });
      if (!ok) throw new Error('tsm render failed:\n' + diags);
      if (diags.trim()) console.warn('[tsm]', diags.trim());
      let enHtml = null, enSrc = null;
      try {
        enSrc = await readFile(inputPath.replace(/\.tsm$/, '.en.tsm'), 'utf8');
      } catch { /* no translation */ }
      if (enSrc !== null) {
        const en = await renderTsm(enSrc, { ...res, lang: 'en' });
        if (!en.ok) throw new Error('en.tsm render failed:\n' + en.diags);
        if (en.diags.trim()) console.warn('[tsm:en]', en.diags.trim());
        enHtml = en.html;
      }
      const esc = (t) => t.replace(/<\/script/gi, '<\\/script');
      const switchUi = [
        '<div class="lang-switch" role="group" aria-label="tools">',
        enHtml === null ? ''
          : '<button data-zblang="zh" class="on">中文</button>' +
            '<button data-zblang="en">EN</button>',
        '<button class="print-btn" title="分页打印 / 导出 PDF" disabled>打印</button>',
        '</div>\n',
      ].join('');
      const enBlock = enHtml === null ? '' : [
        '<article class="post" data-zblang="en" lang="en" hidden>\n',
        enHtml, '</article>\n',
        '<script type="text/plain" id="tsr-src-en">', esc(enSrc), '</script>\n',
      ].join('');
      // the hydration module is plain source (no nested template literals):
      // per-language engines, lazy typeset, localStorage preference
      const script = [
        `import { createEngine } from '${ENG}/runtime/src/main/shell.mjs';`,
        `const engines = {};`,
        `const opts = (lang) => ({`,
        `  fontFamily: '"Crimson Text", Georgia, serif',`,
        `  cjkFontFamily: '"Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", serif',`,
        `  lang: lang === 'en' ? 'en' : 'zh-CN',`,
        `  fonts: [`,
        `    { family: 'Crimson Text', src: '/fonts/crimson-400.woff2' },`,
        `    { family: 'Crimson Text', src: '/fonts/crimson-400i.woff2', style: 'italic' },`,
        `    { family: 'Crimson Text', src: '/fonts/crimson-700.woff2', weight: '700' },`,
        `  ],`,
        `  progressive: false,`,
        `});`,
        `const handles = {};`,
        `let current = ${JSON.stringify(mainLang)};`,
        `const printBtn = document.querySelector('.print-btn');`,
        `const hydrate = (lang) => {`,
        `  const el = document.querySelector('article[data-zblang="' + lang + '"]');`,
        `  const src = document.getElementById('tsr-src-' + lang);`,
        `  if (!el || !src || engines[lang]) return;`,
        `  engines[lang] = createEngine();`,
        `  handles[lang] = engines[lang].typeset(src.textContent, el, opts(lang))`,
        `    .then((h) => { if (printBtn) printBtn.disabled = false; return h; })`,
        `    .catch((e) => console.warn('tsr hydrate failed; static page stands', e));`,
        `};`,
        `printBtn?.addEventListener('click', async () => {`,
        `  const h = await handles[current];`,
        `  if (h) h.print({ title: document.title });`,
        `});`,
        `const activate = (lang) => {`,
        `  current = lang;`,
        `  for (const a of document.querySelectorAll('article[data-zblang]'))`,
        `    a.hidden = a.dataset.zblang !== lang;`,
        `  for (const b of document.querySelectorAll('.lang-switch button[data-zblang]'))`,
        `    b.classList.toggle('on', b.dataset.zblang === lang);`,
        `  try { localStorage.setItem('zb-lang', lang); } catch {}`,
        `  hydrate(lang);`,
        `};`,
        `for (const b of document.querySelectorAll('.lang-switch button[data-zblang]'))`,
        `  b.addEventListener('click', () => activate(b.dataset.zblang));`,
        `let start = ${JSON.stringify(mainLang)};`,
        `try {`,
        `  const pref = localStorage.getItem('zb-lang');`,
        `  if (pref && pref !== start && document.querySelector('article[data-zblang="' + pref + '"]')) start = pref;`,
        `} catch {}`,
        `activate(start);`,
      ].join('\n');
      const body = switchUi +
        `<article class="post" data-zblang="${mainLang}" lang="${mainLang === 'zh' ? 'zh-CN' : mainLang}">\n` + html + '</article>\n' +
        enBlock +
        `<script type="text/plain" id="tsr-src-${mainLang}">` + esc(inputContent) + '</script>\n' +
        '<script type="module">\n' + script + '\n</script>';
      return async () => body;
    },
  });

  eleventyConfig.addFilter('postDate', (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  });

  eleventyConfig.addGlobalData('tsrCss', TSR_CSS);
  eleventyConfig.addGlobalData('tsrCjkFont', TSR_CJK_FONT);
  eleventyConfig.addGlobalData('engBase', ENG);

  eleventyConfig.addPassthroughCopy({
    'vendor/typesetter/runtime/src': `${ENG}/runtime/src`.slice(1),
    'vendor/typesetter/runtime/assets/hl': `${ENG}/runtime/assets/hl`.slice(1),
    'vendor/typesetter/engine/build-wasm': `${ENG}/engine/build-wasm`.slice(1),
    'vendor/typesetter/fonts': `${ENG}/fonts`.slice(1),
    public: '/',
  });

  eleventyConfig.addPlugin(feedPlugin, {
    type: 'atom',
    outputPath: '/feed.xml',
    collection: { name: 'post', limit: 20 },
    metadata: {
      language: 'zh-CN',
      title: 'zball',
      subtitle: 'TeX 级网页排版引擎驱动的博客',
      base: 'https://zball.io/',
      author: { name: 'zball' },
    },
  });

  return {
    dir: { input: 'src', includes: '_includes' },
  };
}
