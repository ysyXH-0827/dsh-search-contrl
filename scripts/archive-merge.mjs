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
 * 归档由 daily-collect.mjs --archive 产生（每次跑写 reports/_data/archive/<日期>.json）。
 * 缺哪天就报哪天，不拿相邻日期顶替。
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

function shiftDay(d, delta) {
  const t = new Date(`${d}T00:00:00+08:00`).getTime() + delta * 86400_000;
  return new Date(t + BJ).toISOString().slice(0, 10);
}

const want = [];
for (let i = days - 1; i >= 0; i--) want.push(shiftDay(date, -i));

const present = [];
const missing = [];
const items = new Map(); // url -> item
const titleKeys = new Set();
let dupTitles = 0;

for (const day of want) {
  const file = `${dir}/${day}.json`;
  if (!fs.existsSync(file)) { missing.push(day); continue; }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { missing.push(`${day}(损坏)`); continue; }
  present.push(day);
  const bucket = [];
  for (const arr of Object.values(data.boards ?? {})) if (Array.isArray(arr)) bucket.push(...arr);
  if (Array.isArray(data.others)) bucket.push(...data.others);
  if (Array.isArray(data.watchlistHits)) for (const h of data.watchlistHits) bucket.push({ title: h.title, url: h.url, at: h.at, desc: '', source: 'watchlist' });
  for (const it of bucket) {
    if (!it?.url || items.has(it.url)) continue;
    const tkey = String(it.title ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 20);
    if (tkey && titleKeys.has(tkey)) { dupTitles++; continue; }
    if (tkey) titleKeys.add(tkey);
    items.set(it.url, it);
  }
}

const all = [...items.values()].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
const byDay = {};
for (const it of all) {
  const d = String(it.at ?? '').slice(0, 10) || 'unknown';
  (byDay[d] ||= []).push(it);
}

const payload = {
  generatedAt: new Date().toISOString(),
  date,
  window: { days, from: want[0], to: want[want.length - 1] },
  archive: { dir, present, missing },
  byDay,
  items: all,
  stats: { files: present.length, total: all.length, dupTitlesDropped: dupTitles },
};

const json = JSON.stringify(payload, null, 1);
if (args.out) {
  fs.mkdirSync(String(args.out).replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  fs.writeFileSync(String(args.out), json);
}

const cut = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

if (missing.length) process.stderr.write(`[archive-merge] 缺 ${missing.length} 天：${missing.join('、')}\n`);
process.stderr.write(`[archive-merge] 归档 ${present.length}/${days} 天 → ${all.length} 条（丢弃同题 ${dupTitles} 条）\n`);

if (args.digest) {
  const lines = [`# 归档合并 ${payload.window.from} ~ ${payload.window.to}（${present.length}/${days} 天，${all.length} 条）`];
  if (missing.length) lines.push(`\n⚠️ 缺档：${missing.join('、')} —— 这些天没有快照，报告里要写明，不要用别天顶替。`);
  for (const d of want) {
    const list = byDay[d] ?? [];
    if (!list.length) { lines.push(`\n## ${d}（0）\n无条目`); continue; }
    lines.push(`\n## ${d}（${list.length} → 取前 ${Math.min(max, list.length)}）`);
    for (const it of list.slice(0, max)) lines.push(`${(it.at ?? '').slice(0, 16)}｜${cut(it.title)}｜${it.url}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

process.stdout.write(json);
