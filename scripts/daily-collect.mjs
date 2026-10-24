#!/usr/bin/env node
// daily-collect.mjs — 日报「采集阶段」脚本：并发拉取科技/汽车/AI 的公开 RSS，按板块归类、按日期过滤，输出候选清单。
// 目的：把日报从「多轮模型往返 + 逐条抓取」压成「1 次脚本（约 1–2 秒）+ 1 次整理」。
// 用法：
//   node scripts/daily-collect.mjs                          # 今日，14 个 RSS 源，约 1–2 秒
//   node scripts/daily-collect.mjs --date=2026-10-24 --days=3
//   node scripts/daily-collect.mjs --max=10 --out=reports/_data/daily-2026-10-24.json
//   node scripts/daily-collect.mjs --bing="固态电池 量产|光刻机"   # 额外补 Bing 免费 RSS 关键词检索
//   node scripts/daily-collect.mjs --days=7 --digest          # 紧凑摘要（每板块 N 行，给模型读，省 80% token）
// 输出：JSON {date, window, feeds{ok[],fail[]}, boards{板块:[...]}, others[], stats}；带 --digest 输出纯文本摘要

import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const date = args.date ?? today;
const days = Math.max(1, Number(args.days ?? 1));

// ── 事件程度（设置在「搜索控制 → 事件程度」，也可用 --scale 覆盖）─────────
// 大：只写推动行业的事件；中：大 + 中；小：连预告和小更新一起收。
// 脚本只决定「每板块给多少候选」，最终写几条由报告侧按 policy 裁剪。
const SCALE_POLICY = {
  large: { maxPerBoard: 6, reportItems: '8–10', note: '只写推动行业的大事件，要求两个独立来源' },
  medium: { maxPerBoard: 10, reportItems: '12–16', note: '大事件 + 中等事件，预告/泄露带状态标注' },
  small: { maxPerBoard: 14, reportItems: '16–24', note: '连产品小更新与行业小动态一起收' },
};
function readEventScale() {
  const fromArg = String(args.scale ?? '').toLowerCase();
  if (SCALE_POLICY[fromArg]) return fromArg;
  try {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const raw = JSON.parse(fs.readFileSync(`${home}/.dsh/plugin-data/dsh-search-contrl/settings.json`, 'utf8'));
    if (typeof raw?.eventScale === 'string' && SCALE_POLICY[raw.eventScale]) return raw.eventScale;
  } catch {
    // 设置文件不存在或损坏时退回默认档，采集本身不能因此失败。
  }
  return 'medium';
}
const scale = readEventScale();
const policy = SCALE_POLICY[scale];
const maxPerBoard = Math.min(Number(args.max ?? policy.maxPerBoard), 60);
const outFile = args.out ?? null;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ── 源 ────────────────────────────────────────────────────────────────
// 只收录实测可用的公开 RSS（2026-10-24 逐个校验过 item 数）：
// ithome 60 / 36kr 27 / geekpark 24 / infoq 20 / leiphone 20 / electrek 81 / insideevs 19 / ifanr 20 / solidot 20 /
// techcrunch 20 / ars 20 / tmtpost 13 / qbitai 10 / verge 10 / sspai 10
const FEEDS = [
  { id: 'ithome', url: 'https://www.ithome.com/rss/', lang: 'zh', note: 'IT之家：手机/芯片/AI 综合' },
  { id: 'leiphone', url: 'https://www.leiphone.com/feed', lang: 'zh', note: '雷锋网：AI/产业/车企' },
  { id: 'ifanr', url: 'https://www.ifanr.com/feed', lang: 'zh', note: '爱范儿：手机/汽车/早报' },
  { id: 'tmtpost', url: 'https://www.tmtpost.com/rss', lang: 'zh', note: '钛媒体：产业/科技商业' },
  { id: '36kr', url: 'https://www.36kr.com/feed', lang: 'zh', note: '36氪：商业/创投/AI 应用' },
  { id: 'infoq', url: 'https://www.infoq.cn/feed', lang: 'zh', note: 'InfoQ 中国：开发/AI 工程/架构' },
  { id: 'solidot', url: 'https://www.solidot.org/index.rss', lang: 'zh', note: 'Solidot：科学/安全/开源' },
  { id: 'sspai', url: 'https://sspai.com/feed', lang: 'zh', note: '少数派：软件/效率' },
  { id: 'geekpark', url: 'https://www.geekpark.net/rss', lang: 'zh', note: '极客公园：科技产业/访谈' },
  { id: 'verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', note: 'The Verge：科技综合' },
  { id: 'techcrunch', url: 'https://techcrunch.com/feed/', lang: 'en', note: 'TechCrunch：AI/创业' },
  { id: 'ars', url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en', note: 'Ars Technica：科学/航天/安全' },
  { id: 'electrek', url: 'https://electrek.co/feed/', lang: 'en', note: 'Electrek：电动车/国际车型' },
  { id: 'insideevs', url: 'https://insideevs.com/feed/', lang: 'en', note: 'InsideEVs：国际车型' },
];

// ── 板块关键词（命中即归类，可多归；越靠前越优先，避免「研究」「标准」这类泛词误收） ──
// 板块判定：**按顺序取第一个命中的板块**（避免一条新闻同时占 2–3 个板块、把 digest 撑大）。
// 顺序即优先级：先具体产品线（车/手机），再芯片，再 AI，最后通用政策。
const BOARD_RULES = {
  '国内车型': [/比亚迪|蔚来|小鹏|理想汽车|问界|鸿蒙智行|极氪|零跑|小米汽车|长城汽车|吉利|奇瑞|上汽|广汽|智界|享界|尊界|阿维塔|岚图|哪吒|腾势|方程豹|魏牌|坦克|捷途|五菱|新车发布|交付量|智驾/i],
  '国内手机': [/华为|小米|荣耀|OPPO|vivo|魅族|一加|真我|努比亚|红米|REDMI|鸿蒙|HarmonyOS|折叠屏|新机|国行|Mate|Pura|nova/i],
  '芯片半导体': [/芯片|半导体|台积电|TSMC|英伟达|NVIDIA|AMD|Intel|英特尔|光刻|晶圆|HBM|存储芯|3nm|2nm|ASML|高通|联发科|骁龙|天玑|晶圆厂/i],
  '国内 AI': [/大模型|模型发布|开源模型|DeepSeek|智谱|月之暗面|Kimi|通义|豆包|混元|文心|讯飞|MiniMax|阶跃|商汤|Qwen|GLM|百度世界|阿里云|火山引擎/i],
  '国际 AI': [/OpenAI|ChatGPT|Anthropic|Claude|Gemini|DeepMind|Meta AI|Llama|xAI|Grok|Mistral|Copilot|Hugging Face/i],
  '国际车型': [/Tesla|特斯拉|Toyota|BMW|Mercedes|Porsche|Rivian|Lucid|Waymo|Electric Vehicle|Cybertruck|FSD|Hyundai|Ford|GM\b|Volkswagen|BYD overseas/i],
  '航天与科学': [/航天|火箭|卫星|NASA|SpaceX|星舰|登月|探测器|望远镜|量子计算|核聚变|太空|运载|遥感|空间站|嫦娥|天问|论文|Nature\b|Science\b/i],
  '网络安全': [/漏洞|CVE-|勒索|数据泄露|黑客|零日|DDoS|APT攻击|安全公告|网络攻击/i],
  // 政策板块只收真正的监管动作：去掉「国补」这类会命中产品促销的泛词
  '产业政策': [/政策|监管|备案|工信部|网信办|反垄断|关税|法规|白皮书|国家标准|行业标准|征求意见稿|试点|补贴政策/i],
};

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 同时兼容 RSS 2.0 与 Atom。 */
function parseFeed(xml) {
  const items = [];
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map(m => m[0]);
  for (const block of blocks) {
    const grab = tags => {
      for (const t of tags) {
        const r = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i').exec(block);
        if (r) return decodeEntities(r[1]);
      }
      return '';
    };
    const linkTag = grab(['link']);
    const linkHref = /<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? '';
    const url = linkTag && /^https?:/i.test(linkTag) ? linkTag : linkHref;
    items.push({
      title: grab(['title']),
      url,
      desc: grab(['description', 'summary', 'content']).slice(0, 200),
      atRaw: grab(['pubDate', 'published', 'updated', 'dc:date']),
    });
  }
  return items.filter(i => i.title && i.url);
}

function toBeijingTime(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

const from = new Date(new Date(date + 'T00:00:00+08:00').getTime() - (days - 1) * 86400_000);
const to = new Date(new Date(date + 'T23:59:59+08:00').getTime());

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(feed.url, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseFeed(await r.text());
  } finally { clearTimeout(timer); }
}

async function bingRss(query) {
  const q = encodeURIComponent(`${query} ${date}`);
  const url = `https://www.bing.com/search?q=${q}&format=rss&mkt=zh-CN&setlang=zh-CN`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseFeed(await r.text()).map(i => ({
      title: i.title, url: i.url, desc: i.desc,
      source: (() => { try { return new URL(i.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      at: toBeijingTime(i.atRaw),
    }));
  } finally { clearTimeout(timer); }
}

const t0 = Date.now();
const errors = [];
const okFeeds = [];
const all = [];

const jobs = FEEDS.map(async feed => {
  try {
    const items = await fetchFeed(feed);
    okFeeds.push({ id: feed.id, items: items.length });
    for (const it of items) all.push({ ...it, source: feed.id, at: toBeijingTime(it.atRaw) });
  } catch (e) {
    errors.push(`${feed.id}: ${String(e?.message ?? e).slice(0, 80)}`);
  }
});

const bingQueries = args.bing ? String(args.bing).split('|').map(s => s.trim()).filter(Boolean) : [];
const bingJobs = bingQueries.map(async q => {
  try {
    const items = await bingRss(q);
    for (const it of items) all.push({ ...it, atRaw: it.at, title: it.title });
  } catch (e) { errors.push(`bing:${q}: ${String(e?.message ?? e).slice(0, 60)}`); }
});

await Promise.all([...jobs, ...bingJobs]);

// 日期窗口过滤（无日期的保留，标注 unknown）
const windowed = all.filter(it => {
  if (!it.at) return true;
  const t = new Date(it.at.replace(' ', 'T') + '+08:00');
  return t >= from && t <= to;
});

const seen = new Set();
const boards = {};
const others = [];
const uniqueItems = [];
const titleSeen = new Map();
let dupTitles = 0;
for (const it of windowed) {
  if (seen.has(it.url)) continue;
  seen.add(it.url);
  // 同一事件常被多家转载：标题归一化后前 20 字相同即视为重复，保留最早一条，避免「看着条数多、实际全是同一条」。
  const tkey = String(it.title ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 20);
  if (tkey && titleSeen.has(tkey)) { dupTitles++; continue; }
  if (tkey) titleSeen.set(tkey, it.url);
  uniqueItems.push(it);
  const hay = `${it.title} ${it.desc}`;
  const hit = Object.entries(BOARD_RULES).filter(([, res]) => res.some(re => re.test(hay))).map(([b]) => b);
  if (!hit.length) { others.push(it); continue; }
  // 只进优先级最高的板（其它命中记为 alsoIn，便于人工判断是否归错）
  if (hit.length > 1) it.alsoIn = hit.slice(1);
  (boards[hit[0]] ||= []).push(it);
}

const byAt = (a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''));
for (const b of Object.keys(boards)) boards[b] = boards[b].sort(byAt).slice(0, maxPerBoard);
others.sort(byAt);

// ── 覆盖度统计（--audit 用来找「哪些天/哪些源漏了」）──────────────────
function byDayCounts(items) {
  const m = {};
  for (const it of items) {
    const d = String(it.at ?? '').slice(0, 10) || 'unknown';
    m[d] = (m[d] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
}
function bySourceCounts(items) {
  const m = {};
  for (const it of items) m[it.source ?? 'unknown'] = (m[it.source ?? 'unknown'] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort(([, a], [, b]) => b - a));
}

// ── 跟踪清单：新品牌 / 创业者公司（与 scripts/watchlist.mjs 共用同一份清单）──
// 这类主体常常被板块规则归到 others 或被同题新闻淹没，采集完自动比对一遍。
const watchlistFile = String(args['watchlist-file'] ?? 'reports/_data/watchlist.json');
const watchlistOff = args.watchlist === '0' || args.watchlist === 'false';
let watchlist = [];
if (!watchlistOff) {
  try {
    const raw = JSON.parse(fs.readFileSync(watchlistFile, 'utf8'));
    if (Array.isArray(raw)) watchlist = raw.filter(w => Array.isArray(w.keywords) && w.keywords.length);
  } catch { watchlist = []; }
}
const watchlistHits = [];
if (watchlist.length) {
  for (const it of uniqueItems) {
    const blob = `${it.title ?? ''} ${it.desc ?? ''}`.toLowerCase();
    for (const w of watchlist) {
      if (!w.keywords.some(k => blob.includes(String(k).toLowerCase()))) continue;
      watchlistHits.push({ name: w.name, at: it.at ?? '', title: it.title ?? '', url: it.url ?? '' });
    }
  }
  watchlistHits.sort(byAt);
}

const payload = {
  generatedAt: new Date().toISOString(),
  date,
  scale,
  scalePolicy: policy,
  window: { days, from: from.toISOString(), to: to.toISOString() },
  feeds: { ok: okFeeds, fail: errors },
  boards,
  others: others.slice(0, Number(args["others-max"] ?? 120)),
  watchlist: watchlist.map(w => w.name),
  watchlistHits: watchlistHits.slice(0, 60),
  stats: {
    elapsedMs: Date.now() - t0,
    totalItems: windowed.length,
    uniqueItems: uniqueItems.length,
    dupTitlesDropped: dupTitles,
    boardCounts: Object.fromEntries(Object.entries(boards).map(([b, v]) => [b, v.length])),
    byDay: byDayCounts(uniqueItems),
    bySource: bySourceCounts(uniqueItems),
  },
};

const json = JSON.stringify(payload, null, 1);
if (outFile) {
  fs.mkdirSync(String(outFile).replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  fs.writeFileSync(outFile, json);
}
process.stderr.write(`[daily-collect] ${windowed.length} 条 / ${okFeeds.length}源 / ${payload.stats.elapsedMs}ms / 事件程度 ${scale}（目标 ${policy.reportItems} 条） ${JSON.stringify(payload.stats.boardCounts)}\n`);
if (errors.length) process.stderr.write(`[daily-collect] 失败: ${errors.join('; ')}\n`);
if (watchlist.length) {
  const who = [...new Set(watchlistHits.map(h => h.name))];
  process.stderr.write(`[daily-collect] 跟踪清单 ${watchlist.length} 实体 / 命中 ${watchlistHits.length} 条${who.length ? '：' + who.join('、') : ''}\n`);
}

// ── --audit：覆盖度审计（哪天/哪个源偏少，直接暴露「遗漏」而不是事后猜）──
if (args.audit) {
  const dayCounts = payload.stats.byDay;
  const entries = Object.entries(dayCounts);
  const thin = entries.filter(([, n]) => n < 5);
  const lines = [`# 覆盖审计 ${date}（窗口 ${days} 天，去重后 ${uniqueItems.length} 条，标题重复丢弃 ${dupTitles} 条）`, ''];
  lines.push('| 日期 | 条数 |', '|---|---|');
  for (const [d, n] of entries) lines.push(`| ${d} | ${n} |`);
  lines.push('', '| 源 | 条数 |', '|---|---|');
  for (const [s, n] of Object.entries(payload.stats.bySource)) lines.push(`| ${s} | ${n} |`);
  if (thin.length) lines.push('', `⚠️ 覆盖不足（<5 条）：${thin.map(([d, n]) => `${d}(${n})`).join('、')} —— 该日请单独补搜或读归档。`);
  else lines.push('', '✅ 每天都有 ≥5 条，覆盖正常。');
  if (errors.length) lines.push('', `⚠️ 源失败：${errors.join('；')}`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

// ── --digest：给模型读的紧凑清单（每行：日期｜标题｜链接），比整份 JSON 省约 80% token ──
// 每板块默认只留 3 行（--digest-max=N 可调）：日报一天每板块顶多 2–3 条，留多了纯占上下文。
if (args.digest) {
  const cut = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const cap = Math.max(1, Number(args['digest-max'] ?? 3));
  const lines = [];
  lines.push(`# 候选 ${windowed.length} 条 / ${okFeeds.length} 源 / ${payload.stats.elapsedMs}ms / 窗口 ${from.toISOString().slice(0,10)}~${to.toISOString().slice(0,10)} / 事件程度 ${scale}（每板块最多 ${cap} 行）`);
  for (const [board, items] of Object.entries(boards)) {
    lines.push(`\n## ${board}（${items.length} → 取前 ${Math.min(cap, items.length)}）`);
    for (const it of items.slice(0, cap)) lines.push(`${(it.at ?? '').slice(0, 16)}｜${cut(it.title)}｜${it.url}`);
  }
  if (others.length) {
    lines.push(`\n## 未归类（${others.length}）`);
    for (const it of others.slice(0, 15)) lines.push(`${(it.at ?? '').slice(0, 16)}｜${cut(it.title)}｜${it.url}`);
  }
  if (watchlist.length) {
    lines.push(`\n## 跟踪清单命中（${watchlistHits.length}）`);
    if (watchlistHits.length) for (const h of watchlistHits.slice(0, 20)) lines.push(`${(h.at ?? '').slice(0, 16)}｜${h.name}｜${cut(h.title)}｜${h.url}`);
    else lines.push('跟踪清单：本次无命中');
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}
process.stdout.write(json);
