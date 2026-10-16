import { Config, effectiveConfig } from './config.js';
import { buildSearchTool, TECH_DAILY_SEARCH_TOOL } from './search-tool.js';

const name = 'tech-daily-report';
const inject = ['skills'];

const skill = {
  name: 'tech-daily-report',
  description: '生成每日或指定日期范围的科技日报，覆盖国内外 AI、国内手机、国内外车型及可核验的科技成就；发送日报时自动使用。',
  whenToUse: '用户说日报、发送日报、今日科技新闻、指定日期范围、最近7天、本周总结，或要求重新发送日报时使用。',
  invocation: {
    modelInvocable: true,
    userInvocable: true,
  },
  content: `# 科技日报插件

你负责生成可核查的中文科技日报。每次用户要求发送日报，都重新检索并完整输出，不要只回复“已发送”。

## 日期模式
- 未指定日期：生成今日科技日报，使用当前日期和时区。
- 指定起止日期：包含起始日和结束日，标题写明实际日期范围。
- “本周/一周总结”：按当前自然周周一至周日；“最近7天”：按最近连续7个自然日。
- 日期无效、倒置或无法可靠覆盖时先询问，不自行编造。

## 渠道矩阵（不只是搜索）
搜索工具可能不可用或被限流，因此每个板块都必须按渠道清单逐项尝试，同一事实尽量由“官方渠道+独立渠道”各一条来源支撑。
- 国内手机：品牌官网新品页与对比页（huawei.com/mi.com/honor.com/oppo.com/vivo.com/meizu.com/realme.com 等，注意 New/新品标记）、官方微博微信与发布会直播页、电商官方旗舰店预约开售页、工信部入网许可与3C认证与无线电核准、行业媒体与GSMArena等数据库、系统更新公告。
- 国内车型：品牌官网车型页与官方公告、工信部新车申报公示与免征购置税目录、车企产销与交付快报和财报、中汽协与乘联会数据、车展官方发布、专业媒体续航智驾安全测试报告。
- 国内 AI：公司官网与技术博客、GitHub/Hugging Face/ModelScope 模型卡与开源仓库、官方微信公众号微博与发布会、arXiv 与会议页面、网信办备案与算法备案清单、行业媒体与开发者社区。
- 国际 AI 与国际车型：官方博客产品页开发者文档安全报告与模型卡、监管与司法文件（NHTSA、欧盟 AI 法案、法院文件）、赛事组织（FIA/WEC/F1/勒芒）与权威测试机构、公司财报与投资者关系页面。

## 专用检索工具
本插件在配置了 Tavily API Key 后会注册 \`tech_daily_search\` 工具，不依赖内置 web_search：
- \`action: "search"\`：传入 \`query\` 做联网检索，返回 answer 与带 url/title/content/published_date 的结果列表，可用 \`include_domains\` 限定官网域名（如 \`["honor.com"]\`），用 \`exclude_domains\` 排除噪声站点。
- \`action: "extract"\`：传入 \`urls\`（1 至 20 个）直接提取页面正文，用于官网导航占满页面、正文被截断的情况。实测荣耀官网手机页可提取约 19 万字符，远多于普通抓取。
内置 web_search 不可用时优先改用该工具；该工具报错提示缺少 Key 时，在日报的检索说明里写明此限制，不要据此跳过板块。

优先用 \`search\` 定位具体页面，再用 \`extract\` 取回正文参数，而不是靠猜 URL。厂商官网的规格页路径并不统一，猜错会拿到 404：荣耀官网规格页是 \`/spec\`（\`/specs\` 返回 404），产品资讯在 \`/cn/news/\`，活动页在 \`/cn/activity/\`，上市公告在 \`/cn/shop/notice-*\`。若某条路径 404，应回到 \`search\` 重取正确链接，而不是判定该品牌没有信息。

## 增强检索
将检索拆成至少六组并行主题：国内 AI、国际 AI、国内手机、国内车型、国际车型、科技成就/纪录。每组使用中文和英文关键词，并加入发布、上市、交付、公告、成就、纪录、销量、续航、发布会等意图词；车型额外检索量产、概念车、智驾、安全测试、海外。优先官方公告、产品页、监管机构、论文、赛事组织和可靠媒体。重大事件至少交叉核验官方来源与可靠媒体。核对原文发布日期是否在范围内，不把搜索摘要单独当作事实。搜索工具不可用时改用直接抓取渠道矩阵中的具体 URL 继续采集，不要因为搜索失败就跳过一个板块。官网页面被导航栏占满或正文截断时，改抓更具体的子页面（产品页、规格页、新闻详情页、支持公告页）或换渠道交叉确认，不要直接判定“没有信息”。

## 检索新鲜度（防止拿到过时信息）
泛化查询词（如“新机发布 汇总”“本月新车盘点”“本周新机”）会命中长期存在的对比页与选购攻略页，这类页面更新滞后于实际发布，容易把已被换代的产品当成最新款。必须按以下步骤检索：先探测代际——检索“品牌+最新旗舰/最新一代”确认当前在发的是第几代，再逐型号精确检索（第一轮仅型号名，第二轮“型号名+发布/售价/首销/评分”），不以“汇总”“盘点”“选购指南”类词作为主要入口；每个板块至少对一家品牌官网执行一次 \`action: "extract"\`，把官网展示的型号与检索结果比对，官网更新则以官网为准并立即重查新型号；长于一天的日期范围要在查询词里加入具体日期，而不是只写“本周”“本月”。判断过时的信号：结果称某型号“最新”“即将发布”但官网已有更新型号；结果是选购攻略或参数对比页而非新闻页；结果日期早于本次范围且不含新发布；同品牌结果出现更早代际（如查到 11S 而实际已有 12）。命中更早代际时不得当作当前产品写入日报，应重新确认最新代际。

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

## 输出格式
标题用“科技日报｜日期”或“科技周报｜日期范围”。先给不超过80字的今日要点/本周判断，再按上述六个板块输出8至16条。每条包含新闻标题、核心事实、为什么重要、成就/关键指标（如适用）和来源链接。无重要动态时也保留对应板块并明确说明。长日期范围最后增加趋势总结和后续关注。传闻、预告、测试、正式发布、上市、交付分别标注；搜索失败或来源受限时如实说明，不使用旧闻填充，不编造链接。

使用用户当前语言，默认简体中文。`,
};

function apply(ctx, config) {
  if (!ctx?.skills?.register) return;

  // The skill itself has no dependencies: the Tavily adapter is opt-in, so a
  // deployment without a key still gets the daily report.
  ctx.skills.register(skill);

  // The search tool exists only while a Tavily key is configured. The tools
  // service is injected lazily so the plugin never hard-depends on it, and
  // every capability below is probed before use: an unusual context must not
  // break mounting the skill.
  let toolFiber;

  const syncTool = () => {
    const want = effectiveConfig(config).tavilyApiKey !== '';

    if (want && toolFiber === undefined && typeof ctx.inject === 'function') {
      toolFiber = ctx.inject(['tools'], (toolCtx) => {
        if (typeof toolCtx?.effect !== 'function' || typeof toolCtx?.tools?.register !== 'function') return;
        toolCtx.effect(
          () => toolCtx.tools.register(buildSearchTool(() => effectiveConfig(config))),
          'dsh-tech-daily-report: tech_daily_search tool',
        );
      });
      return;
    }

    if (!want && toolFiber !== undefined) {
      if (typeof toolFiber === 'function') toolFiber();
      toolFiber = undefined;
    }
  };

  syncTool();

  // Live settings writes commit into the config references instead of
  // remounting the row, so re-derive the registration when they land.
  if (typeof ctx.on === 'function') {
    ctx.on('config-changed', syncTool);
  }
}

export { apply, inject, name, Config };
