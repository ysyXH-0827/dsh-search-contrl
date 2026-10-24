# dsh-search-contrl

一个 DSH 插件，为 [DSH (DeepSeek Harness)](https://github.com/) 注册「DSH-Search-Contrl」技能：检索并生成中文日报、指定日期范围的日报，或一周科技新闻总结。

仓库：<https://github.com/ysyXH-0827/dsh-search-contrl> · 设置入口：DSH 设置 → 侧边栏「搜索控制」


## 登录 Cookie（设置 → 搜索控制 → 登录 Cookie）

平台 API（例如 B站空间、AI 视频总结）需要登录态才回答，搜索引擎只能看到收录页。这个页签把「登录」这一步做成三步点击，不需要复制粘贴 Cookie：

| 步骤 | 动作 | 背后发生什么 |
|---|---|---|
| 1 | 点「获取 Cookie」 | Host 用**独立临时 profile** 启动 Chrome/Edge，打开该站登录页（不碰你日常浏览器数据） |
| 2 | 你在窗口里正常登录 | Host 每 1.5 秒通过 DevTools 协议读一次 Cookie |
| 3 | 检测到登录 Cookie 即关窗 | 只保留证明登录态的那几项，写入本机 `cookies.json`，并删除临时 profile |

安全边界：

- Cookie 值**永不回传页面**，设置页只显示名字、数量和保存时间（`前2***后2` 掩码）。
- 文件权限 `0600`，位置 `~/.dsh/plugin-data/dsh-search-contrl/cookies.json`。
- 单次捕获最长 5 分钟，超时自动关窗且不写入任何东西；同时只允许一个捕获会话（第二次会返回 `busy`）。
- 找不到浏览器时明确提示，不会静默失败。

支持站点：B站 `SESSDATA`、知乎 `z_c0`、微博 `SUB`、小红书 `web_session`、抖音 `sessionid`、X `auth_token`、YouTube `SID+SAPISID+LOGIN_INFO`、GitHub `user_session`。

Agent 侧：`search_contrl` 的 `blogger` 动作识别到 `space.bilibili.com/<mid>` 会**直接调 B站空间 API**（有 Cookie 时还能读平台 AI 总结），拿到真正的“最新视频”而不是搜索收录页；`action:'cookie'` 可列出/清除已存会话。


### 报告输出方式怎么工作

`delivery.mode` 有三个取值，默认 `file`：

| 模式 | 行为 | 适用 |
|---|---|---|
| `file` | 写入 `reports/`，回复给路径与要点表 | 归档、发邮件、二次编辑 |
| `chat` | 不写文件，整份正文发在对话里 | 手机上直接看，不想翻文件 |
| `both` | 写文件 + 正文进对话 | 既要档案又要当场可读 |

聊天模式的条目压成一行：`**标题**（日期/状态）— 核心事实；关键数据；来源链接`，板块标题保留、条数不少于文件版——不允许只回一句“已生成”。切换后下一份报告立即生效，不用重启。

## 2.0.0 改名：从 tech-daily-report 到 DSH-Search-Contrl

技能与插件正式更名为 **DSH-Search-Contrl**（设置侧边栏名仍是「搜索控制」）。老名字的对应关系：

| 位置 | 2.0.0 之前 | 2.0.0 |
|---|---|---|
| npm 包 | `dsh-tech-daily-report` | `dsh-search-contrl` |
| 技能名 | `tech-daily-report` | `dsh-search-contrl` |
| 工具名 | `tech_daily_search` | `search_contrl` |
| patch 行 id | `tech-daily-report` | `search-contrl` |
| 设置分区 id | `tech-daily-report-search-control` | `search-contrl-settings` |
| 桥前缀 | `/api/tech-daily-report-settings` | `/api/search-contrl-settings` |
| 数据目录 | `~/.dsh/plugin-data/dsh-tech-daily-report` | `~/.dsh/plugin-data/dsh-search-contrl` |

升级要做的六件事：

| 能力 | 怎么填 | 落到检索/交付上的样子 |
|---|---|---|
| 报告输出方式 | 顶部三选一：只给文件 / 只在聊天中呈现 / 文件 + 聊天 | 存进 `settings.json` 的 `delivery.mode`；`chat` 不写文件、正文直接进对话，`both` 两者都做 |

原有三件事：① profile `package.json` 的依赖键与 `dsh.profile.bundles` 改成 `dsh-search-contrl`；② `cordis.patch.yml` 的行 id 改成 `search-contrl`、name 改成 `dsh-search-contrl`；③ 重启 DSH。旧数据目录不会被自动迁移，需要保留配置就手工把 `settings.json` 与 `history/` 复制到新目录。

输出覆盖六个固定板块，每个板块都要播报可核验的成就与关键指标：

| 板块 | 覆盖范围 |
|---|---|
| 国内 AI | 百度、阿里、腾讯、字节、华为、DeepSeek、智谱、月之暗面、MiniMax 等 |
| 国际 AI | OpenAI、Google、Anthropic、Meta、Microsoft、xAI、Nvidia、Amazon、Apple 等 |
| 国内手机与消费电子 | 华为、小米、荣耀、OPPO、vivo、魅族、努比亚、真我、联想等 |
| 国内车型 | 比亚迪、蔚来、小鹏、理想、鸿蒙智行、极氪、吉利、长城、奇瑞、上汽、广汽、零跑、小米汽车等 |
| 国际车型 | Tesla、Toyota、Volkswagen、BMW、Mercedes-Benz、Porsche、Ferrari、Ford、GM、Hyundai、Rivian、Lucid、Waymo 等 |
| 科技成就与纪录 | 跨板块汇总销量、交付、续航、性能、赛事成绩、论文成果与量产突破 |

## 特性

- **日期范围灵活** — 只说「来一份日报」出当天日报；给出起止日期则按区间整理；说「本周」按自然周周一至周日；说「最近 7 天」按连续 7 个自然日。
- **成就播报有硬性口径** — 每条成就必须写明主体、指标、数值、单位、统计口径、时间范围和成就级别（世界/行业/公司/阶段性）。没有可靠数据时明确写「暂无已确认的新成就」，不允许用宣传口号替代，也不允许在口径不清时使用「全球第一」「创纪录」这类绝对表述。
- **双通道搜索，默认免费** — 注册 `search_contrl`：默认走免费的 Bing RSS 通道（无需 Key，只返回摘要），配置 Tavily Key 后可切到付费通道拿到 AI 答案与正文提取；`provider: "auto"` 先免费、失败才回退。提取结果按 URL 缓存 24 小时，Tavily 额度超限时短暂熔断而不是继续扣费。
- **渠道矩阵而非单一搜索** — 技能内置各板块的官方与监管渠道清单（品牌官网新品页、工信部新车申报公示与 3C 认证、GitHub/Hugging Face 模型卡、arXiv、NHTSA、FIA 等），并要求逐项尝试。
- **「暂无」有判定门槛** — 只有在官网、监管备案、行业媒体三类渠道都无记录，且列出实际检查过的渠道清单与受限原因时，才允许写「暂无」。禁止把「我没查到」表述成「不存在」。
- **团队采集有协议** — 跨板块、跨多日采集默认智能体团队并行：先造并发检索工具、一人一文件、任务自包含、Lead 复核、失败补位、列表页直连判定，并在每次采集后把踩坑写回技能并推送。

## 安装

### 方式一：npm（推荐）

```bash
# 在 DSH profile 目录执行：不带版本号 = 装 registry 上的 latest
pnpm add dsh-search-contrl
# 或
npm install dsh-search-contrl
```

包名 `dsh-search-contrl`，直接装最新版即可，不需要记版本号：

| 需求 | 命令 |
| --- | --- |
| 装最新版 | `pnpm add dsh-search-contrl` |
| 升到最新版 | `pnpm add dsh-search-contrl@latest` |
| 看有哪些版本 | `npm view dsh-search-contrl versions` |
| 锁定某一版 | `pnpm add dsh-search-contrl@2.1.6` |

发布走 GitHub Actions 的 OIDC trusted publishing，registry 上的 `latest` 永远指向最新一次成功发布——装完看一眼 `node_modules/dsh-search-contrl/package.json` 的 `version` 就知道拿到哪版。

没有 npm 账号或想跳过 registry 时，直接从 GitHub tag 装，效果一样（tag 换成最新版本号即可）：

```bash
pnpm add https://codeload.github.com/ysyXH-0827/dsh-search-contrl/tar.gz/refs/heads/main
```

两种方式都必须同时在 profile 的 `package.json` 里登记到 bundles，否则插件不会被加载：

```json
{
  "dependencies": { "dsh-search-contrl": "latest" },
  "dsh": { "profile": { "bundles": ["...", "dsh-search-contrl"] } }
}
```

> 依赖写 `"latest"` 时，每次 `pnpm install` 都可能拉到更新的版本；想稳定复现就写死版本号（如 `"^2.1.6"`）。升级后必须重启 DSH 才会加载新的客户端 bundle。

`cordis.patch.yml` 随包安装（`files` 白名单包含它），插件的 `id: search-contrl` 和设置页文案都来自这份 patch。打包内容可用 `pnpm pack` 自查：正常只有 `lib/`（12 个文件）、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json`，约 79 KB。

### 方式二：从 git 安装（等价写法）

```json
{
  "dependencies": {
    "dsh-search-contrl": "github:ysyXH-0827/dsh-search-contrl"
  }
}
```

### 方式三：本地目录（开发调试）

把仓库放到你的 DSH profile 目录内，然后在 profile 的 `package.json` 里链接它：

```json
{
  "dependencies": {
    "dsh-search-contrl": "link:./plugins/dsh-search-contrl"
  }
}
```

安装依赖：

```bash
pnpm install
```

> **重要：** 请将插件放在 profile 目录**内部**（如上例的 `plugins/` 子目录）。插件依赖 `@deepseek-ai/schemastery`，Node 需要从插件目录向上查找 profile 的 `node_modules` 才能解析；放在 profile 树外会导致 `ERR_MODULE_NOT_FOUND`。

### 启用插件

插件自带 bundle patch，安装后会自动插入插件行。若需自定义配置，在你的 profile `cordis.patch.yml` 中加入：

```yaml
- id: search-contrl
  name: dsh-search-contrl
  config:
    tavilyApiKey: ""
    searchDepth: basic
    maxResults: 8
    timeoutMs: 45000
```

修改配置后需**重启 profile** 才会生效。

### 一次读多个博主

```json
{ "action": "bloggers", "deep": true, "concurrency": 4 }
```

一次调用并发读全部已保存博主（B站走签名空间 API、微博走 ajax 时间线），返回 `creators[]`，单个博主失败不影响其它。实测 2 个博主：串行 754 ms → 并发 462 ms。

### 检索太慢怎么办

- 同一博主/视频在 **60 秒内重复问**会直接命中进程内缓存（列表 60 s、视频详情与 AI 总结 10 min、WBI 密钥 10 min），第二次通常是 1 ms 级。
- 冷启动一次「博主最新视频 + AI 总结」约 0.8 s（4 个必要请求：`nav` → 签名列表 → 视频详情 → AI 总结），这是 B 站接口的下限，不是插件开销。
- 走得慢还可能是在走回退链：签名接口被风控时才会 `sleep 1.2 s` 后回落未签名接口，再失败才回落到搜索引擎（3 条查询）。看返回里的 `apiFallback` 就知道卡在哪一环。

### 输出方式保存后又变回「只给文件」

说明 DSH 进程里加载的还是 2.2.0 之前的服务端模块。**客户端 bundle 每次打开设置页都从磁盘读，服务端模块则缓存在进程里**，所以会出现“界面是新的、保存被旧的丢掉”的现象。

- 现象确认：`~/.dsh/plugin-data/dsh-search-contrl/settings.json` 里没有 `delivery` 键，且设置页状态栏提示“被正在运行的旧版服务端丢弃了”。
- 处理：**重启 DSH**，再打开「搜索控制」重新保存一次。2.2.1 起页面会在检测到旧服务端时提前给出提示，并保留你选中的值不清空。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `tavilyApiKey` | string (secret) | `""` | Tavily API Key，可选。留空时检索走免费的 Bing 通道，只有正文提取不可用。 |
| `searchProvider` | `auto` \| `bing` \| `tavily` | `auto` | 检索通道。`auto` 先用免费的 Bing，Bing 失败且配了 Key 才回退 Tavily；`bing`/`tavily` 为强制单通道。 |
| `bingMarket` | string | `zh-CN` | Bing 免费通道的地区市场，例如 `zh-CN`、`en-US`。 |
| `searchDepth` | `basic` \| `advanced` | `basic` | Tavily 检索深度。`basic` 每次约 1 credit，`advanced` 约 2 credits 且返回更丰富上下文。Bing 通道不受此项影响。 |
| `maxResults` | number (1–20) | `8` | 每次检索返回的结果条数上限。 |
| `timeoutMs` | number (5000–120000) | `45000` | 单次上游请求超时时间（毫秒）。 |
| `historyLimit` | number (5–100) | `20` | 设置页最多保留多少个历史版本用于回退。每次保存、重置、回退都会先快照被替换的版本，超出上限的最旧快照会被删除。 |

### 获取 Tavily API Key（可选）

在 [tavily.com](https://www.tavily.com/) 注册，免费额度为每月 1000 credits，无需信用卡。一次完整日报约消耗 6 至 12 credits；`extract` 有 24 小时 URL 缓存、多主题可合并成一次 `batch`，重复采集同一批来源时的实际消耗会明显低于逐条检索。

如果不想消耗额度，把 `searchProvider` 保持默认的 `auto`（或显式设为 `bing`）即可：检索走 Bing RSS，零成本，代价是只有摘要、没有 AI 答案，也不能用 `extract` 取正文。

> ⚠️ **切勿把真实 Key 提交到版本库。** 仓库的 `.gitignore` 已排除常见密钥文件，配置默认值为空字符串。

## 搜索工具

无论是否配置 Key，插件都会注册 `search_contrl`；默认先用免费的 Bing 通道：

**免费检索（Bing RSS，无需 Key）**

```json
{
  "action": "search",
  "query": "国产大模型 开源 发布",
  "provider": "bing",
  "include_domains": ["huggingface.co"]
}
```

返回 `provider: "bing"` 与 `results` 数组，每项含 `url`、`title`、`content`（摘要）、`published_date`。已知边界：一页约 10 条、最多翻 3 页；`include_domains`/`exclude_domains` 会被翻译成 `site:`/`-site:` 运算符；Bing 会限速，批量并发默认压到 3。

**付费检索（Tavily，需要 Key）**

```json
{
  "action": "search",
  "query": "国产大模型 开源 发布",
  "provider": "tavily",
  "include_domains": ["huggingface.co"]
}
```

额外返回 `answer`（AI 摘要），结果项含 `score`。`provider: "auto"`（默认）先用 Bing，Bing 失败且配置了 Key 时才付费回退，返回里的 `provider` 字段始终说明这次实际是谁答的。

**提取正文**

```json
{
  "action": "extract",
  "urls": ["https://github.com/QwenLM/BlenderWorld"]
}
```

用于导航占满页面、正文被截断的情况。实测长页面（模型卡、仓库 README、厂商规格页）可提取数万字符量级，远多于普通抓取。**该动作只有 Tavily 通道，没有 Key 时直接报错**。

**批量检索（多主题快路径）**

```json
{
  "action": "batch",
  "queries": [
    { "query": "国产大模型 开源 发布", "label": "llm" },
    { "query": "2026年10月17日 大模型 开源", "label": "cn-ai", "max_results": 5 }
  ],
  "snippet_chars": 400
}
```

1 至 8 条 query 在一次调用内并发执行，返回 `{ ok, results: [{ label, ok, query, results, response_time }], succeeded, failed, elapsed_ms }`。单条失败不影响其余条目，失败项带 `ok: false` 与 `error`。实测同一批 6 组主题：串行发 6 次 `search` 用 17.1 秒，一次 `batch` 用 6.5 秒；同一 query 在 10 分钟内重复调用直接命中进程内缓存，返回 0 毫秒。

**缓存与计费**

- `extract` 的结果按 URL 缓存 24 小时。返回里的 `served_from_cache` 表示本次有几条来自缓存，`credits_estimated` 估算本次新消耗的 credit；页面确实更新过时才加 `refresh: true` 绕过缓存。
- **缓存副本有截断上限**：写入缓存时会保留正文前 **24,000 字符**，超出部分以 `[content truncated when cached; ...]` 标记收尾。首次抓取返回的是完整正文，只有命中缓存时才会看到这个标记；确实需要尾部内容时用 `refresh: true` 重新抓取（会重新计费）。
- `search` 每次请求 1 credit，`extract` 每 5 个成功 URL 1 credit。因此：不要在同一轮采集里重复抓同一 URL；`extract` 一次传满 20 个 URL 才划算；多主题检索合并成一次 `batch`，不要用连续小批次去「试探」。
- 上游明确回报额度或频率超限时，插件短暂熔断并在返回体里给出 `credit_guard` 字段。此时应消费已有缓存或等 `retry_after_ms` 之后再试，不要重试轰炸，并把这一限制写进日报的检索说明。

## 设置页 GUI（自定义检索）

入口有两个，指向同一份配置：

| 入口 | 位置 | 形态 |
|---|---|---|
| **搜索控制**（主入口） | **设置 → 侧边栏「搜索控制」** | 一级分区，点进去直接是四个页签 + 顶部「报告输出方式」（`settings.section` slot，order 152） |
| 插件行配置 | 设置 → 插件 → DSH-Search-Contrl | 同一张卡片的折叠/展开形态（`plugins.row.config` slot） |

六件事：

| 能力 | 怎么填 | 落到检索/交付上的样子 |
|---|---|---|
| 报告输出方式 | 顶部三选一：只给文件 / 只在聊天中呈现 / 文件 + 聊天 | 存进 `settings.json` 的 `delivery.mode`；`chat` 不写文件、正文直接进对话，`both` 两者都做 |

| 事件程度 | 「事件程度」页签三选一：大 / 中 / 小 | 存进 `settings.json` 的 `eventScale`；采集脚本据此限制每板块候选数，报告每条标注【大】/【中】/【小】 |
| 报告格式 | 「报告格式」页签二选一：表格（默认）/ 分条 | 存进 `settings.json` 的 `reportFormat`；报告按它排版，默认每板块一张表 |
| 博主动态原链接 | 「博主」页签底部的开关：显示 / 不显示 | 存进 `settings.json` 的 `showPostLinks`；关掉后报告里的博主动态只保留内容与转评赞数据、不附原文链接 |
| 博主要点字数 | 「博主」页签的「要点字数」：微博 / B 站分别选 20 / 40 / 60 / 80 字挡位，或直接输入自定义值（10–200） | 存进 `settings.json` 的 `pointLength`（`{ weibo, bili }`）；脚本输出的 `pointLength` 就是报告里该平台要点字数的下限，默认微博 20、B 站 50 |
| AI 总结（按平台） | 「博主」页签的「AI 总结」：B 站可开启 / 关闭，微博显示「平台无接口」 | 存进 `settings.json` 的 `aiSummary`（`{ weibo, bili }`）；B 站开启时脚本取平台 AI 总结并用缓存 + 串行节流，关闭时脚本不取、由模型读标签与简介写一句评论 |

原有三件事：

| 能力 | 怎么填 | 落到检索上的样子 |
|---|---|---|
| 自定义搜索源 | 加一条源，类型选 Bing / Tavily / 指定站点 | 通道型源固定 provider；站点型源转成 `include_domains` |
| 自定义主题（不限科技） | 主题名 + 关键词，可选限定站点 | 无站点：一条「关键词 关键词」查询；有站点：每站点一条 `site:` 查询（最多 4 条） |
| 博主定向检索 | 粘贴博主主页链接 | 解析出平台域名，发 `site:平台域名 UID/昵称`（最多 2 条） |

支持解析的链接：B 站、微博、知乎、X / Twitter、YouTube、抖音、快手、小红书、GitHub、Medium、Substack、CSDN、掘金、少数派、公众号（`mp.weixin.qq.com`）。解析不了的主页链接在保存时会被拒绝，不会静默写入。

**定向语义是本地保证的，不是靠 `site:`**：实测免费的 Bing RSS 通道对 `site:` 很不老实——`site:reuters.com AI chips` 返回过 CSDN、知乎的结果。所以域内结果的判定在本地做：只保留主机名等于目标域名或在其子域下的结果，并把只剩首页（如 `https://www.bilibili.com/`）的条目让位给真正的内容页。若换成「域名当普通关键词」后仍然一条都对不上，才会花 1 credit 走 Tavily 的 `include_domains`，返回里标 `domain_fallback: "tavily"`；没配 Tavily Key 时就是空结果加 `dropped_by_domain` 计数，**不会把站外噪声当定向结果交出去**。博主检索先查名称再查 UID——数字 UID 基本不被索引，名称通常能直接落到主页或作品页。

**版本可回退**：每次保存、重置、回退都会先把**被替换的那一版**写进历史，再写新版本；所以回退本身也能再回退，不存在「点错一次就回不去」。默认保留 20 个版本，用 `historyLimit` 调整。

**数据落在哪**：`~/.dsh/plugin-data/dsh-search-contrl/settings.json`，历史在同目录 `history/`。不写 profile 的 patch 文件——GUI 不该改写 Host 合成出来的配置层；自带存储才能保证每次写入都可回退。可用 `SEARCH_CONTRL_DATA_DIR` 改目录。

**读写桥**：渲染进程通过 `/api/search-contrl-settings/{describe,save,rollback,reset,history,preview}` 访问 Host，全部 POST，只接受同源回环请求（跨站、非本机、非 POST 一律拒绝）。`preview` 只计算将发送的查询，不消耗 Tavily credit。

**装完要重启**：客户端 bundle 由 Host 启动时扫描 `exports["./client"]` 加载，改完插件或升级版本后需**重启 DSH**，设置 → 侧边栏「搜索控制」才会出现（面板热更新只在 `pnpm run dev:web` 下生效）。

**插件版本回退**：仓库打了 tag，`v1.5.2`（设置侧边栏「搜索控制」）、`v1.5.1`/`v1.5.0`（只有插件内配置页）与 `v1.4.4`（最后一个无 GUI 版本）。退回旧版用 `git fetch --tags && git checkout v1.4.4`，或把 profile 里的依赖版本写回 `1.4.4` 再重启。设置数据存在插件目录之外，回退插件版本**不会**丢配置。

**Agent 侧用法**（不打开设置页也能用）：

```json
{ "action": "topic", "topicId": "t_xxx" }
{ "action": "topic", "topic": "固态电池 量产", "domains": ["reuters.com"] }
{ "action": "blogger", "url": "https://space.bilibili.com/123456", "label": "老石谈芯" }
{ "action": "search", "query": "光刻机", "sourceId": "s_xxx" }
{ "action": "history", "op": "list" }
{ "action": "history", "op": "restore", "snapshot_id": "2026-10-23T13-21-49-123Z.json" }
```

不配置任何自定义项时，报告仍按固定六板块执行；配置了主题或博主，才追加对应检索。自定义内容同样受日期与来源纪律约束：先确认发布日期，再看内容，只用摘要不算核实。

### 登录 Cookie 没反应怎么办
- **报 `EPERM, Permission denied ...\Temp\dsh-search-contrl-*`**：这是清理临时浏览器配置目录偶发被 Edge 子进程占用，2.1.2 起会等浏览器真正退出并重试删除，失败也只提示“下次启动自动清理”，不会再让捕获失败。

1. 确认 DSH 已**重启**：Cookie 捕获跑在 Host 进程里，只刷新页面不会加载新代码。
2. 点「获取 Cookie」后应弹出一个**新的浏览器窗口**并停在登录页；登录成功后窗口自动关闭，列表里出现「已登录 · N 个 Cookie」。
3. 若显示「读取 Cookie 失败：…」，那是浏览器协议层报错（例如某版本不支持某个 CDP 方法），把提示原文发出来即可定位。
4. 维护者可用 `npm run smoke` 做真浏览器自检：它会开一个临时窗口、种一个测试 Cookie、再验证读取链路。

## 自学习（月报收尾必做）

每份月报交付后执行四步复盘：回顾目标 → 评估结果（条数/可达链接/覆盖日期）→ 分析原因 → 写规律。规则与失败库统一维护在 `docs/LESSONS.md`，可执行规则同步进技能；只写数字与命令，不写感想。

## 输出两层：主事件 + 中等事件

日报与月报固定两层：**第一层主事件**（每板块 3–5 条头条）+ **第二层中等事件**（每板块 2–4 条次一级）。中等事件必须标状态（预告/爆料/消息人士/企业测试口径），不得用促销与纯观点填充；候选先全量扫描再分层挑选。

**来源多样性**：主事件尽量配两个独立来源（官方/监管/论文优先，独立媒体次之），只找到单一来源时标注“仅单一来源”，不把同一家媒体的多篇稿子当多源。

**第二来源要先验出处**：打开候选页看它自己标注的来源；标注“来源：IT之家/快科技”或属于大风号/网易号/搜狐号/百家号等分发账号的稿件都是转载，不算独立来源；404/522 的候选直接剔除。

## 性能基线（实测）

| 环节 | 改造前 | 改造后 | 倍数 |
| --- | --- | --- | --- |
| 31 天归档扫描 | 串行 13.9 s | 并发 8：0.38 s（冷）/ 24 ms（热缓存） | 约 36× / 580× |
| 6 条 Bing 查询 | 串行 1.41 s | 并发 4：0.60 s / 5 ms（热缓存） | 2.3× / 280× |

工具位置：`scripts/scan-archives.mjs`、`scripts/bing-search.mjs`；两者都带磁盘缓存，重复采集同一时段基本零成本。
## 使用建议

厂商官网的规格页路径并不统一，猜错会拿到 404：规格页常见 `/spec` 与 `/specs` 两种写法，产品资讯多在 `/news/`，活动页在 `/activity/`，上市公告在 `/notice-*`。建议先用 `search` 配合 `include_domains` 定位正确链接，再用 `extract` 取回正文，不要靠猜路径。

## 智能体团队采集

跨板块、跨多日的采集默认交给智能体团队并行跑。技能内置的完整协议在 `lib/index.js` 的「智能体团队采集协议」一节，这里给出可执行要点：

| 规则 | 含义 |
| --- | --- |
| 先造工具再分活 | 用 `lib/bing.js` 封装并发 CLI，一次 1–8 条查询、并发上限 3，避免每个成员串行等网络 |
| 一人一文件 | 每个成员只写自己的 `.md`，写域不重叠；`README.md` 由 Lead 独占 |
| 任务自包含 | prompt 带齐窗口、口径、排除项、已知线索、交付格式、验收标准与回报要求 |
| 给线索不给结论 | 明确标注“需核实线索，不是结论”，防止成员把假设写成事实 |
| Lead 复核 | 成员回报后抽检日期、链接可达性与口径标注，错误结论由 Lead 亲自改 |
| 失败不空转 | 成员中途失败时 Lead 直接补位写完板块，不等、不原样重派 |
| 列表页直连 | 判断日归档/列表页是否为空必须直连抓取；提取通道可能只返回骨架 |
| 写回并推送 | 每次团队采集后把踩坑与有效做法写回技能并提交推送，不做一次性动作 |
| 成员模型选对 | 实测 deepseek-flash 成员连续 0 交付；换 gpt-5.4 后 3 个板块 2 个一次成功、1 个重跑成功 —— 连续空手要换模型，不要原样重派 |
| 扫描脚本化 | 归档页 DD 补零逐日抓取、直连判定；不得用提取通道判空 |
| 清单先落盘 | 候选清单写成文件再派活，成员只做核对与取舍 |
| 批次时间预算 | 超预算即终止批次，Lead 用清单兜底，不把等待当进度 |
| 成员任务预算 | 单成员 ≤12 次工具调用、≤8 分钟；超时或空手立即由 Lead 接手 |
| 补采独立文件 | supp-*.md 并行补采，合并时按 URL 去重并重编号 |

实测参考：3 条查询并发执行 wall 1080 ms，而单条分别 566 / 422 / 441 ms，串行约 1429 ms；5 个板块并行采集一轮可产出 100+ 条明细。


## 使用

安装并重启后，直接用自然语言触发：

- 「来一份日报」/「发日报」/「今日科技新闻」→ 当天日报
- 「从 10 月 1 日到 10 月 7 日的日报」→ 指定区间
- 「本周科技总结」/「最近 7 天科技新闻」→ 按周或最近 7 天
- 「再发一次」→ 重新检索并完整输出

也可以显式调用技能 `dsh-search-contrl`。

## 输出格式

标题为 `检索日报｜YYYY-MM-DD`、`检索日报｜YYYY-MM-DD 至 YYYY-MM-DD`、`检索周报｜YYYY-MM-DD 至 YYYY-MM-DD`，或按配置主题命名（如 `AI 日报｜YYYY-MM-DD`）。

开头是一段不超过 80 字的「今日要点」或「本周判断」，随后按六个板块输出 8 至 16 条。每条包含：

- **新闻标题** — 一句话说明发生了什么
- **核心事实** — 主体、事件、时间与已知影响
- **为什么重要** — 对用户、行业或后续趋势的影响
- **成就/数据** — 指标、统计口径、时间范围与成就级别
- **来源** — 可点击的原始链接

日期范围较长时，最后附「趋势总结」与「后续关注」。

## 设计原则

这份技能在真实使用中暴露过两类错误，规则据此收紧：

1. **不允许在未穷尽渠道前写「暂无」。** 曾出现国内手机板块未查品牌官网就写「暂无」、漏掉已发布机型的情况。现在必须先查官网新品页、监管备案、行业媒体三类渠道，并公开列出检查清单。
2. **不允许只用搜索一个通道。** 搜索接口可能不可用或限流。技能内置渠道矩阵，并规定搜索失败时必须改用直接抓取具体 URL 继续采集，而不是跳过一个板块。

技能还要求区分官方宣称与独立核验，把传闻、预告、测试、正式发布、上市、交付分别标注，且不得伪造链接、标题、数据或引述。

## 目录结构

```
.
├── lib/
│   ├── index.js          # 插件入口：注册技能、搜索工具与设置桥路由
│   ├── client.js         # 设置页 GUI（浏览器端，plugins.row.config）
│   ├── config.js         # 配置 schema（schemastery）
│   ├── search-tool.js    # search_contrl 工具定义与通道路由
│   ├── settings-store.js # 设置存储：原子写 + 历史快照 + 回退
│   ├── settings-api.js   # 设置读写桥（同源回环校验）
│   ├── custom-search.js  # 主题/博主链接 → 查询构造
│   ├── bing.js           # 免费通道：Bing RSS 适配（无需 Key）
│   └── tavily.js         # Tavily HTTP 适配层
├── scripts/
│   ├── test-settings.mjs # 存储、查询构造、桥接守卫的 15 个用例
│   ├── test-client.mjs   # GUI bundle 加载与渲染冒烟
│   ├── scan-archives.mjs # 归档页并发扫描
│   └── verify-links.mjs  # 链接可达性校验
├── cordis.patch.yml    # bundle patch：声明插件行
├── package.json
├── LICENSE
└── README.md
```


### 代码整洁约定

- **新增 `export` 前先证明有外部使用者**：只有本文件或测试用到的符号不导出。当前 `lib/` 共 53 个导出，其中 12 个给 `scripts/test-*.mjs`、3 个给 `.github/workflows/verify.yml` 的离线断言。
- **一个流程只留一个实现**：单博主与多博主的 B站读取都走 `readBilibiliCreator`，不要再各写一份。
- **清理前先取证**：用脚本统计“本文件引用 vs 其它文件 import”，不要凭记忆删；删完跑 `npm test`（settings/client/cookie/bloggers 四组）。
- **已弃用的发布脚本**：`publish.ps1` 已删除，发布统一走 `.github/workflows/publish.yml`（tag 触发，OIDC + provenance）。

## 许可证

[MIT](./LICENSE)

## 采集工具脚本（2.2.7 起随包发布）

插件包里带两个不依赖 Host 的命令行工具，用来把「多轮检索」压成「一次脚本 + 一次整理」：

```bash
node scripts/daily-collect.mjs --date=2026-10-24 --max=12            # 采集当日候选（14 个 RSS 源，约 1–2 秒）
node scripts/daily-collect.mjs --date=2026-10-25 --days=7 --digest   # 一周紧凑摘要（每板块 3 行，省 ~80% token）
node scripts/daily-collect.mjs --days=7 --audit                      # 覆盖度审计：哪一天/哪个源条数偏少
node scripts/watchlist.mjs --list                                    # 新品牌/创业者公司跟踪清单
node scripts/watchlist.mjs --add="关键词A|关键词B" --name="实体名"    # 往清单里加实体
```

- `daily-collect` 会顺带做**跟踪清单比对**：JSON 里给 `watchlistHits`，`--digest` 末尾带「## 跟踪清单命中」小节。
- 同题新闻按**标题归一化后前 20 字**去重（跨站转载只留最早一条），`stats.dupTitlesDropped` 是丢弃数。
- `--audit` 输出按天、按源的条数表，并对 <5 条的日子给出「该日请单独补搜或读归档」提示 —— 这是发现「经常遗漏」的直接手段。
- `--others-max` 控制未归类条目的保留上限（默认 120），`--watchlist=0` 可临时关闭清单比对。

### 每日归档 + 多日合并（2.2.9 起）

RSS 源只保留最近 20–60 条，**一周前的条目会被挤出**，所以「周报要覆盖完整 7 天」靠临时抓是补不回来的 —— 必须每天落一份快照。

```bash
node scripts/daily-collect.mjs --archive                 # 归档今天到 reports/_data/archive/<日期>.json（幂等）
node scripts/daily-collect.mjs --archive --max=60 --others-max=120
node scripts/archive-merge.mjs --days=7 --digest         # 从归档拼出 7 天窗口，缺哪天报哪天
node scripts/archive-merge.mjs --days=7 --out=week.json  # 输出合并后的 JSON
```

- 归档文件按**采集目标日**命名（`--date` 决定），补跑历史窗口也会落到正确日期；同一日重复跑只覆盖、不累加。
- `archive-merge` 会去重（URL + 标题归一化），并列出缺档日期：**缺档就在报告里写明，不要用相邻日期顶替**。
- 自动化（零 token）：Windows 计划任务每天 23:50 执行 `scripts/daily-archive.cmd`；macOS/Linux 用 cron：
  ```cron
  50 23 * * * cd /path/to/dsh && node scripts/daily-collect.mjs --archive --max=60 --others-max=120
  ```


