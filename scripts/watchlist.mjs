#!/usr/bin/env node
/**
 * watchlist.mjs — 新品牌 / 创业者公司跟踪清单
 *
 * 用法：
 *   node scripts/watchlist.mjs --in=reports/_data/week-2026-10-19-full2.json
 *   node scripts/watchlist.mjs --in=reports/_data/daily-2026-10-24.json --days=2
 *   node scripts/watchlist.mjs --list                    列出清单
 *   node scripts/watchlist.mjs --add="ISHO|今日宜休|王腾" 新增一条（实体名前加 --name=）
 *
 * 清单文件：reports/_data/watchlist.json
 *   [{ "name": "ISHO（王腾·今日宜休）", "since": "2026-10", "keywords": ["ISHO", "今日宜休", "王腾"] }]
 *
 * 输出：命中的条目按实体分组，打印 markdown 表格（时间｜实体｜标题｜链接）。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const ROOT = process.cwd();
const LIST = path.join(ROOT, 'reports/_data/watchlist.json');

const SEED = [
  { name: 'ISHO（王腾·今日宜休）', since: '2026-10', keywords: ['ISHO', '今日宜休', '王腾'] },
  { name: '宇树科技 / Unitree', since: '2025', keywords: ['宇树', 'Unitree'] },
  { name: '摩尔线程', since: '2025', keywords: ['摩尔线程'] },
  { name: '智元机器人', since: '2025', keywords: ['智元'] },
  { name: '月之暗面 / Kimi', since: '2023', keywords: ['月之暗面', 'Kimi', 'Moonshot'] },
];

function loadList() {
  if (!fs.existsSync(LIST)) {
    fs.mkdirSync(path.dirname(LIST), { recursive: true });
    fs.writeFileSync(LIST, JSON.stringify(SEED, null, 2) + '\n', 'utf8');
    return SEED;
  }
  return JSON.parse(fs.readFileSync(LIST, 'utf8'));
}

let list = loadList();

if (args.add) {
  const kw = String(args.add).split('|').map((s) => s.trim()).filter(Boolean);
  const name = args.name || kw[0];
  const exists = list.some((w) => w.name === name);
  if (exists) {
    console.error(`已存在：${name}`);
  } else {
    list.push({ name, since: args.since || '', keywords: kw });
    fs.writeFileSync(LIST, JSON.stringify(list, null, 2) + '\n', 'utf8');
    console.error(`已添加：${name}（${kw.join('、')}）`);
  }
  process.exit(0);
}

if (args.list) {
  console.log('| 实体 | 关键词 | 跟踪起点 |');
  console.log('|---|---|---|');
  for (const w of list) console.log(`| ${w.name} | ${w.keywords.join(' / ')} | ${w.since || '—'} |`);
  process.exit(0);
}

const file = args.in;
if (!file) {
  console.error('缺少 --in=<采集 JSON>；或用 --list 查看清单、--add 添加实体');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`文件不存在：${file}`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
// 兼容 daily-collect 的 boards/others 结构，以及裸数组
const items = [];
if (Array.isArray(data)) items.push(...data.map((x) => ({ title: x.title ?? x.name ?? '', url: x.url ?? x.link ?? '', at: x.at ?? x.date ?? '' })));
else {
  for (const [k, v] of Object.entries(data.boards ?? {})) {
    if (Array.isArray(v)) items.push(...v.map((x) => ({ title: x.title ?? '', url: x.url ?? '', at: x.at ?? '', board: k })));
  }
  for (const x of data.others ?? []) items.push({ title: x.title ?? '', url: x.url ?? '', at: x.at ?? '', board: 'others' });
}

const days = Number(args.days ?? 0);
const from = days > 0 ? new Date(Date.now() + 8 * 3600e3 - days * 86400e3).toISOString().slice(0, 10) : '';

const hits = new Map(); // entity -> items
for (const it of items) {
  if (from && it.at && it.at.slice(0, 10) < from) continue;
  const blob = `${it.title} ${it.summary ?? ''}`.toLowerCase();
  for (const w of list) {
    if (!w.keywords.some((k) => blob.includes(String(k).toLowerCase()))) continue;
    if (!hits.has(w.name)) hits.set(w.name, []);
    const bucket = hits.get(w.name);
    if (!bucket.some((b) => b.url === it.url)) bucket.push(it);
  }
}

if (hits.size === 0) {
  console.log(`清单 ${list.length} 个实体，本次采集 ${items.length} 条，无命中。`);
  process.exit(0);
}

console.log(`清单 ${list.length} 个实体，本次采集 ${items.length} 条，命中 ${hits.size} 个实体：\n`);
console.log('| 时间 | 实体 | 事件 | 链接 |');
console.log('|---|---|---|---|');
for (const [name, arr] of hits) {
  for (const it of arr.sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
    const title = String(it.title).replace(/\|/g, '／').slice(0, 80);
    console.log(`| ${it.at || '—'} | ${name} | ${title} | ${it.url || '—'} |`);
  }
}
