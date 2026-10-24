#!/usr/bin/env node
/**
 * archive-merge.mjs — 从按天归档里拼出多日窗口（周报用），不依赖「当天是否有空跑」。
 *
 * 用法：
 *   node scripts/archive-merge.mjs --days=7                      # 最近 7 天
 *   node scripts/archive-merge.mjs --date=2026-10-25 --days=7 --digest
 *   node scripts/archive-merge.mjs --days=7 --out=reports/_data/week-merged.json
 *   node scripts/archive-merge.mjs --dir=reports/_data/archive --digest --max=6
 *
 * 归档由 daily-collect.mjs --archive 产生：reports/_data/archive/<日期>.json。
 * 每份快照保存「那次抓到的全部条目」，所以某天没跑时，后一天的快照仍能补出前一天；
 * 完全补不到的日期会被列进 missing —— 报告里必须写明，不要用相邻日期顶替。
 */
import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const BJ = 8 * 3600_000;
const today = new Date(Date.now() + BJ).toISOString().slice(0, 10);
const date = args.date ?? today;
const days = Math.max(1, Number(args.days ?? 7));
const dir = String(args.dir ?? 'reports/_data/archive');
const max = Math.max(1, Number(args.max ?? 8));

// 用北京时间切日期，避免 toISOString 的 UTC 偏移导致整体错一天
const fmt = t => new Date(t + BJ).toISOString().slice(0, 10);
const shiftDay = (d, delta) => fmt(new Date(`${d}T00:00:00+08:00`).getTime() + delta * 86400_000);

const want = [];
for (let i = days - 1; i >= 0; i--) want.push(shiftDay(date, -i));

const snapshots = [];
const unreadable = [];
const items = new Map();
const titleKeys = new Set();
let dupTitles = 0;

if (!fs.existsSync(dir)) {
  process.stderr.write(`[archive-merge] 归档目录不存在：${dir}\n`);
  process.stderr.write('[archive-merge] 先跑一次：node scripts/daily-collect.mjs --archive\n');
  process.exit(2);
}

for (const f of fs.readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
  const day = f.slice(0, 10);
  let data;
  try { data = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); } catch { unreadable.push(day); continue; }
  // 新格式 {uniqueItems}；旧格式 {boards, others}
  const bucket = Array.isArray(data.allItems)
    ? data.allItems
    : Array.isArray(data.uniqueItems)
    ? data.uniqueItems
    : [...Object.values(data.boards ?? {}).flat(), ...(Array.isArray(data.others) ? data.others : [])];
  snapshots.push({ day, count: bucket.length, targetDate: data.targetDate ?? day });
  for (const it of bucket) {
    if (!it?.url || items.has(it.url)) continue;
    const key = String(it.title ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 20);
    if (key && titleKeys.has(key)) { dupTitles++; continue; }
    if (key) titleKeys.add(key);
    items.set(it.url, it);
  }
}

const byDay = {};
for (const day of want) byDay[day] = [];
let outside = 0;
for (const it of items.values()) {
  const d = String(it.at ?? '').slice(0, 10);
  if (byDay[d]) byDay[d].push(it);
  else outside++;
}
for (const day of want) byDay[day].sort((a, b) => String(b.at).localeCompare(String(a.at)));

const missing = want.filter(d => byDay[d].length === 0);
const all = want.flatMap(d => byDay[d]);

const payload = {
  generatedAt: new Date().toISOString(),
  date,
  window: { days, from: want[0], to: want[want.length - 1] },
  archive: { dir, snapshots: snapshots.length, files: snapshots.map(s => s.day), unreadable, missing },
  byDay,
  items: all,
  stats: { snapshots: snapshots.length, total: all.length, outsideWindow: outside, dupTitlesDropped: dupTitles },
};

const json = JSON.stringify(payload, null, 1);
if (args.out) {
  fs.mkdirSync(String(args.out).replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  fs.writeFileSync(String(args.out), json);
}

const cut = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

process.stderr.write(`[archive-merge] 快照 ${snapshots.length} 份 → 窗口内 ${all.length} 条（丢弃同题 ${dupTitles} 条）\n`);
if (unreadable.length) process.stderr.write(`[archive-merge] 读不出：${unreadable.join('、')}\n`);
if (missing.length) process.stderr.write(`[archive-merge] 完全无条目：${missing.join('、')}\n`);

if (args.digest) {
  const lines = [`# 归档合并 ${payload.window.from} ~ ${payload.window.to}（${snapshots.length} 份快照，${all.length} 条）`];
  if (missing.length) lines.push(`\n⚠️ 无覆盖：${missing.join('、')} —— 快照也补不到，报告里要写明，不要用别天顶替。`);
  for (const d of want) {
    const list = byDay[d];
    if (!list.length) { lines.push(`\n## ${d}（0）\n无条目`); continue; }
    lines.push(`\n## ${d}（${list.length} → 取前 ${Math.min(max, list.length)}）`);
    for (const it of list.slice(0, max)) lines.push(`${String(it.at ?? '').slice(0, 16)}｜${cut(it.title)}｜${it.url}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

process.stdout.write(json);
