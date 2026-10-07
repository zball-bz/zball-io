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

字体都自托管在 `public/fonts`：正文 Crimson Text，代码 IBM Plex Mono（SIL OFL 1.1，授权见 `public/fonts/IBM-Plex-OFL.txt`）；
它们同时声明给引擎（`lib/tsr.mjs` 的 `FONTS`），排版测量与页面绘制用的是同一批文件。

站点给引擎的设置（字体、按语言追加的设置如中文段首缩进）在 `lib/tsr.mjs` 的
`SITE` / `BY_LANG`，构建与浏览器端用同一份；引擎的样式表（渲染契约、主题、各文档的规则）
随页面输出，不在 `base.njk` 里手写。

## 书

需求与约定见 [`docs/books.md`](docs/books.md)，实现在 `lib/books.mjs`。第一本是《Typesetter 使用手册》（`books/typesetter` ← [zball-bz/typesetter-book](https://github.com/zball-bz/typesetter-book)），即原来的 `/docs/`；旧地址由 `public/_redirects` 跳转。克隆后 `git submodule update --init`。

- 每本书是一个 Typesetter 工程（`tsm.project.json` 加一个 `book` 块），放在自己的公开仓库里，
  以 submodule 挂在 `books/<slug>/`。submodule 指针指向的提交就是线上版本：
  `git submodule update --remote books/<slug>`，提交并 push 即发布；也可以在 Actions 里手动触发
  `book-update`（输入 slug）。
- 本地写作：`ZB_BOOK_<slug>=~/path/to/book npx @11ty/eleventy --serve`（slug 里的 `-` 写成 `_`），
  或者写一个不入库的 `books.local.json`（`{"<slug>": "<path>"}`）。书根下的文件一改，这本书就重新渲染。
- 页面：`/books/` 是书目；`/books/<slug>/` 是书的 `index.tsm`；`/books/<slug>/<key>` 是各章。
  书里引用的文件（图片、`#use` 模块及其 import、参考文献）复制到 `/books/<slug>/` 下的同一相对路径。
- 构建失败的条件：任何文档渲染出错；资源用了站点根路径或指向书根之外；首页有带编号的标题；
  已发布的章里有未解析的引用、缺失的资源、重复的标签，或加载失败的模块。草稿章只给警告。
- 阅读：左侧是全书目录（来自引擎的 `contents` 产物），正文栏 40em；全站的站内链接都在页内切换，取目标页、排好再换上，没有闪烁（`lib/client/zb.mjs`，详见 `docs/books.md` §9）。
- `test/book/` 是验收用的测试书，不发布；CI 每次都用它构建一遍（输出不部署）：
  `ZB_BOOK_test=test/book npx @11ty/eleventy --output=/tmp/books-check`。
