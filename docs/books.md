# 书籍栏目：需求

状态：第一阶段已实现（实现记录见 §8） · 2026-10-07
第一个用户：《任意精度算术》（书仓库 `zball-bz/apa`，书名与仓库名待定稿）

## 1. 目标

zball.io 要能发布由多个 `.tsm` 文档组成的书：
- 章与章之间可以互相引用，编号跨章连续；
- 每章一页，书有自己的首页；
- 书的源码在独立的公开仓库里，以 git submodule 挂进本仓库，submodule 指针所指的提交就是线上版本。

原则：
- **站点不理解书的内容。** 目录、编号和引用格式都由引擎和书自己决定。站点只做一件事：把一个 Typesetter 工程变成一组页面。
- **同一本书到哪里都一样。** 同一份源码在 VS Code 预览、`tsm-project.mjs build` 本地导出和 zball.io 上，解析出的引用和资源都相同。
- **不止一本书。** 书名、路径都不写死。

## 2. 书仓库的约定（站点依赖的接口）

书仓库的根目录就是**书根**：

```
tsm.project.json     工程文件：Typesetter 的标准字段，外加一个 book 块
index.tsm            书的首页（书名、简介、目录），也是工程的一员
<key>.tsm            每章一个文件，平铺在书根下；key 就是文件名，也是 URL 的一段
fig/ lib/ data/ …    资源；文档里一律用相对路径引用（fig/x.svg、#use("lib/book.mjs")）
```

- **布局**：章节平铺、只用相对路径。这和 Typesetter 静态导出的布局一致（导出时各章平铺为 `<key>.html`），所以同一个相对路径在 VS Code 预览、本地导出和 zball.io 三处指向同一个文件。
- **key**：用稳定的英文短名（如 `machine`、`mul-fft`），不带序号。调整章序不会改变 URL。
- **标签**：全书唯一。章标题和节标题都带标签，作为稳定锚点。

`tsm.project.json`：

```jsonc
{
  "files": ["index.tsm", "preface.tsm", "intro.tsm", "machine.tsm", "…"],  // 书序
  "continue": ["heading", "figure", "table", "equation"],
  "settings": { },                    // 可选：书自己的设置，叠在站点设置之上
  "book": {
    "title": "任意精度算术",
    "subtitle": "算法、实现与接口",     // 可选
    "lang": "zh",                     // 站点据此追加按语言的设置（BY_LANG）
    "status": { "intro": "published", "machine": "draft" },   // 未列出的章 = draft
    "parts": [                        // 可选，供面包屑使用
      { "title": "基础", "chapters": ["intro", "machine", "repr", "measure"] }
    ]
  }
}
```

- **`index` 文档**：key 固定为 `index`。目录由书自己写，或由书仓库里的工具生成。目录项用 `#ref` 引用各章，编号和链接由引擎给出，**站点不生成目录**。`index` 不能有带编号的标题，以免占用章号（有则构建失败）。
  - `#ref` 的 `full` 形式只给编号（“§2”）。要“编号 + 标题”，就在 `index` 里给标题声明一个引用形式：
    `#{ $.element('heading', {forms: {toc: [slot('supplement'), slot('number'), ' ', slot('title')]}}) }`，
    目录项写 `#ref("ch-a", {form: "toc"})`，得到“§1 第一章”。
  - 不编号的章（前言）：标题后写 `#counterUpdate("heading", {add: -1})`，它就不占章号；引用它时用 `{form: "title"}`。
  - `index` 的状态默认为 published（它不是章；`status.index` 可以改）。
- **设置中站点掌管的部分**：书的 `settings` 里如果出现 `fonts` 或 `render`，站点忽略它们，并给出警告。

## 3. 站点需求

### R1 发现
- 每本书是 `books/<slug>/` 下的一个 submodule，`<slug>` 就是目录名，书根就是这个目录。构建时遍历 `books/*/tsm.project.json`。
- **本地写作覆盖**：用环境变量 `ZB_BOOK_<slug>=<path>`（或一个不入库的 `books.local.json`），让某本书从别处的工作副本读取，比如 `~/bigint/libsbn_v3/book`。这样不必先提交，也不必先更新 submodule。
- `eleventy --serve` 要监视书根下的 `.tsm` 文件、`tsm.project.json` 和资源；有变化时重新渲染这本书。

### R2 渲染
- 用 Typesetter 的 `renderProject`（`vendor/typesetter/runtime/src/node/project.mjs`）渲染整本书。
  - 设置：`SITE` ⊕ `BY_LANG[book.lang]` ⊕ 书的 `settings`（去掉 `fonts` 和 `render`）。
  - 其他参数：`fonts: FONTS`，`baseDir` 和 `rootDir` 都是书根。
  - 语言由 `book.lang` 声明，所以不必像文章那样先检测语言、再渲染第二遍。
- `urls`：`index` 对应 `/books/<slug>/`，其他 key 对应 `/books/<slug>/<key>`。
- 一次构建中每本书只渲染一遍（放进全局数据，或用带缓存的函数），各页从结果中取自己的 bundle。

### R3 页面与 URL

| URL | 内容 |
|---|---|
| `/books/` | 书目：书名、副标题、已发布的章数 |
| `/books/<slug>/` | `index` 文档 |
| `/books/<slug>/<key>` | 一章；文件是 `<key>.html`，由 `auto-trailing-slash` 以无扩展名的 URL 提供 |
| `/books/<slug>/<相对路径>` | 书的资源，与书根下的相对路径一一对应 |

- **章页**：
  - 面包屑：书名 › 部分名。
  - 正文。
  - 上一章／下一章：按 `files` 的顺序，跳过 `index`。
  - 打印按钮：沿用现有的。
  - `<title>`：章标题 · 书名 · zball。
- **draft 章**：页首显示“草稿”横幅，并加 `<meta name="robots" content="noindex">`。
- **站点导航**：增加“书”，指向 `/books/`（有书时才显示）。
- **开发服务器**：要能解析无扩展名的章 URL，和线上行为一致；必要时加 middleware。

### R4 浏览器端
- 沿用文章页的 hydration，额外传入 `inputs: { labels: <其他文档的 manifest 组成的 JSON 数组> }`。做法同 `Typesetter/tools/tsm-project.mjs`。settings 用 bundle 解析后的设置，其中已含 `project.*`。
- 文档里的相对资源（`#use` 模块、参考文献、图片）在浏览器端按页面 URL 解析，都落在 `/books/<slug>/` 之下。R5 保证这些文件在那里。
- **深链接**：`/books/<slug>/<key>#<id>` 无论在静态页还是排版完成后，都要落到目标位置。

### R5 资源
- **复制哪些文件**：以各文档 bundle 的资源清单（`bundle.resources`，包括图片、`#use` 模块、参考文献等）为准。把书根下被引用的文件复制到 `/books/<slug>/` 下的对应路径。
- **MIME**：`.mjs` 要以 JavaScript MIME 提供。
- **路径限制**：书里出现站点根路径（`/…`），或指向书根之外的路径，构建失败。书必须能脱离本站独立成立。
- **退路**：如果按清单复制难以实现，可以改用 `book.assets` 目录白名单，但仍要校验每个被引用的文件都存在。

### R6 构建失败的标准
- 任何文档渲染出错，构建失败（与文章相同）。
- **published 章**：出现未解析的引用、缺失的资源，或跨章重复的标签，构建失败。
- **draft 章**：只打印警告，沿用 `report()` 的汇总格式。

### R7 CI 与发布
- `deploy.yml` 的 checkout 加 `submodules: true`。书仓库是公开的，不需要密钥。
- **发布**就是在本仓库更新 submodule 指针并 push。
- 可选：增加一个 `workflow_dispatch` 工作流，执行 `git submodule update --remote books/<slug>` 并提交。

## 4. 第二阶段

- **订阅**：章节从 draft 变为 published 时进入 feed。日期记在 `book.published: { key: date }`。
- **英文版**：`<key>.en.tsm` 与原文在同一页切换，和文章页相同。
  - 英文作为第二个工程渲染，设 `render.idPrefix: "tsr-en-"`。
  - hash 指向隐藏语言里的元素时，自动切换到该语言。
  - 英文编号必须与中文一致；译文缺章时编号会错位。这需要 `renderProject` 接受外部给定的 `starts`（见 §5 T1）。
- **增量**：`--serve` 下按内容哈希缓存，没有变化的书不重新渲染。

## 5. 依赖 Typesetter 的点

- **T1**（第二阶段）：`renderProject` 接受外部给定的 `starts`，让一个工程沿用另一个工程的编号。
- **T2**（可选）：引擎导出带编号的大纲，供站点日后生成章内目录侧栏。现有的 `outline` 产物出自 Compile 阶段，不带编号。
- **已确认**：
  - `project.urls` 里形如 `/books/…` 的路径能通过链接策略，静态页和排版后的链接都是 `/books/<slug>/<key>#tsr-<label>`。
  - 跨章链接的锚点使用本文档的 `idPrefix`；第一阶段全书同为 `tsr-`，没有问题。第二阶段英文版用 `tsr-en-` 时，链到另一章的锚点也会是 `tsr-en-…`，与对方英文页一致。
  - `index` 不写编号标题（标题用 `#strong[…]` 之类）；前言用 `#counterUpdate("heading", {add: -1})`（见 §2）。引擎没有“不编号标题”的写法，这是可用的替代。
- **已在 Typesetter 完成**（`books-2026-10`，见 §8）：
  - 资源清单列出 `#use` 模块自己 import 的文件（requester `import`），站点据此复制，否则浏览器端会缺文件。
  - 清单的每条加上 `ref`（文档里的原始写法），站点据此识别加载用了站点根路径 `/…`。

## 6. 不做

整本书的 PDF、站内搜索、评论。

## 7. 验收

结果见 §8。

准备一本最小测试书，不发布，通过 `ZB_BOOK_<slug>` 挂进构建，覆盖以下各项：
1. 两章互相引用，链接落到对方页面的正确锚点；第 2 章的编号接着第 1 章。
2. `index` 的目录项是引擎格式化的编号和标题。
3. 图片、`#use` 模块和参考文献在静态页和排版后都加载成功，没有 404。
4. draft 章显示横幅并带 noindex；在 published 章里放一个坏引用时，构建失败。
5. 本地覆盖变量生效；`--serve` 下改动一章后页面刷新。
6. CI 拉取 submodule 后构建通过。

## 8. 实现记录（第一阶段，2026-10-07）

**文件**
- `lib/books.mjs`：发现、渲染、校验、资源。`lib/tsr.mjs`：从 `eleventy.config.js` 抽出的、文章和书共用的引擎接入部分（设置、字体、样式、水合）。
- `src/books/index.njk`（书目）、`src/books/pages.njk`（每个文档一页，分页于 `books.pages`）、`src/books/books.11tydata.js`。
- `src/_includes/base.njk`：导航“书”、`<meta name="robots">`、书页样式。
- `.github/workflows/deploy.yml`：`submodules: true`；先用测试书构建一遍（输出不部署）；PR 只构建不部署。`.github/workflows/book-update.yml`：R7 的可选工作流。
- `test/book/`：验收用的测试书。

**实现中的决定**
- 发现：`books/<slug>/` 与 `books.local.json`、`ZB_BOOK_<slug>` 合并，后两者覆盖前者。`ZB_BOOK_my_book` 也覆盖 `books/my-book`（shell 变量名里没有 `-`）。`books/<slug>/` 是空目录（submodule 未检出）时，本地只警告并跳过，CI 里构建失败。
- 渲染：设置为 `SITE` ⊕ `{doc: {lang: book.lang}}` ⊕ `BY_LANG[book.lang]` ⊕ 书的 `settings`（去掉 `fonts`、`render`，并给出警告）。`fonts: FONTS` 通过 `renderProject` 的 `render` 参数传入。
- 一次构建内每本书只渲染一遍；`--serve` 下按书根下文件的大小和修改时间判断是否变化，没变就沿用上次结果（第二阶段“增量”的一部分）。
- 失败标准：已发布章里的 `use-module`、`labels-import`（模块、标签文件没加载到）也算“缺失的资源”。参考文献加载失败本来就是错误。站点根路径、书根外的路径、指向书外的符号链接、首页的编号标题，不论草稿与否都让构建失败。
- 深链接：排版完成后，若 `location.hash` 指向本文档里的元素，就滚回它（引擎把滚动锚定留给宿主）。
- 顺带修正：语言偏好只在点切换按钮时记住，打开一个只有中文的页面不再覆盖读者选过的 EN。

**验收（§7）**
1. 第一章的 `@sec-b1`、`@eq-b` 链到 `/books/test/beta#tsr-sec-b1`、`#tsr-eq-b`，点击后落到目标处；第二章的式号是 (2)，接着第一章的 (1)；标题编号 §1、§2 连续。✓
2. 首页目录是引擎给出的“§1 第一章”“§2 第二章”“§3 第三章”，静态页与排版后一致。✓
3. 图片、`#use` 模块及其 import 的 `lib/util.mjs`、参考文献：静态页和排版后都没有 404（模块的 `$.set` 生效、参考文献列出）。深链接 `/books/test/beta#tsr-eq-b` 在静态页和排版后都在视口内。✓
4. 草稿章有横幅和 `noindex`；已发布章里放一个坏引用、缺图、重复标签、站点根路径或书外路径时，构建失败并指出文件和原因；同样的问题放在草稿章里只给警告。✓
5. `ZB_BOOK_<slug>`、`books.local.json` 生效；`--serve` 下改动书外工作副本里的一章，打开的页面自动刷新出新内容，改文章时书不重新渲染。✓
6. 本地用一个 git 仓库作 submodule 挂到 `books/demo`，构建通过；`book-update` 的脚本逻辑（移动指针、提交、已是最新时不提交、拒绝非法 slug）在本地跑通。CI：PR #1 的构建（run 37587211678）检出 submodule、用测试书构建出 5 页、构建站点，全部通过，部署按设计跳过。Typesetter 侧的改动在分支 `books-2026-10` 上 CI 全绿（run 37587172485）。✓

**待用户决定**：Typesetter 的 `books-2026-10` 快进到 main（CI 随后发布带新清单的 engine-dist），然后合并 PR #1（即部署）。在此之前，线上的 engine-dist 不列出模块的 import、也不带 `ref`：站点照样能构建，只是不会复制模块自己 import 的文件，也查不出加载用了站点根路径。
