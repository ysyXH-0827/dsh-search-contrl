# dsh-tech-daily-report

一个 DSH 插件，为 [DSH (DeepSeek Harness)](https://github.com/) 注册「科技日报」技能：生成中文科技日报、指定日期范围的日报，或一周科技新闻总结。

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
- **自带搜索适配层** — 可选配置 Tavily API Key，插件会注册 `tech_daily_search` 工具，直接调用 Tavily，不依赖 DSH 内置的 web search。支持 `search`、`batch`、`extract` 三种动作；提取结果按 URL 缓存 24 小时，额度超限时短暂熔断而不是继续扣费。
- **渠道矩阵而非单一搜索** — 技能内置各板块的官方与监管渠道清单（品牌官网新品页、工信部新车申报公示与 3C 认证、GitHub/Hugging Face 模型卡、arXiv、NHTSA、FIA 等），并要求逐项尝试。
- **「暂无」有判定门槛** — 只有在官网、监管备案、行业媒体三类渠道都无记录，且列出实际检查过的渠道清单与受限原因时，才允许写「暂无」。禁止把「我没查到」表述成「不存在」。

## 安装

### 方式一：本地目录（开发调试）

把仓库放到你的 DSH profile 目录内，然后在 profile 的 `package.json` 里链接它：

```json
{
  "dependencies": {
    "dsh-tech-daily-report": "link:./plugins/dsh-tech-daily-report"
  }
}
```

安装依赖：

```bash
pnpm install
```

> **重要：** 请将插件放在 profile 目录**内部**（如上例的 `plugins/` 子目录）。插件依赖 `@deepseek-ai/schemastery`，Node 需要从插件目录向上查找 profile 的 `node_modules` 才能解析；放在 profile 树外会导致 `ERR_MODULE_NOT_FOUND`。

### 方式二：从 git 安装

```json
{
  "dependencies": {
    "dsh-tech-daily-report": "github:你的用户名/dsh-tech-daily-report"
  }
}
```

### 启用插件

插件自带 bundle patch，安装后会自动插入插件行。若需自定义配置，在你的 profile `cordis.patch.yml` 中加入：

```yaml
- id: tech-daily-report
  name: dsh-tech-daily-report
  config:
    tavilyApiKey: ""
    searchDepth: basic
    maxResults: 8
    timeoutMs: 45000
```

修改配置后需**重启 profile** 才会生效。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `tavilyApiKey` | string (secret) | `""` | Tavily API Key。留空则只注册技能、不注册搜索工具。 |
| `searchDepth` | `basic` \| `advanced` | `basic` | 检索深度。`basic` 每次约 1 credit，`advanced` 约 2 credits 且返回更丰富上下文。 |
| `maxResults` | number (1–20) | `8` | 每次检索返回的结果条数上限。 |
| `timeoutMs` | number (5000–120000) | `45000` | 单次 Tavily 请求超时时间（毫秒）。 |

### 获取 Tavily API Key

在 [tavily.com](https://www.tavily.com/) 注册，免费额度为每月 1000 credits，无需信用卡。一次完整日报约消耗 6 至 12 credits；`extract` 有 24 小时 URL 缓存、多主题可合并成一次 `batch`，重复采集同一批来源时的实际消耗会明显低于逐条检索。

> ⚠️ **切勿把真实 Key 提交到版本库。** 仓库的 `.gitignore` 已排除常见密钥文件，配置默认值为空字符串。

## 搜索工具

配置 Key 后，插件注册 `tech_daily_search`：

**检索**

```json
{
  "action": "search",
  "query": "荣耀 Magic9 发布会 发布时间",
  "include_domains": ["honor.com"]
}
```

返回 `answer`（AI 摘要）与 `results` 数组，每项含 `url`、`title`、`content`、`score`、`published_date`。

**提取正文**

```json
{
  "action": "extract",
  "urls": ["https://www.honor.com/cn/phones/honor-magic9-pro-max/spec"]
}
```

用于官网导航占满页面、正文被截断的情况。实测荣耀官网手机页可提取约 19 万字符，远多于普通抓取。

**批量检索（多主题快路径）**

```json
{
  "action": "batch",
  "queries": [
    { "query": "荣耀 WIN2 发布会 时间", "label": "honor", "include_domains": ["honor.com"] },
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

### 使用建议

厂商官网的规格页路径并不统一，猜错会拿到 404。例如荣耀官网规格页是 `/spec`（`/specs` 返回 404），产品资讯在 `/cn/news/`，活动页在 `/cn/activity/`，上市公告在 `/cn/shop/notice-*`。建议先用 `search` 配合 `include_domains` 定位正确链接，再用 `extract` 取回正文。

## 使用

安装并重启后，直接用自然语言触发：

- 「来一份日报」/「发日报」/「今日科技新闻」→ 当天日报
- 「从 10 月 1 日到 10 月 7 日的科技日报」→ 指定区间
- 「本周科技总结」/「最近 7 天科技新闻」→ 按周或最近 7 天
- 「再发一次」→ 重新检索并完整输出

也可以显式调用技能 `tech-daily-report`。

## 输出格式

标题为 `科技日报｜YYYY-MM-DD`、`科技日报｜YYYY-MM-DD 至 YYYY-MM-DD` 或 `科技周报｜YYYY-MM-DD 至 YYYY-MM-DD`。

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
│   ├── index.js        # 插件入口：注册技能与搜索工具
│   ├── config.js       # 配置 schema（schemastery）
│   ├── search-tool.js  # tech_daily_search 工具定义
│   └── tavily.js       # Tavily HTTP 适配层
├── cordis.patch.yml    # bundle patch：声明插件行
├── package.json
├── LICENSE
└── README.md
```

## 许可证

[MIT](./LICENSE)
