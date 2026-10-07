# zball.io

个人博客：内容为 `.tsm`（[Typesetter](https://github.com/zball-bz/Typesetter) 标记语言），
Eleventy 3 驱动站点骨架，Cloudflare Workers 静态托管。

- 构建期：`.tsm` → 语义 HTML（编号 / 引用 / tree-sitter 高亮全静态）
- 浏览器端：渐进升级为引擎排版渲染（KP 断行、中西混排、公式、插图环绕）
- 引擎以滚动工件接入（`scripts/fetch-engine.mjs` ← Typesetter 的 `engine-dist` release）

## 日常

```sh
npm ci
node scripts/fetch-engine.mjs         # 或 --local（从 ../Typesetter 打包）
npx @11ty/eleventy --serve            # 本地写作
git push                              # CI 构建并部署到 zball.io
```

写文章：`src/posts/xxx.tsm`，front matter 需 `title` 与 `date`；英文译文放在同目录的
`xxx.en.tsm`（无 front matter），与原文同页切换。文档语言由引擎判定（文档自己的
`$.doc({lang})`，否则按正文检测）。

站点给引擎的设置（字体、按语言追加的设置如中文段首缩进）在 `eleventy.config.js` 的
`SITE` / `BY_LANG`，构建与浏览器端用同一份；引擎的样式表（渲染契约、主题、各文档的规则）
随页面输出，不在 `base.njk` 里手写。
