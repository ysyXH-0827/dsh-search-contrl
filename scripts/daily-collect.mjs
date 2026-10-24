#!/usr/bin/env node
// daily-collect.mjs — 日报「采集阶段」脚本：并发拉取科技/汽车/AI 的公开 RSS，按板块归类、按日期过滤，输出候选清单。
// 目的：把日报从「多轮模型往返 + 逐条抓取」压成「1 次脚本（约 1–2 秒）+ 1 次整理」。
// 用法：
//   node scripts/daily-collect.mjs                          # 今日，14 个 RSS 源，约 1–2 秒
//   node scripts/daily-collect.mjs --date=2026-10-24 --days=3
//   node scripts/daily-collect.mjs --max=10 --out=reports/_data/daily-2026-10-24.json
//   node scripts/daily-collect.mjs --bing="固态电池 量产|光刻机"   # 额外补 Bing 免费 RSS 关键词检索
//   node scripts/daily-collect.mjs --days=7                   # 默认输出紧凑摘要（每板块 3–6 行，省 ~90% token）
//   node scripts/daily-collect.mjs --days=7 --json            # 需要整份 JSON 时显式要求（约 86KB，慎用）
//   node scripts/daily-collect.mjs --concurrency=5 --total-timeout=45000   # 有界并发 / 总时长看门狗（默认 5 源 / 45 秒）
//   node scripts/daily-collect.mjs --refresh --cache-ttl=0    # 绕过来源缓存（默认 10 分钟内命中缓存，重跑不压源）
// 输出：默认纯文本摘要；--json 输出 JSON {date, window, feeds{ok[],fail[]}, boards{板块:[...]}, others[], stats}

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

// ── 源缓存：同一窗口重跑（多次整理/补跑/重试）不再压源，顺带避开 429 ──────
// 默认 10 分钟内命中；--cache-ttl=<秒> 调 TTL，0 关闭整层；--refresh 强制重抓。
const CACHE_DIR = 'scripts/.cache/feeds';
const CACHE_TTL_MS = Math.max(0, Number(args['cache-ttl'] ?? 600) * 1000);
const CACHE_STALE_MS = 24 * 3600_000;   // 抓取失败时允许回退的「陈旧」上限
const cacheOn = CACHE_TTL_MS > 0 && !args.refresh;
const cachePath = key => `${CACHE_DIR}/${String(key).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}.json`;

function cacheRead(key) {
  if (!cacheOn) return null;
  try {
    const e = JSON.parse(fs.readFileSync(cachePath(key), 'utf8'));
    return Array.isArray(e?.items) ? { at: Number(e.at ?? 0), items: e.items } : null;
  } catch { return null; }
}

function cacheWrite(key, items) {
  // 空结果不落盘：否则一次 429 的「0 条」会被当成事实缓存一整天。
  if (!cacheOn || !Array.isArray(items) || !items.length) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(key), JSON.stringify({ at: Date.now(), key: String(key), items }));
  } catch { /* 缓存写不进不能影响采集 */ }
}

// ── 源 ────────────────────────────────────────────────────────────────
// 只收录实测可用的公开 RSS（2026-10-24 逐个校验过 item 数）：
// ithome 60 / 36kr 27 / geekpark 24 / infoq 20 / leiphone 20 / electrek 81 / insideevs 19 / ifanr 20 / solidot 20 /
// techcrunch 20 / ars 20 / tmtpost 19 / 36kr 27 / infoq 20 / verge 10 / sspai 10
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
let cacheHits = 0;
let staleHits = 0;

// 有界并发：14 个源一次性全发会同时压两端 socket，也是 undici 断言崩溃的诱因之一（LESSONS 规则 #7）。
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 5));

const jobs = [mapLimit(FEEDS, CONCURRENCY, async feed => {
  const push = items => { for (const it of items) all.push({ ...it, source: feed.id, at: toBeijingTime(it.atRaw) }); };
  const hit = cacheRead(feed.id);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) {
    cacheHits += 1;
    okFeeds.push({ id: feed.id, items: hit.items.length, cached: true });
    push(hit.items);
    return;
  }
  try {
    const items = await fetchFeed(feed);
    cacheWrite(feed.id, items);
    okFeeds.push({ id: feed.id, items: items.length });
    push(items);
  } catch (e) {
    // 抓取失败先看有没有 24h 内的旧缓存：少一个源的候选，比整次采集缺一块代价大。
    if (hit && Date.now() - hit.at <= CACHE_STALE_MS) {
      staleHits += 1;
      errors.push(`${feed.id}: 抓取失败，回退 ${Math.round((Date.now() - hit.at) / 60000)} 分钟前缓存（${String(e?.message ?? e).slice(0, 40)}）`);
      okFeeds.push({ id: feed.id, items: hit.items.length, cached: true, stale: true });
      push(hit.items);
      return;
    }
    errors.push(`${feed.id}: ${String(e?.message ?? e).slice(0, 80)}`);
  }
})];

const bingQueries = args.bing ? String(args.bing).split('|').map(s => s.trim()).filter(Boolean) : [];
const bingJobs = bingQueries.map(async q => {
  const key = `bing-${q}`;
  const push = items => { for (const it of items) all.push({ ...it, atRaw: it.at, title: it.title }); };
  const hit = cacheRead(key);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) { cacheHits += 1; push(hit.items); return; }
  try {
    const items = await bingRss(q);
    cacheWrite(key, items);
    push(items);
  } catch (e) { errors.push(`bing:${q}: ${String(e?.message ?? e).slice(0, 60)}`); }
});

// ── 进程级兜底：undici 偶发在 socket end 回调里抛断言（Parser.finish assert(!this.paused)）──
// 该异常不在 Promise 拒绝链上，per-feed try/catch 接不住 → 进程直接退出、stdout 归零，整份候选白跑。
// 记一条降级后继续：少一个源，好过整次采集丢掉。
let degraded = 0;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, e => {
    degraded += 1;
    errors.push(`${ev}: ${String(e?.message ?? e).slice(0, 120)}`);
  });
}
// 兜底之后还得有出口：丢掉的那个 promise 永不 settle，Promise.all 会挂住，
// 所以加一个总时长看门狗，到点就用「已经收上来的条目」继续跑完。
const TOTAL_TIMEOUT_MS = Math.max(3000, Number(args['total-timeout'] ?? 45000));
let deadlineTimer;
const deadline = new Promise(res => {
  deadlineTimer = setTimeout(() => {
    degraded += 1;
    errors.push(`deadline: ${TOTAL_TIMEOUT_MS}ms 未收完，用已收条目继续`);
    res(null);
  }, TOTAL_TIMEOUT_MS);
});
await Promise.race([Promise.all([...jobs, ...bingJobs]), deadline]);
clearTimeout(deadlineTimer);

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
    cacheHits,
    staleHits,
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

// ── --archive：按天落一份快照（RSS 只留最近 20–60 条，周初内容必须靠归档补）──
// 设计成幂等：同一天重复跑只覆盖当天文件，不会重复累加。
const archiveDir = args.archive ? String(args.archive === 'true' ? 'reports/_data/archive' : args.archive) : null;
if (archiveDir) {
  fs.mkdirSync(archiveDir, { recursive: true });
  const day = date; // 用采集目标日，而不是运行日：补跑历史窗口也能落到正确日期
  const file = `${archiveDir}/${day}.json`;
  // 存「本次抓到的全部条目」而不是只存当日窗口：即使某天没跑，后一天的快照也能覆盖前一天，
  // archive-merge 据此补出缺失日期（RSS 一般保留最近 20-60 条，约 1-3 天）。
  const seenAll = new Set();
  const allItems = all.filter(it => (it?.url && !seenAll.has(it.url) ? (seenAll.add(it.url), true) : false));
  const snapshot = JSON.stringify({
    generatedAt: payload.generatedAt,
    targetDate: day,
    uniqueItems,          // 当日窗口内的条目
    allItems,             // 本次抓到的全部条目：供未来补跑前几天的快照
    stats: payload.stats,
  }, null, 1);
  fs.writeFileSync(file, snapshot);
  fs.appendFileSync(`${archiveDir}/index.log`, `${new Date().toISOString()} ${day} ${payload.stats.uniqueItems} 条 ${file}\n`);
  process.stderr.write(`[daily-collect] 已归档 ${file}（快照含全部 ${uniqueItems.length} 条）\n`);
  // 定时任务场景：归档后不再往 stdout 喷整份 JSON（几十 KB），有 --out 时才输出
  if (!outFile) process.exit(0);
}
process.stderr.write(`[daily-collect] ${windowed.length} 条 / ${okFeeds.length}源 / ${payload.stats.elapsedMs}ms / 事件程度 ${scale}（目标 ${policy.reportItems} 条） ${JSON.stringify(payload.stats.boardCounts)}\n`);
if (degraded) process.stderr.write(`[daily-collect] ⚠️ 降级 ${degraded} 次（崩溃/超时兜底），结果可能缺少个别源\n`);
if (cacheHits || staleHits) process.stderr.write(`[daily-collect] 源缓存命中 ${cacheHits} 个源（陈旧回退 ${staleHits}）${cacheOn ? '' : '；缓存已关闭'}\n`);
if (errors.length) process.stderr.write(`[daily-collect] 失败: ${errors.join('; ')}\n`);
if (watchlist.length) {
  const who = [...new Set(watchlistHits.map(h => h.name))];
  process.stderr.write(`[daily-collect] 跟踪清单 ${watchlist.length} 实体 / 命中 ${watchlistHits.length} 条${who.length ? '：' + who.join('、') : ''}\n`);
}

// ── --audit：覆盖度审计（哪天/哪个源偏少，直接暴露「遗漏」而不是事后猜）──
if (args.audit) {
  const dayCounts = payload.stats.byDay;
  // 关键：必须遍历「请求窗口里的每一天」。只遍历 dayCounts 的话，一条数据都没有的日子根本不会出现在表里，
  // 于是无论缺多少天都会报「✅ 覆盖正常」——这就是旧版的假绿灯（--days=14 只盖住 9 天仍报正常）。
  const dayList = Array.from({ length: days }, (_, i) =>
    new Date(from.getTime() + i * 86400_000 + 8 * 3600_000).toISOString().slice(0, 10));
  const missing = dayList.filter(d => !dayCounts[d]);
  const thin = dayList.filter(d => dayCounts[d] && dayCounts[d] < 5);
  const noDate = windowed.filter(it => !it.at).length;
  const lines = [`# 覆盖审计 ${date}（窗口 ${days} 天，去重后 ${uniqueItems.length} 条，标题重复丢弃 ${dupTitles} 条）`, ''];
  lines.push('| 日期 | 条数 |', '|---|---|');
  for (const d of dayList) lines.push(`| ${d}${missing.includes(d) ? '（缺失）' : ''} | ${dayCounts[d] ?? 0} |`);
  lines.push('', '| 源 | 条数 |', '|---|---|');
  for (const [s, n] of Object.entries(payload.stats.bySource)) lines.push(`| ${s} | ${n} |`);
  // 连续覆盖天数（截至窗口末日往前数）：这才是「多长的窗口还有真实数据」的可行动指标。
  let run = 0;
  for (let i = dayList.length - 1; i >= 0 && dayCounts[dayList[i]]; i--) run += 1;
  if (missing.length) lines.push('', `❌ 窗口内 ${missing.length} 天没有任何条目：${missing.join('、')} —— 请求天数超过了源能覆盖的深度（RSS 只保留最近 20–100 条）。`);
  if (thin.length) lines.push('', `⚠️ 覆盖不足（<5 条）：${thin.map(d => `${d}(${dayCounts[d]})`).join('、')} —— 该日请单独补搜或读归档。`);
  if (!missing.length && !thin.length) lines.push('', '✅ 窗口内每天都有 ≥5 条，覆盖正常。');
  lines.push('', `连续覆盖（截至 ${dayList[dayList.length - 1]}）：${run} / ${days} 天${run < days ? ' —— 再往前需要读 reports/_data/archive/ 补' : ''}`);
  if (noDate) lines.push(`注：另有 ${noDate} 条无发布日期，未计入日期表。`);
  if (errors.length) lines.push('', `⚠️ 源失败/降级：${errors.join('；')}`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

// ── 默认输出：给模型读的紧凑清单（每行：日期｜标题｜链接），比整份 JSON 省约 90% token ──
// 实测 --days=7：摘要 8,614 字符 vs 整份 JSON 86,635 字符（10.1×）。整份 JSON 改成显式 --json 才吐：
// 「想看一眼」和「要喂下游」是两种用法，默认取便宜的那个，--digest 保留兼容（等价于默认）。
// 每板块行数：单日默认 3 行、多日窗口默认 6 行（--digest-max=N 可调）：日报一天每板块顶多 2–3 条，周报要铺开。
if (!args.json) {
  const cut = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
  // 单日默认 3 行；多日窗口（周报/月报）默认 6 行，否则模型看不全 30+ 条候选。
  const capDefault = Number(args.days ?? 1) > 1 ? 6 : 3;
  const cap = Math.max(1, Number(args['digest-max'] ?? capDefault));
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
  process.stderr.write('[daily-collect] 完整 JSON 用 --json 或 --out=<path>\n');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}
process.stdout.write(json);
