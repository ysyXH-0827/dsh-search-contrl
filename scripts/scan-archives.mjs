/**
 * scan-archives: build month candidate lists from IT之家 daily archives.
 *
 * Why this exists: the monthly report pipeline used to walk 30–31 archive pages
 * in a serial PowerShell loop, which cost 3–4 minutes per month and re-fetched
 * everything on every run. This script fetches days concurrently (default 8),
 * caches raw HTML on disk (default 12h), and writes one candidate list per
 * section using the same `MM-DD HH:MM|标题|URL` format the scouts consume.
 *
 * Usage:
 *   node scripts/scan-archives.mjs --month 2026-07 --out ../reports/.tools/m78 --concurrency 8
 *   node scripts/scan-archives.mjs --month 2026-08 --out ../reports/.tools/m78 --refresh
 *
 * Output: <out>/<month>-<section>.txt plus a timing summary on stdout.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Candidate filters per section. Keep them coarse: humans make the final cut. */
const SECTIONS = {
  ai: '大模型|智能体|千问|DeepSeek|豆包|混元|文心|Kimi|智谱|MiniMax|通义|昇腾|寒武纪|OpenAI|Anthropic|Gemini|Claude|GPT|Llama|Mistral|英伟达|NVIDIA|Meta|xAI|微软|谷歌|芯片|算力|Hugging',
  devices: '手机|平板|折叠|麒麟|鸿蒙|MagicOS|澎湃|iPhone|Galaxy|Mate|耳机|手表|eSIM|小米|荣耀|OPPO|vivo',
  auto: '汽车|车型|新车|续航|智驾|电池|充电|车企|SUV|轿车|MPV|召回|交付|销量',
  security: '漏洞|CVE|补丁|法案|监管|处罚|攻击|泄露|量子|诺贝尔|论文|纪录|突破|标准|审查|生效',
};

/** A candidate must look like an event, not a promotion. */
const EVENT = /发布|上市|交付|开源|正式|量产|首销|开售|漏洞|在野|法案|签署|生效|纪录|突破|标准|召回|审查|收购|破产|下线|补丁/;
const PROMO = /大促|券后|秒杀|补贴|清仓|到手价|好价|新低|冲量|捡漏|曝光|爆料|传闻|消息称|预热|预告|图赏|上手/;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ITEM_RE = /class="t" href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<i>(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})<\/i>/g;

function parseArgs(argv) {
  const args = { month: '', out: join(HERE, '..', 'reports', '.tools', 'scan'), concurrency: 8, cacheHours: 12, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--month') args.month = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--concurrency') args.concurrency = Math.min(Number(argv[++i]) || 8, 12);
    else if (a === '--cache-hours') args.cacheHours = Number(argv[++i]) || 12;
    else if (a === '--refresh') args.refresh = true;
  }
  if (!/^\d{4}-\d{2}$/.test(args.month)) throw new Error('--month YYYY-MM is required');
  return args;
}

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1) - 1).getUTCDate();
}

async function readCache(path, hours) {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > hours * 3600 * 1000) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function fetchDay(month, day, cacheDir, cacheHours, refresh) {
  const dd = String(day).padStart(2, '0');
  const date = `${month}-${dd}`;
  const cachePath = join(cacheDir, `${date}.html`);
  if (!refresh) {
    const hit = await readCache(cachePath, cacheHours);
    if (hit !== null) return { date, html: hit, cached: true };
  }
  const url = `https://www.ithome.com/list/${date}.html`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  if (!res.ok) throw new Error(`${date} HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(cachePath, html, 'utf8');
  return { date, html, cached: false };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const cacheDir = join(args.out, '.cache');
  await mkdir(cacheDir, { recursive: true });

  const total = daysInMonth(args.month);
  const started = Date.now();
  const days = Array.from({ length: total }, (_, i) => i + 1);

  const results = [];
  let cursor = 0;
  let cacheHits = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= days.length) return;
      const day = days[index];
      try {
        const row = await fetchDay(args.month, day, cacheDir, args.cacheHours, args.refresh);
        if (row.cached) cacheHits += 1;
        results.push(row);
      } catch (error) {
        results.push({ date: `${args.month}-${String(day).padStart(2, '0')}`, html: '', error: String(error.message ?? error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, days.length) }, worker));

  const buckets = Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, []]));
  let parsed = 0;
  for (const row of results) {
    if (!row.html) continue;
    parsed += 1;
    for (const m of row.html.matchAll(ITEM_RE)) {
      const title = m[2];
      const url = m[1];
      const ts = m[3];
      if (!EVENT.test(title) || PROMO.test(title)) continue;
      const line = `${ts.slice(5, 16)}|${title}|${url}`;
      for (const [section, rx] of Object.entries(SECTIONS)) {
        if (new RegExp(rx).test(title)) buckets[section].push(line);
      }
    }
  }

  const summary = [];
  for (const [section, lines] of Object.entries(buckets)) {
    const unique = [...new Set(lines)];
    const file = join(args.out, `${args.month.slice(2)}-${section}.txt`);
    await writeFile(file, `${unique.join('\n')}\n`, 'utf8');
    summary.push(`${section}=${unique.length}`);
  }

  const errors = results.filter((r) => r.error).map((r) => r.error);
  console.log(JSON.stringify({
    month: args.month,
    days: total,
    fetched: parsed,
    cache_hits: cacheHits,
    errors,
    sections: summary,
    elapsed_ms: Date.now() - started,
    concurrency: args.concurrency,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
