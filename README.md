# DSH-Search-Contrl

**给 DeepSeek Harness 用的「主题搜索 + 中文报告」技能/插件。3.0 起不再默认科技：先问你要什么主题，再挑对应的源和板块。**

`3.0.0-beta.1` · 需要 DSH `>= 0.2.0` · Node.js `>= 20` · MIT

---

## 它是什么

DSH-Search-Contrl 是一个装进 DSH 的**技能（skill）+ 设置页插件**。装上之后，你跟 DSH 说「发日报」「这周 AI 圈发生了什么」「盯一下这几个博主的更新」，它会：

1. **先读设置**（主题、标题模板、输出方式、字数、博主、Cookie 状态）；
2. **确认主题**——设置里没有主题时，它不会自作主张选科技，而是先反问你；
3. **按主题选源**：内置 10 个主题预设（科技 / 财经 / 汽车 / 体育 / 娱乐 / 医疗健康 / 游戏 / 时政政策 / 能源 / 科学），每个预设带检索词种子、可信站点域名、RSS 源和报告板块正则；没命中的主题它会自己找站点，并在报告里说明；
4. **采集 + 校验 + 排版**，输出中文报告（表格或分条），带上博主最新动态、链接校验结果和条数统计。

设置页在 **设置 → 搜索控制**，所有选项都即时保存、可回退。

## 为什么值得装

| 优点 | 具体表现 |
| --- | --- |
| **不预设主题** | 2.x 抓的天天是科技 RSS；3.0 的默认路径是「问主题 → 按主题选源」。你搜足球就只出足球。 |
| **标题你说了算** | 报告标题是模板 `{主题}{类型}｜{日期}`，可改成 `{日期} · {主题}晚报` 之类；设置页有实时预览。 |
| **源是挑过的，不是堆的** | 14 条 RSS 都实测过条目数（IT之家 60 / Electrek 81 / 极客公园 29 …），按主题分配，未知主题不硬凑。 |
| **采集快，且可复跑** | 有界并发（默认 5）+ 源缓存（10 分钟）。7 天窗 14 源实测：冷跑 2.66 s → 热跑 26–28 ms。 |
| **不再白跑** | undici 的 `assert(!this.paused)` 断言会在 socket 回调里炸掉整个进程；进程级兜底 + 45 s 看门狗之后，实测连跑 12 次全部正常收尾，个别源超时会被降级记录而不是丢结果。 |
| **审计不撒谎** | `--audit` 会按你要的窗口逐天列出条数，缺的 5 天就写「缺失」，而不是只看有数据的那几天报「✅ 覆盖正常」。 |
| **设置页和官方一致** | 分区 + 行 + 开关 + 底部保存条，样式走 DSH 设计令牌（`--dsw-alias-*`），并保留历史版本回退。 |
| **离线可测** | 6 套不联网的测试共 87 条断言（设置 / 预设 / 客户端 / Cookie / 博主 / 指标），`pnpm test` 一把过。 |

## 三分钟上手

```bash
cd <你的 DSH profile 目录>
pnpm add dsh-search-contrl
```

重启 DSH → 打开 **设置 → 搜索控制** → 看到页面就装好了。然后直接对 DSH 说：

> 发一份 AI 日报

- 设置里**没有**主题：它会先问你「这次报告主题是什么？」并顺手问要不要存进设置；
- 设置里**有**主题：它直接用第一个启用的主题开工；
- 报告交付后，如果这个主题是临时说的，它会再问一次要不要加入设置，方便下次一句话直达。

---

## 安装

### 方式一：npm（推荐）

```bash
# 在 DSH profile 目录执行：不带版本号 = 装 registry 上的 latest
pnpm add dsh-search-contrl
# 或
npm install dsh-search-contrl
```

| 需求 | 命令 |
| --- | --- |
| 装最新版 | `pnpm add dsh-search-contrl` |
| 升到最新版 | `pnpm add dsh-search-contrl@latest` |
| 装 3.0 测试版 | `pnpm add dsh-search-contrl@3.0.0-beta.1` |
| 看有哪些版本 | `npm view dsh-search-contrl versions` |
| 锁定某一版 | `pnpm add dsh-search-contrl@2.2.18` |

发布走 GitHub Actions 的 OIDC trusted publishing，registry 上的 `latest` 指向最新一次成功发布；`node_modules/dsh-search-contrl/package.json` 的 `version` 就是当前装到的版本。

> `3.0.0-beta.1` 是 **beta**：功能完整、测试全绿，但设置页形态和技能话术可能还会调整。想要稳定版请留在 `2.2.18`。

### 方式二：从 git / tarball 安装

```bash
pnpm add https://codeload.github.com/ysyXH-0827/dsh-search-contrl/tar.gz/refs/heads/main
```

或在 profile 的 `package.json` 里写：

```json
{ "dependencies": { "dsh-search-contrl": "github:ysyXH-0827/dsh-search-contrl" } }
```

### 方式三：本地目录（开发调试）

把仓库放到 profile 目录**内部**，再链接：

```json
{ "dependencies": { "dsh-search-contrl": "link:./plugins/dsh-search-contrl" } }
```

```bash
pnpm install
```

> 必须放在 profile 目录内部：插件依赖 `@deepseek-ai/schemastery`，Node 要从插件目录向上找到 profile 的 `node_modules`，否则 `ERR_MODULE_NOT_FOUND`。

### 登记到 bundles

不论哪种装法，都要让 profile 知道要加载它：

```json
{
  "dependencies": { "dsh-search-contrl": "latest" },
  "dsh": { "profile": { "bundles": ["...", "dsh-search-contrl"] } }
}
```

插件自带 `cordis.patch.yml`（`id: search-contrl`），安装后会自动插入插件行。要自定义 Host 侧配置，在 profile 的 `cordis.patch.yml` 里加：

```yaml
- id: search-contrl
  name: dsh-search-contrl
  config:
    tavilyApiKey: ""
    searchDepth: basic
    maxResults: 8
    timeoutMs: 45000
```

改完配置需**重启 profile**；只改设置页里的选项不需要重启。

### 升级 / 回退 / 卸载

- 升级：`pnpm add dsh-search-contrl@latest` 后**重启 DSH**（客户端 bundle 是启动时注入的）。
- 回退：`pnpm add dsh-search-contrl@2.2.18`；设置文档向前兼容，3.0 新加的 `reportTitle` 在 2.x 里会被忽略。
- 卸载：从 `dependencies` 和 `dsh.profile.bundles` 移除，`pnpm install`，重启。设置在 `~/.dsh/plugin-data/dsh-search-contrl/`，需要的话手动删。

---

## 3.0 有什么不一样

| 变化 | 2.2.x | 3.0 |
| --- | --- | --- |
| 默认主题 | 科技（14 条科技/车 RSS 全量跑） | **无**：先问主题，再按预设选源 |
| 报告标题 | 技能正文写死「标题必须带科技二字」 | 设置里的模板，占位符 `{主题}` `{类型}` `{日期}` |
| 科技源 | 采集脚本里硬编码 | 移入「科技 / 汽车 / 科学」预设，选到才用 |
| 设置页 | 7 个页签（tdr-tabs 风格） | 官方风格分区 + 行 + 底部保存条，新增「报告标题」分区 |
| 主题表 | 无 | 10 个预设：别名正则、关键词、域名、检索词、RSS、板块 |

升级注意：

1. 老设置文件不需要手工迁移，`reportTitle` 缺失会自动补默认模板。
2. `topics` 为空时，第一次「发日报」会**先反问你**——这是 3.0 的设计，不是坏了。
3. 之前写死的「科技」标题不再出现；想要科技报告就建一个「科技」主题（或直接说「AI 日报」，预设会匹配到科技）。

---

## 设置页逐项说明

路径：**设置 → 搜索控制**。改完点底部的「保存」（有改动时按钮才可用），保存会同时写一份历史快照。

### 1. 报告标题

- **控件**：模板输入框 + 三个占位符按钮（点一下插到光标处）+ 实时预览。
- **占位符**：`{主题}`、`{类型}`（按窗口自动判断：1 天日报、7 天内周报、更长月报）、`{日期}`。
- **默认**：`{主题}{类型}｜{日期}` → 主题「AI」、当天 → `AI日报｜2026-10-30`；主题为空时自动去掉多余分隔符 → `日报｜2026-10-30`。
- **上限**：120 字符；清空则回落到默认模板（不会只剩一个日期）。
- **影响范围**：技能正文的标题行、`scripts/daily-collect.mjs` 的摘要与归档、`scripts/archive-digest.mjs` 的素材标题，全部用同一份模板。

### 2. 报告输出方式

- **交付方式**：
  - 只给文件——把报告写进 `reports/`，聊天里只说路径；
  - 只在聊天中呈现——不落盘，适合随手看一眼；
  - 文件 + 聊天——两份都给（长报告推荐）。
- **排版**：`表格`（默认，事件表 + 链接列）或 `分条`（每条一段，适合手机看）。
- **事件密度**：`large` / `medium`（默认）/ `small`，对应每个板块最多 6 / 10 / 14 条。板块太多说明抓太宽，可以调小。

### 3. 主题

每条主题有四个字段：

| 字段 | 作用 |
| --- | --- |
| 名称 | 报告标题里的 `{主题}`，也是匹配预设的第一依据 |
| 预设 | 可手工指定（如「科技」），留「自动匹配」则按名称 → 关键词 → 域名依次猜 |
| 关键词 | 检索词种子；多个主题时也用来判断用户这句话在说哪个主题 |
| 域名 | 想只在这些站点里搜时填；不填就用预设的域名表 |

- 右侧开关控制是否参与「自动选择第一个主题」；关掉的主题仍可被点名使用。
- 没配置任何主题时，页面会提示「报告先问主题再检索」——这正是 3.0 的默认行为。
- 预设匹配不到时不会报错：技能会自选站点检索，并在报告的检索说明里写明用了哪些站点。

### 4. 搜索源

| 类型 | 说明 | 需要密钥 |
| --- | --- | --- |
| Bing 免费通道 | 默认可用，走 Bing 的 RSS 输出，条数有限 | 否 |
| Tavily | 有 AI 摘要和更长的正文提取，`searchDepth` 可选 basic / advanced | 是（`tavilyApiKey`） |
| 指定站点 | 把检索限制在某个域名内（等价于 `site:`），适合盯一家媒体或一个公告库 | 否 |

- 每条源可单独开关；关掉的源不会出现在检索计划里，但保留在文档中，随时开回来。
- 「指定站点」只填域名即可（粘整条 URL 会被自动截成主机名）。

### 5. 博主

- 粘贴博主主页链接，插件按 15 个平台规则识别（B站 / 微博 / 知乎 / X / YouTube / 抖音 / 快手 / 小红书 / GitHub / Medium / Substack / CSDN / 掘金 / 少数派 / 公众号），自动得出平台与账号句柄。
- 「预览查询」会显示这条链接实际会发出什么查询，避免写错名字白跑。
- 博主动态支持一次读多个（`action: "bloggers"`），可配 `deep` 与 `concurrency`。

### 6. 附带要点与字数

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| 显示原链接 | 开 | 每条动态附原文链接，便于核对 |
| 显示要点 | 开 | 给每条动态加一句摘要 |
| 要点字数（微博） | 20 | 10–200，按 20 字挡位 |
| 要点字数（B站） | 50 | 同上 |
| B站平台 AI 总结 | 开 | B 站有 AI 总结接口时优先取，取不到再退回要点；空结果不缓存 |

### 7. 登录 Cookie

需要登录态的内容（B 站视频与字幕、微博正文、知乎专栏、小红书笔记、抖音列表、X 推文、YouTube 字幕、GitHub 私有仓库）靠这里的 Cookie 抓。

| 站点 | 关键 Cookie | 用来做什么 |
| --- | --- | --- |
| B站 | `SESSDATA` | 博主最新视频、视频信息、AI 总结与字幕 |
| 微博 | `SUB` | 博主最新微博 |
| 知乎 | `z_c0` | 问答与专栏正文 |
| 小红书 | `web_session` | 博主笔记与正文 |
| 抖音 | `sessionid` | 博主视频列表 |
| X | `auth_token` | 博主最新推文 |
| YouTube | `SID` / `SAPISID` / `LOGIN_INFO` | 频道视频列表与字幕 |
| GitHub | `user_session` | 仓库、issue 与 release |

用法：点「开始登录」→ 弹出浏览器窗口 → 正常登录一次 → 页面显示「已捕获」→ 关窗口。全程只在本机：Cookie 落在 `~/.dsh/plugin-data/dsh-search-contrl/`，不上传、不写日志；设置页只显示掩码。

### 8. 历史版本

- 每次保存都会把**被替换的**那一版存成快照，页面列出时间与摘要。
- 点「回退」即恢复该快照（回退本身也会写一条快照，所以回退也能撤）。
- 快照数量受 `historyLimit` 限制（默认保留近若干份）。

---

## 报告长什么样

```
# AI日报｜2026-10-30

- 主题：AI（预设 tech）
- 窗口：2026-10-29 → 2026-10-30
- 源：10 个 RSS + 3 组检索

## 国内 AI

| 时间 | 事件 | 链接 |
| --- | --- | --- |
| 10-30 09:12 | … | https://… |
```

- 板块来自主题预设（科技 9 块：国内 AI / 国际 AI / 芯片半导体 / 国内手机 / 国内车型 / 国际车型 / 航天与科学 / 网络安全 / 产业政策）；预设没有板块时输出一张平铺候选表，不硬造板块名。
- 输出两层：主事件（确定影响面）+ 中等事件（值得知道但不必展开）。
- 每条外链可交给 `scripts/verify-links.mjs` 校验，24 小时磁盘缓存，76 条链接冷跑 2.2 s、热跑 9 ms。

## 命令行脚本

随包发布，装在 `node_modules/dsh-search-contrl/scripts/`：

| 命令 | 作用 |
| --- | --- |
| `node scripts/daily-collect.mjs --days=7 --digest` | 采集 + 紧凑摘要（默认就只吐摘要；要整份 JSON 加 `--json`） |
| `--topic=汽车` / `--presets` | 指定主题 / 列出 10 个预设与它们的源、板块 |
| `--archive` | 按天落 `reports/_data/archive/<day>.json`（幂等，含全部条目供补跑） |
| `--audit` | 逐天覆盖度审计：缺哪天就写「缺失」，并给连续覆盖天数 |
| `--refresh` / `--cache-ttl=600` | 绕过 / 调整源缓存 |
| `node scripts/archive-digest.mjs --window=all` | 从归档快照生成素材表（标题同样走 `reportTitle`） |
| `node scripts/watchlist.mjs` | 管理跨期关注列表 |
| `node scripts/archive-merge.mjs` / `archive-pull.mjs` | 合并快照 / 从 CI 拉回归档 |
| `node scripts/report-metrics.mjs <md>` | 报告体量与 token 估算 |

## 数据落在哪

| 路径 | 内容 |
| --- | --- |
| `~/.dsh/plugin-data/dsh-search-contrl/settings.json` | 设置 |
| `~/.dsh/plugin-data/dsh-search-contrl/history/` | 历史快照 |
| `~/.dsh/plugin-data/dsh-search-contrl/cache/` | 检索/提取的磁盘缓存（`DSH_SEARCH_CONTRL_NO_DISK_CACHE=1` 可关） |
| `~/.dsh/plugin-data/dsh-search-contrl/cookies*` | 登录态（本机文件） |
| `reports/` | 报告与 `_data/archive/` 快照 |

## 常见问题

**「发日报」却先问我主题？** 3.0 的设计：没有主题就不猜。回答一次后可以顺手存进设置，下次一句话直达。

**标题里出现了「日报」但我想要周报？** `{类型}` 按窗口长度自动判断（1 天 / 7 天内 / 更长），把 `{类型}` 从模板里删掉就不会出现。

**主题匹配到了错的预设？** 在「主题 → 预设」里手工指定，比依赖自动匹配稳。

**输出方式保存后又变回「只给文件」？** 页面会用响应回显校验；如果提示「被正在运行的旧版本服务端丢弃了」，说明 DSH 里跑的还是旧插件，重启即可。

**检索太慢？** 先看是不是开了 Tavily `advanced`；采集侧可以把 `--concurrency` 调到 6–8，Bing 免费通道遇到 429 建议串行复测。

**Cookie 点了没反应？** 确认浏览器能正常登录该站点；企业网络/代理下捕获窗口可能连不上，先关代理再试。

## 开发与测试

```bash
pnpm run check    # 31 个文件的 node --check
pnpm test         # 6 套离线测试，87 条断言
pnpm run prepack  # 打包前自检：lib 全量语法 + client bundle + patch 存在
```

| 测试 | 断言 | 覆盖 |
| --- | --- | --- |
| `test-settings.mjs` | 27 | 设置归一化、标题模板、历史快照、桥接鉴权与路由 |
| `test-presets.mjs` | 11 | 标题渲染、10 个预设的源/板块、域名匹配、设置往返 |
| `test-client.mjs` | 6 | 客户端模块加载、slot 注册、设置卡渲染、旧服务端守卫 |
| `test-cookie.mjs` | 32 | Cookie 罐、掩码、站点规则 |
| `test-bloggers.mjs` | 6 | 博主链接解析与查询构造 |
| `test-metrics.mjs` | 5 | 报告体量与 token 估算 |

## 目录结构

```
lib/
  index.js           # 技能注册 + apply：读设置、注册检索工具与设置路由
  client.js          # 设置页（window.__ModuleLoader__ 客户端 bundle）
  report-title.js    # 标题模板：占位符、渲染、长度约束
  topic-presets.js   # 10 个主题预设：别名/关键词/域名/检索词/RSS/板块
  settings-store.js  # 设置文档：归一化、快照、回退
  settings-api.js    # 本机 HTTP 桥接：describe/save/rollback/preview/cookie
  search-tool.js     # 检索工具 + 内存/磁盘双层缓存
  custom-search.js   # 主题/博主查询构造与结果过滤
  bing.js tavily.js  # 两个检索通道
  bilibili-api.js    # B 站接口（视频、AI 总结、字幕）
  cookie-jar.js cookie-capture.js  # Cookie 存储与浏览器捕获
  config.js          # Host 侧配置 schema
scripts/             # 采集、归档、校验、测试（见上表）
cordis.patch.yml     # bundle patch：声明插件行
```

## 设计原则

- **设置是唯一的真相**：技能正文不做假设，先读 `settings.json`。
- **不猜主题**：主题缺失就反问，宁多一句也不出一份跑偏的报告。
- **空则不编**：没有源就说明「无内置 RSS，本次靠检索」；没有板块就平铺候选表。
- **数据留在本机**：Cookie 与缓存只写本机文件，不上传。
- **可测**：所有纯逻辑（标题、预设、归一化、查询构造）都有离线断言。

## 许可证

MIT © ysyXH-0827
