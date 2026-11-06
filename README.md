# DSH-Search-Contrl

**给 DeepSeek Harness 用的「主题搜索 + 中文报告」技能/插件。3.0 起不再默认科技：先问你要什么主题，再按问题定搜索源。**

`3.0.0-beta.1` · DSH `>= 0.2.0` · Node.js `>= 20` · MIT

## 它是什么

装进 DSH 的技能 + 设置页插件。对 DSH 说「发日报」「这周 AI 圈发生了什么」「盯一下这几个博主」，它会：

1. 先读设置（主题、标题模板、输出方式、博主、Cookie 状态）；
2. 没主题就先反问，不默认科技；
3. 按主题选源，再采集、校验、排版，输出中文报告，带博主动态和链接校验。

设置页在 **设置 → 搜索控制**，改完即时保存、可回退。

## 三分钟上手

```bash
cd <你的 DSH profile 目录>
pnpm add dsh-search-contrl
```

重启 DSH → 打开 **设置 → 搜索控制** → 看到页面就装好了。然后说：

> 发一份 AI 日报

没主题时它会先问主题，并问要不要存进设置；有主题时直接用第一个启用的主题开工。

## 搜索源怎么定

- **命中预设**：用预设的 RSS、域名、检索词和板块。内置 10 个预设：科技 / 财经 / 汽车 / 体育 / 娱乐 / 医疗健康 / 游戏 / 时政政策 / 能源 / 科学。
- **没命中预设**：按用户问题动态定。先拼 3 条发现查询（`关键词 最新` / `关键词 发布 公告` / `关键词 官网`），看哪些域名真的答了，再把答了的域名（最多 4 个）当作本次的源，用 `site:域名 关键词` 定向搜。没答过的域名不进源清单。
- **费用**：动态发现全程只走免费 Bing 通道，0 Tavily credit。Tavily 是可选项：有 Key 时才用于 AI 摘要和正文提取，`search` 每次 1 credit，`extract` 每 5 个成功 URL 1 credit；没 Key 也能出报告，只是正文提取受限。

详细说明见 [docs/GUIDE.md](docs/GUIDE.md)。

## 设置页一览

路径：**设置 → 搜索控制**，改完点底部「保存」。

| 项 | 说明 |
| --- | --- |
| 报告标题 | 模板 `{主题}{类型}｜{日期}`，可改，实时预览，上限 120 字 |
| 输出方式 | 只给文件 / 只在聊天中 / 文件 + 聊天；表格或分条；事件密度 large / medium / small |
| 主题 | 名称、预设、关键词、域名；没配主题时先问主题再检索 |
| 搜索源 | Bing 免费通道（默认）、Tavily（需 Key）、指定站点（`site:`） |
| 博主 | 粘贴主页链接，15 个平台自动识别，可一次读多个 |
| 要点与字数 | 显示链接/要点，微博默认 20 字、B 站默认 50 字 |
| 登录 Cookie | 本机浏览器登录一次捕获，Cookie 只存本机，不上传 |
| 历史版本 | 每次保存都留快照，可回退，回退本身也可撤 |

## 安装

```bash
pnpm add dsh-search-contrl   # 或 npm install dsh-search-contrl
```

再让 profile 加载它（`dsh.profile.bundles` 里加 `"dsh-search-contrl"`），插件自带 `cordis.patch.yml`，会自动插入插件行。

Host 侧配置（可选，改完需重启 profile）：

```yaml
- id: search-contrl
  name: dsh-search-contrl
  config:
    tavilyApiKey: ""   # 留空 = 只用免费 Bing；动态发现永远不花 Tavily credit
    searchDepth: basic
    maxResults: 8
    timeoutMs: 45000
```

升级：`pnpm add dsh-search-contrl@latest` 后重启 DSH。回退到稳定版：`pnpm add dsh-search-contrl@2.2.18`。卸载：从 `dependencies` 和 `bundles` 移除，`pnpm install`，重启；设置在 `~/.dsh/plugin-data/dsh-search-contrl/`，需要时手动删。

> `3.0.0-beta.1` 是 beta：功能完整、测试全绿，设置页和技能话术可能还会调整。想要稳定版请留在 `2.2.18`。

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

板块来自主题预设；没命中预设时平铺候选表，不硬造板块名。

## 命令行脚本

随包发布，装在 `node_modules/dsh-search-contrl/scripts/`：

| 命令 | 作用 |
| --- | --- |
| `node scripts/daily-collect.mjs --days=7 --digest` | 采集 + 紧凑摘要（默认只吐摘要；要整份 JSON 加 `--json`） |
| `--topic=汽车` / `--presets` | 指定主题 / 列出 10 个预设 |
| `--archive` / `--audit` | 按天归档 / 逐天覆盖度审计，缺哪天写「缺失」 |
| `node scripts/archive-digest.mjs --window=all` | 从归档快照生成素材表 |
| `node scripts/report-metrics.mjs <md>` | 报告体量与 token 估算 |

数据落在 `~/.dsh/plugin-data/dsh-search-contrl/`（设置、历史快照、缓存、Cookie）和 `reports/`（报告与归档快照）。

## 常见问题

**「发日报」却先问我主题？** 3.0 的设计：没有主题就不猜。回答一次后可存进设置，下次一句话直达。

**主题匹配到了错的预设？** 在「主题 → 预设」里手工指定。

**检索太慢？** 动态发现和采集默认走免费 Bing；Tavily `advanced` 会更慢更贵。采集侧可把 `--concurrency` 调到 6–8。

**Cookie 点了没反应？** 确认浏览器能正常登录该站点；企业网络/代理下捕获窗口可能连不上，先关代理再试。

## 开发与测试

```bash
pnpm run check    # 全量 node --check
pnpm test         # 7 套离线测试，94 条断言
pnpm run prepack  # 打包前自检：lib 语法 + client bundle + patch 存在
```

详细文档：[docs/GUIDE.md](docs/GUIDE.md)（设置逐项说明、3.0 变化、目录结构、设计原则） · 采集复盘：[docs/LESSONS.md](docs/LESSONS.md)

## 许可证

MIT © ysyXH-0827
