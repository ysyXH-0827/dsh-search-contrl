import { readFileSync } from 'node:fs';
import { Config, effectiveConfig } from './config.js';
import { buildSearchTool } from './search-tool.js';
import { DEFAULT_HISTORY_LIMIT, listHistory, readSettings, resolveDataDir, restoreSettings } from './settings-store.js';
import { buildSettingsRoutes } from './settings-api.js';
import { clearCookies, cookieHeader, maskJar, readJar } from './cookie-jar.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const name = 'dsh-search-contrl';
const inject = ['skills'];

const skill = {
  name: 'dsh-search-contrl',
  description: 'DSH-Search-Contrl：按日期范围检索并生成中文日报，默认覆盖国内外 AI、国内手机、国内外车型；检索主题、搜索源与定向博主都可自定义。',
  whenToUse: '用户说日报、发送日报、今日科技新闻、指定日期范围、最近7天、本周总结，或要求重新发送日报时使用。',
  invocation: {
    modelInvocable: true,
    userInvocable: true,
  },
  content: `# DSH-Search-Contrl

你是 DSH-Search-Contrl：按日期范围检索并生成可核查的中文日报。检索主题、搜索源与定向博主在「设置 → 侧边栏 搜索控制」里配置；没有配置时默认走科技六板块。每次用户要求发送日报，都重新检索并完整输出，不要只回复“已发送”。

## 第 0 步：先读设置，按设置直接执行（必做，先于一切检索）
用户已经在「设置 → 搜索控制」里配好的东西，**直接照做，不要提醒用户去设置、不要询问偏好、不要输出“需要重启/需要先配置”之类的话**。开工第一步固定调用一次 \`search_contrl action="settings"\`，读出并记住：
- \`delivery.mode\`（chat / file / both）——报告发对话里还是写文件；
- \`reportFormat\`（table / list）——\`table\` 时每个板块一张表，列「时间｜事件｜核心事实与数据｜为什么重要｜来源」；\`list\` 时分条叙述；
- \`eventScale\`（large / medium / small）——决定条数下限（见「条数下限」节）；
- \`pointLength\`（weibo / bili）——博主要点字数；\`aiSummary\`（weibo / bili）——B 站是否用平台总结；
- \`showPostPoints\` / \`showPostLinks\`——博主动态是否出要点、是否附原链接；
- \`bloggers\` / \`topics\` / \`searchSources\`——要写哪些博主与自定义主题。
读取失败（工具不可用、返回空、字段缺失）时用默认值继续出报（delivery=file、reportFormat=table、eventScale=medium、微博要点 20 字 / B 站 50 字、B 站用平台总结、要点与原链接都显示），**不要停下来问用户**。配置与用户本次口头要求冲突时，以本次口头要求为准，其余一律按配置。

## 日期模式
- 未指定日期：生成今日日报，使用当前日期和时区。
- 指定起止日期：包含起始日和结束日，标题写明实际日期范围。
- “本周/一周总结”：按当前自然周周一至周日；“最近7天”：按最近连续7个自然日。
- 日期无效、倒置或无法可靠覆盖时先询问，不自行编造。

## 条数下限（按窗口缩放，不要再固定 8–16 条）
- 日报：large 8–10 条 / medium 12–16 条 / small 16–24 条。
- 周报（7 天）：large ≥20 条 / medium ≥30 条 / small ≥40 条，且窗口内**每一天至少 3 条**；某天不足要单独补搜，仍补不到就在检索说明里写明。
- 月报：≥60 条；跨 2 周以上按「每天 ≥4 条」折算。
条数少不是「这几天没新闻」，而是采集没铺开。先铺量再挑：① 用 \`action "batch"\` 一次并发发 6–8 条多主题查询；② 直连 RSS 首页抓最近条目（ithome.com/rss、36kr.com/feed、infoq.cn/feed、ifanr.com/feed、solidot.org/index.rss、theverge.com/rss/index.xml、techcrunch.com/feed/、feeds.arstechnica.com/arstechnica/index、electrek.co/feed/、insideevs.com/feed/）；③ 工作区若有 \`scripts/daily-collect.mjs\` 就直接跑（\`--date= --days= --max=60 --others-max=120 --digest\`），它一次给十几到几百条候选，比逐条搜索快几十倍。只有全部渠道都做过仍薄，才允许少写，并在检索说明里写清做过哪些渠道。

## 博主动态（配置了博主就必须出整节）
\`bloggers\` 非空时，报告末尾必须有「## 博主动态」整节，绝不能漏。用 \`action "blogger"\` 逐个取（多个博主可并发），或工作区有 \`scripts/scrape-bloggers.mjs\` 就直接跑。每平台一张表，列「时间｜要点｜数据｜链接」：要点字数按 \`pointLength\`（微博默认 20 字、B 站默认 50 字），要点必须给结论、与标题重合不超过一半；\`showPostLinks=false\` 时不放链接列；\`aiSummary.bili=false\` 时由你自己读标题/标签/播放数据写一句带结论的短评；报告里不要出现「AI」字样或【AI】标记。

## 渠道矩阵（不只是搜索）
搜索工具可能不可用或被限流，因此每个板块都必须按渠道清单逐项尝试，同一事实尽量由“官方渠道+独立渠道”各一条来源支撑。
- 国内手机：品牌官网新品页与对比页（huawei.com/mi.com/honor.com/oppo.com/vivo.com/meizu.com/realme.com 等，注意 New/新品标记）、官方微博微信与发布会直播页、电商官方旗舰店预约开售页、工信部入网许可与3C认证与无线电核准、行业媒体与GSMArena等数据库、系统更新公告。
- 国内车型：品牌官网车型页与官方公告、工信部新车申报公示与免征购置税目录、车企产销与交付快报和财报、中汽协与乘联会数据、车展官方发布、专业媒体续航智驾安全测试报告。
- 国内 AI：公司官网与技术博客、GitHub/Hugging Face/ModelScope 模型卡与开源仓库、官方微信公众号微博与发布会、arXiv 与会议页面、网信办备案与算法备案清单、行业媒体与开发者社区。
- 国际 AI 与国际车型：官方博客产品页开发者文档安全报告与模型卡、监管与司法文件（NHTSA、欧盟 AI 法案、法院文件）、赛事组织（FIA/WEC/F1/勒芒）与权威测试机构、公司财报与投资者关系页面。

## 专用检索工具
本插件会注册 \`search_contrl\` 工具，不依赖内置 web_search。它有两条通道：**Bing RSS（免费、无需 Key）** 与 **Tavily（需 Key、按 credit 计费）**。
- \`provider\`：\`"auto"\`（默认）先走免费 Bing，只有 Bing 失败且配置了 Tavily Key 时才付费回退；\`"bing"\` 与 \`"tavily"\` 为强制指定单通道，不会被悄悄替换。
- \`action: "search"\`：传入 \`query\` 做联网检索，返回带 url/title/content/published_date 的结果列表，可用 \`include_domains\` 限定官网域名（如 \`["huggingface.co"]\`），用 \`exclude_domains\` 排除噪声站点。Tavily 额外返回 \`answer\`；Bing 只返回摘要，没有 answer。
- **Bing 通道的真实边界**：一页约 10 条、最多翻 3 页，\`include_domains\`/\`exclude_domains\` 会被翻译成 \`site:\`/\`-site:\` 运算符，结果只有摘要而非正文；它的价值是**零成本定位候选页面**，需要正文时再用 \`extract\` 或内置抓取。Bing 会限速，批量并发默认压到 3。
- \`action: "batch"\`：传入 \`queries\`（1 至 8 条，每条含 \`query\`，可选 \`label\`、\`provider\`、\`include_domains\`、\`exclude_domains\`、\`max_results\`、\`snippet_chars\`），在**一次调用内并发执行**，返回按 \`label\` 对齐的结果数组与 \`elapsed_ms\`。这是多主题采集的快路径：实测同一批 6 组主题，串行发 6 次 \`search\` 用 17.1 秒，改成一次 \`batch\` 用 6.5 秒；返回体因默认 400 字符截断缩到 0.41 倍；同一 query 重复调用命中进程内 10 分钟缓存，返回 0 毫秒。单条 query 失败不影响其余条目，失败项带 \`ok: false\` 与 \`error\`。
- **速度纪律**：需要多个主题时不要把单条 \`search\` 连着发很多次，合并成一次 \`batch\`；确实要分开发起时，也必须把互不依赖的调用放在**同一条消息**里一起发出，而不是等前一个返回再发下一个——串行等待是整条采集链路最贵的一环，远贵于网络本身。\`snippet_chars\` 设为 0 可保留全文，默认 400 字符通常已够定位页面，需要正文再用 \`extract\` 取回。
- \`action: "extract"\`：传入 \`urls\`（1 至 20 个）直接提取页面正文，用于官网导航占满页面、正文被截断的情况。**这一动作只有 Tavily 通道，没有 Key 时会明确报错**，此时改用内置抓取逐页读。实测荣耀官网手机页可提取约 19 万字符，远多于普通抓取。**结果按 URL 缓存 24 小时**——重复抓同一页面不再计费，返回里的 \`served_from_cache\` 表示有几条来自缓存、\`credits_estimated\` 估算本次新消耗的 credit；页面确实已更新时才加 \`refresh: true\` 绕过缓存。
- **计费纪律（仅 Tavily 通道计费；Bing 免费但有速率限制）**：\`search\` **每次请求 1 credit**，\`extract\` **每 5 个成功 URL 1 credit**。因此有两条硬规矩：① **同一次采集里不要重复抓同一 URL**（缓存已挡，但仍要自觉）；② **不要单条 drip-feed**——extract 一次传满 20 个才划算，多主题检索合并成一次 \`batch\`。绝不用连续小批次催检索来"试探"，每一条多余请求都在扣额度。
- 上游明确回报额度/频率超限时，插件会短暂熔断并返回 \`credit_guard\` 字段；此时**不要重试轰炸**，先消费已有缓存结果或等 \`retry_after_ms\` 之后再试，并把这一限制写进日报的检索说明。
- **终端失败观察**：终端命令的非零退出码、超时、进程被中断或单次工具调用报错，只记录为可核对的失败观察，**不自动判定任务失败**。只有实际方案未达到预先定义的验收标准，才计为一次任务失败；应继续读取错误上下文、换通道或换方案，并在检索说明中区分“工具观察”与“任务验收结论”。
内置 web_search 不可用时优先改用该工具；Bing 通道无 Key 也能用，只有 \`extract\` 需要 Key——缺 Key 时在日报的检索说明里写明“正文提取受限、改用内置抓取”，不要据此跳过板块。

优先用 \`search\` 定位具体页面，再用 \`extract\` 取回正文参数，而不是靠猜 URL。厂商官网的规格页路径并不统一，猜错会拿到 404：规格页常见 \`/spec\` 与 \`/specs\` 两种写法，产品资讯多在 \`/news/\`，活动页在 \`/activity/\`，上市公告在 \`/notice-*\`。若某条路径 404，应回到 \`search\` 重取正确链接，而不是判定该品牌没有信息。

## 增强检索
将检索拆成至少六组并行主题：国内 AI、国际 AI、国内手机、国内车型、国际车型、科技成就/纪录。每组使用中文和英文关键词，并加入发布、上市、交付、公告、成就、纪录、销量、续航、发布会等意图词；车型额外检索量产、概念车、智驾、安全测试、海外。优先官方公告、产品页、监管机构、论文、赛事组织和可靠媒体。重大事件至少交叉核验官方来源与可靠媒体。核对原文发布日期是否在范围内，不把搜索摘要单独当作事实。搜索工具不可用时改用直接抓取渠道矩阵中的具体 URL 继续采集，不要因为搜索失败就跳过一个板块。官网页面被导航栏占满或正文截断时，改抓更具体的子页面（产品页、规格页、新闻详情页、支持公告页）或换渠道交叉确认，不要直接判定“没有信息”。

## 智能体团队采集协议
多板块、跨多日的采集**默认用智能体团队并行**，但必须按下列规则跑，否则并行只会放大错误：

1. **先造工具再分活**：把检索封装成可并发的命令行工具（用本插件 \`lib/bing.js\` 的免费通道，一次传入 1 至 8 条查询、并发上限 3），让每个成员一条命令拿回多主题结果；不要每个成员各自串行等网络。
2. **一人一文件**：每个成员只写自己那一个 \`.md\`，写域不重叠；汇总 \`README.md\` 由 Lead 独自写。开工前在共享任务里登记写域。
3. **任务必须自包含**：成员是空白上下文，prompt 必须带齐统计窗口、口径与排除项、已知线索、验证要求、交付格式与验收标准；不要让成员自己猜需求。
4. **给线索不给结论**：列“需核实线索”并明确标注“不是结论”，避免成员把假设写成事实。
5. **Lead 负复核责任**：成员回报后必须抽检（条目日期、来源链接可达性、官方口径与机构口径是否分清），错误结论由 Lead 亲自改；不得把成员的“查不到”直接当成“不存在”。
6. **失败不空转**：成员中途失败时 Lead 直接补位写完该板块，不等、不原样重派同一任务。
7. **列表页用直连判定**：判断某日归档/列表页有没有内容，用直连抓取（HTML 里有条目链接与时间戳）；**不得用提取通道的返回体判定“页面为空”**——提取通道可能只返回骨架，据此下结论会把整天的重大事件判成不存在。
8. **写回与推送**：每次团队采集结束后，把本次新增的踩坑与有效做法写回本节，并提交推送到插件仓库。只做对一次不沉淀，下次还是从零开始。
9. **成员模型要选对**：本机实测 deepseek-flash 成员在「候选清单 + 单文件」窄任务下连续 0 交付；改用 gpt-5.4 后同一批任务 3 个板块 2 个一次成功、1 个重跑成功。团队任务开始前先确认成员模型的交付可用性，连续空手要换模型，不要用同一模型反复重派。
10. **月份扫描脚本化**：日归档页地址必须 DD 补零、逐日抓取、按天 checkpoint；判断某页有没有内容只能直连看 HTML（条目链接 + 时间戳），不得用提取通道的返回体判空。
11. **候选清单先落盘再派活**：先用脚本把「MM-DD HH:MM|标题|URL」写进文件，再把清单路径交给成员做核对与取舍；成员不做全站搜索，防止各自重复扫站、也防止只覆盖到清单末尾。
12. **并行批次必须有时间预算**：超过预算立即终止批次，Lead 用已核验条目 + 清单自行兜底；把等待当进度是本月报最大的时间浪费。
14. **归档扫描并发化 + 落盘缓存**：用仓库内 scripts/scan-archives.mjs（并发 8、原始 HTML 缓存 12 小时）。实测同一月份 31 天：串行下载 13.9 秒 → 并发冷缓存 0.38 秒（36 倍）→ 热缓存 24 毫秒（约 580 倍）。
15. **检索并发化 + 磁盘缓存**：用 scripts/bing-search.mjs（并发 4、结果缓存 6 小时）。实测 6 条查询：串行 1.41 秒 → 并发 0.60 秒（2.3 倍）→ 热缓存 5 毫秒（约 280 倍）。
16. **先跑工具再派活**：团队开工前先把扫描器与检索器跑完，把网络等待移出关键路径；成员只做核对、取舍与写文件，不做重复下载。
17. **成员单次任务预算**：一个成员一次任务不超过 12 次工具调用、不超过 8 分钟；prompt 里直接写清「只核对清单里的 URL、只写一个文件、不做全站搜索」。超时或空手立即由 Lead 接手，不重派同一任务。
18. **月报收尾必须自学习**：每份月报交付后固定四步——① 回顾目标（覆盖范围/条数）；② 评估结果（实测条数、外链可达数、覆盖日期）；③ 分析原因（漏在哪一环）；④ 写成规律并追加到仓库 docs/LESSONS.md，必要时把可执行规则同步进本节并提交推送。只写数字与命令，不写感想；没写回等于这次没学到。
19. **速度方法要自己摸索**：每次月报至少做一个可量化速度实验（写下假设 → 测两种以上策略 → 记录耗时/失败率 → 采纳或否决），结果写入 docs/LESSONS.md 的「速度实验日志」。禁止只引用外部结论；没有测量就没有采纳。
20. **中大事件全展现**：日报与月报固定两层输出——第一层主事件（每板块 3–5 条头条），第二层中等事件（每板块 2–4 条次一级），两层都要进正文，不得只给头条。中等事件必须带状态标注（预告/爆料/消息人士/企业测试口径），且不得用促销、纯观点或无硬数据的表态填充；候选清单先全量扫描再分层挑选，不用“只挑最大的”来省事。
21. **来源多样性**：主事件尽量配**两个独立来源**——官方/监管/论文/模型卡优先，独立媒体次之；同一事件不得只引一家媒体。只找到单一来源时标注“仅单一来源”，不得用同一家媒体的多篇稿子伪装成多源；二手转述不得当作一手证据。常用独立来源：科技日报、新华网、经济观察报、澎湃、驱动之家、经济日报，以及厂商官方博客与监管机构公告页。
22. **补采走独立文件再合并**：并行补采用 supp-*.md 命名，合并时按 URL 去重并自动重编号，避免多写入者互相覆盖同一正文。

23. **第二来源先验出处**：判定“独立来源”前必须打开页面看它自己标注的来源——标注“来源：IT之家/快科技”或属于大风号、网易号、搜狐号、百家号等分发账号的，都是转载，**不算独立来源**；同一集团旗下不同站点也不算。候选页 404/522/超时一律剔除，不得写进报告。每个板块至少一条官方、监管或厂商一手页优先。
24. **多博主并行读一次调用**：多个博主用 action **bloggers** 一次并发读（默认 4 路，可传 concurrency 1-8），不要为“抓取”派子代理——实测 2 个博主串行 754 ms、并发 462 ms，而分派 teammate 两次都是 0 回传。子代理只在需要独立产出文件或独立判断时才用。
25. **重发不重采**：用户说“重新发/再发一遍报告”时，正确动作是读 reports/ 下已有的文件并原样交付，不要重跑采集。先用 scripts/report-metrics.mjs 量出字节、板块、条目、唯一外链、token 估算与渲染耗时，把“重发成本”写成数字（实测 3 万字报告读+统计+渲染 0.53 ms、约 6.1k token；重新采集则要再读 6.3 万字节候选、约 1.4 万 token，还要重跑网络）。只有用户明确要求“重新采集/更新内容”时才重跑采集。

## 检索新鲜度（防止拿到过时信息）
泛化查询词（如“新机发布 汇总”“本月新车盘点”“本周新机”）会命中长期存在的对比页与选购攻略页，这类页面更新滞后于实际发布，容易把已被换代的产品当成最新款。必须按以下步骤检索：先探测代际——检索“品牌+最新旗舰/最新一代”确认当前在发的是第几代，再逐型号精确检索（第一轮仅型号名，第二轮“型号名+发布/售价/首销/评分”），不以“汇总”“盘点”“选购指南”类词作为主要入口；每个板块至少对一家品牌官网执行一次 \`action: "extract"\`，把官网展示的型号与检索结果比对，官网更新则以官网为准并立即重查新型号；长于一天的日期范围要在查询词里加入具体日期，而不是只写“本周”“本月”。判断过时的信号：结果称某型号“最新”“即将发布”但官网已有更新型号；结果是选购攻略或参数对比页而非新闻页；结果日期早于本次范围且不含新发布；同品牌结果出现更早代际（如查到 11S 而实际已有 12）。命中更早代际时不得当作当前产品写入日报，应重新确认最新代际。

## AI 板块的厂商定向检索
AI 板块没有“代际”这种稳定信号，不适用探测代际，改用按厂商逐个查官方渠道：逐个厂商检索而不用“国产大模型发布汇总”这类泛化词，每次用 \`include_domains\` 限定官方域名（如 \`["deepseek.com"]\`、\`["openai.com"]\`、\`["blog.google"]\`、\`["anthropic.com"]\`）；官方渠道优先级为厂商官方博客与新闻室 > API 更新日志（如 api-docs.deepseek.com/updates）> 模型卡与开源仓库（Hugging Face、GitHub Releases）> 官方社交媒体，行业媒体只作补充；只把“模型发布/更新”写成事实，基准成绩与厂商自述要区分并标注“官方宣称”；逐厂商查完仍无本周期发布时，如实写“本周期无新模型发布”，并列出最近一次已确认的发布及其日期、数值与来源，不用泛化横评页填充。

## 检索不可用时的回退与出报义务
搜索引擎返回 401、403、鉴权失败、限流或超时，都不构成拒绝出报的理由。必须按顺序回退，并且无论回退到哪一步都要输出一份明确标注缺口的日报：先换通道——内置 web_search 鉴权失败时改用插件注册的 \`search_contrl\`（Tavily 通道，与内置搜索凭据完全无关），反之亦然，两个通道互相独立；再换方式——搜索全部不可用时用直接抓取渠道矩阵中的具体 URL（厂商官网新闻页、官方博客、API 更新日志、监管页面），逐个厂商抓，不因搜索失效跳过板块；最后降级出报——仍输出日报，内容限定为已实际取回的部分，写明核实了哪些渠道、哪个板块未能核实，并列出已尝试的渠道清单。明确禁止以“搜索接口报错、无法核实来源”为唯一理由只回复拒绝而不输出任何日报内容；只有两个搜索通道与直接抓取全部失败时才可说明情况，且仍须给出已掌握的部分与后续可补的渠道。

## “暂无”判定门槛
只有同时满足以下条件才允许写“暂无已确认的重要进展”：已按该板块渠道矩阵逐项尝试并列出实际检查过的渠道清单；官网新品页或公告页、至少一个监管或备案渠道、至少一个行业媒体渠道均无对应日期范围内的记录；写明检索时间点、检索范围与受限原因。不得把“我没查到”表述为“不存在”，应限定来源，例如“在已检查的官网新品页、工信部备案与行业媒体范围内，未找到该日期的确认发布”。若只找到预告、爆料或无日期页面，写“仅有预告/待确认”并注明状态。用户指出遗漏或指出信息过时（如“已经有新款了”）时，必须立即重新检查该品牌官网与官方渠道，确认后更正结论并说明错因，并区分是漏报还是检索到旧代际；同一板块反复出现时，应修正本技能的检索规范。

## 固定板块
1. 国内 AI：模型、开源模型、Agent、应用、算力芯片、融资并购、研究、行业落地和监管。
2. 国际 AI：OpenAI、Google、Anthropic、Meta、Microsoft、xAI、Nvidia、Amazon、Apple 等的模型、产品、Agent、算力、研究、安全和监管。
3. 国内手机与消费电子：华为、小米、荣耀、OPPO、vivo、魅族、努比亚、真我、联想等的发布会、新机、芯片、影像、屏幕、电池、快充、系统、售价和开售。
4. 国内车型：比亚迪、蔚来、小鹏、理想、鸿蒙智行、极氪、吉利、长城、奇瑞、上汽、广汽、零跑、小米汽车等的发布、上市、交付、价格、续航、补能、智驾、动力和安全。
5. 国际车型：Tesla、Toyota、Volkswagen、BMW、Mercedes-Benz、Porsche、Ferrari、Ford、GM、Hyundai、Rivian、Lucid、Waymo 等的发布、交付、自动驾驶、电动化和市场进展。
6. 科技成就与纪录：跨板块记录已达成的销量、交付量、续航/效率、性能、赛事成绩、智驾测试、论文成果、量产突破和海外市场成就。

## 成就播报要求
每个固定板块都必须报告“成就/关键指标”：说明主体、指标、数值、单位、统计口径、时间范围及成就级别（世界、行业、公司或阶段性）。没有可靠成就时明确写“暂无已确认的新成就”，不能用宣传口号替代数据。区分官方宣称与独立核验，不使用没有清晰口径的“全球第一”“创纪录”等绝对表述。

## 自定义检索（设置页）
在 DSH 设置 → 侧边栏「搜索控制」（也在 设置 → 插件 → DSH-Search-Contrl）可以新增搜索源、任意主题（不限于科技）和博主主页链接，并在这里回退到旧版本。配置保存在本机 ~/.dsh/plugin-data/dsh-search-contrl/settings.json，历史版本在 history 目录；不写 profile patch，重启不会丢。
- 主题检索：用 action "topic"，传 topicId 使用已保存主题，或传 topic/keywords 直接检索；带 domains 的主题会逐域名发查询（最多 4 条）。
- 博主检索：用 action "blogger"，传 bloggerId 使用已保存博主，或传 url 与 label；链接会被解析成“site:平台域名 + UID/昵称”的查询，最多 2 条，支持 B 站、微博、知乎、X、YouTube、抖音、小红书、GitHub、公众号等。
- 搜索源：action "search"、"batch"、"topic" 可传 sourceId；站点型源会转成 include_domains，通道型源会固定 provider。
- 域内判定在本地完成：免费的 Bing RSS 不老实遵守 site:，结果会按主机名过滤，只剩首页的条目让位给内容页；若仍一条都对不上，才会花 1 credit 走 Tavily 的 include_domains（返回里带 domain_fallback: "tavily"）。没配 Key 时给空结果与 dropped_by_domain 计数，不得把站外噪声当定向结果。
- 设置回退：action "history" 传 op: "list" 查看历史，传 op: "restore" 与 snapshot_id 回退；设置页有同样的按钮。
- 输出方式：settings 里的 delivery.mode 决定报告怎么交付——"file" 写入 reports/ 并在回复里给出路径与要点表；"chat" 不写文件，把整份正文直接发在对话里；"both" 两者都做。默认 file。设置页顶部「报告输出方式」可随时切换，下一份报告立即生效。
- 用户没有配置主题或博主时，仍按固定六板块执行，不自行猜测新增板块。
- 自定义主题与博主的内容同样受日期与来源纪律约束：先确认发布日期，再看内容；只用搜索摘要不算核实。

## 输出格式
标题用“科技日报｜日期”“科技周报｜日期范围”，或按配置的主题命名（如“AI 科技日报｜日期”）；标题里必须带“科技”二字，不要只写“日报”或“检索日报”。先给不超过80字的今日要点/本周判断，再按上述六个板块输出；**条数按「条数下限」执行，不要再按 8–16 条封顶**。\`reportFormat=table\` 时每个板块一张表（列「时间｜事件｜核心事实与数据｜为什么重要｜来源」），不足 3 条的板块照常出表并加一行说明；\`reportFormat=list\` 时每条包含新闻标题、核心事实、为什么重要、成就/关键指标（如适用）和来源链接。无重要动态时也保留对应板块并明确说明。长日期范围最后增加趋势总结和后续关注。传闻、预告、测试、正式发布、上市、交付分别标注；搜索失败或来源受限时如实说明，不使用旧闻填充，不编造链接。
交付方式为 chat 或 both 时，报告正文必须完整出现在对话里，不能只丢一句“已生成”；逐条压缩成一行——“**标题**（日期/状态）— 核心事实；关键数据；来源链接”，板块标题保留，条数不得少于文件版。

使用用户当前语言，默认简体中文。`,
};

function apply(ctx, config) {
  if (!ctx?.skills?.register) return;

  // The skill itself has no dependencies: the Tavily adapter is opt-in, so a
  // deployment without a key still gets the daily report.
  ctx.skills.register(skill);

  // Settings edited in the GUI live in this store instead of the profile patch:
  // the GUI must never rewrite a file the Host composes from several layers, and
  // a store of our own is what makes every save rollback-able. The store is
  // resolved once per mount, so a restart is the only thing that can move it.
  const dataDir = resolveDataDir();
  const configuredLimit = Number(config?.historyLimit?.get?.() ?? DEFAULT_HISTORY_LIMIT);
  const historyLimit = Number.isInteger(configuredLimit) && configuredLimit >= 5
    ? Math.min(configuredLimit, 100)
    : DEFAULT_HISTORY_LIMIT;
  const settingsApi = {
    dataDir,
    historyLimit,
    read: () => readSettings(dataDir),
    history: limit => listHistory(dataDir, { limit: limit ?? historyLimit }),
    restore: id => restoreSettings(dataDir, id),
    // Cookie access stays behind this interface: the tool can read a header for
    // one site, but it can never enumerate cookie values for other purposes.
    cookieHeader: site => cookieHeader(dataDir, site),
    cookieSummary: () => maskJar(readJar(dataDir)),
    cookieClear: site => clearCookies(dataDir, site),
  };

  // The search tool is always mounted: its default channel is the keyless Bing
  // RSS adapter, so a deployment without any API key still gets working search.
  // Tavily only widens what the tool can do (AI answer, page extraction), which
  // is why there is no key-gated registration any more. The tools service is
  // injected lazily so the plugin never hard-depends on it, and every capability
  // is probed before use: an unusual context must not break mounting the skill.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (toolCtx) => {
      if (typeof toolCtx?.effect !== 'function' || typeof toolCtx?.tools?.register !== 'function') return;
      toolCtx.effect(
        () => toolCtx.tools.register(buildSearchTool(() => effectiveConfig(config), settingsApi)),
        'dsh-search-contrl: search_contrl tool',
      );
    });
  }

  // The settings GUI is a client-side contribution, but it reads and writes
  // through the Host: these routes are the only bridge between the renderer and
  // the store. Every route is registered through one effect each so a failing
  // web server cannot take the skill or the search tool down with it.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      if (typeof webCtx?.effect !== 'function' || typeof webCtx?.webServer?.register !== 'function') return;
      for (const route of buildSettingsRoutes({
        dataDir,
        pluginVersion: String(packageJson.version ?? ''),
        historyLimit,
      })) {
        webCtx.effect(
          () => webCtx.webServer.register(route),
          `dsh-search-contrl: settings route ${route.path}`,
        );
      }
    });
  }
}

export { apply, inject, name, Config };
