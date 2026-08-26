// zball.io — Eleventy over the Typesetter engine.
// .tsm is a first-class template language: build-time semantic HTML with
// static tree-sitter highlighting (vendor/typesetter, the engine's rolling
// dist), progressively upgraded to the full typeset rendering client-side.
import { readFile } from 'node:fs/promises';
import { feedPlugin } from '@11ty/eleventy-plugin-rss';
import { renderTsm } from './vendor/typesetter/runtime/src/node/render.mjs';
import { TSR_CSS, TSR_CJK_FONT } from './vendor/typesetter/runtime/src/main/shell.mjs';

// engine asset URLs are VERSIONED by the dist version, so /assets/eng/* can
// be cached immutable and an engine upgrade changes every URL at once
const engPkg = JSON.parse(await readFile('./vendor/typesetter/package.json', 'utf8'));
const ENG = `/assets/eng-${engPkg.version.replace(/^0\.0\.0-/, '')}`;

export default function (eleventyConfig) {
  eleventyConfig.addTemplateFormats('tsm');
  eleventyConfig.addExtension('tsm', {
    outputFileExtension: 'html',
    compile: async function (inputContent) {
      const { html, diags, ok } = await renderTsm(inputContent);
      if (!ok) throw new Error('tsm render failed:\n' + diags);
      if (diags.trim()) console.warn('[tsm]', diags.trim());
      // self-contained: semantic article + embedded source + hydration call
      const src = inputContent.replace(/<\/script/gi, '<\\/script');
      const body = `<article class="post" id="tsr-root">\n${html}</article>
<script type="text/plain" id="tsr-src">${src}</script>
<script type="module">
import { createEngine } from '${ENG}/runtime/src/main/shell.mjs';
const el = document.getElementById('tsr-root');
createEngine().typeset(document.getElementById('tsr-src').textContent, el, {
  fontFamily: '"Crimson Text", Georgia, serif',
  cjkFontFamily: '"Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", serif',
  // declared fonts (pages-design.md §1): the worker loads these into its own
  // FontFaceSet before measuring — measure == paint, no settle to observe.
  // CJK stays a paint-side webfont: hanzi advances are 1em in every face.
  fonts: [
    { family: 'Crimson Text', src: '/fonts/crimson-400.woff2' },
    { family: 'Crimson Text', src: '/fonts/crimson-400i.woff2', style: 'italic' },
    { family: 'Crimson Text', src: '/fonts/crimson-700.woff2', weight: '700' },
  ],
  progressive: false,
}).catch((e) => console.warn('tsr hydrate failed; static page stands', e));
</script>`;
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
