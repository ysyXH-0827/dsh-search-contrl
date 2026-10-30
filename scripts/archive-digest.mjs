#!/usr/bin/env node
/**
 * archive-digest.mjs — 把一份归档快照渲染成人可读的 Markdown（不需要模型）。
 *
 * 用法：
 *   node scripts/archive-digest.mjs --date=2026-10-24 --archive=archive                       # 输出到 stdout
 *   node scripts/archive-digest.mjs --date=2026-10-24 --out=reports/_data/digest/2026-10-24.md
 *   node scripts/archive-digest.mjs --file=reports/_data/archive/2026-10-24.json
 *   node scripts/archive-digest.mjs --date=2026-10-24 --max=6 --window=all  # 不按日期过滤，列出全部
 *
 * 目的是让「不开机也能看」：GitHub Actions 每天生成 digest/YYYY-MM-DD.md，
 * 手机上打开仓库就能读；D 日之后再让模型成稿时，也有现成素材。
 */
import fs from 'node:fs';
import path from 'node:path';

import { renderTitle } from '../lib/report-title.js';
import { boardsForPreset, feedsForPreset, presetForTopic } from '../lib/topic-presets.js';
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const BJ = 8 * 3600_000;
const fmt = t => new Date(t + BJ).toISOString().slice(0, 10);
const today = fmt(Date.now());
const date = args.date ?? today;
const max = Math.max(1, Number(args.max ?? 8));
const windowMode = String(args.window ?? 'day'); // day | all
const file = args.file ?? path.join(String(args.archive ?? 'reports/_data/archive'), `${date}.json`);

if (!fs.existsSync(file)) {
  process.stderr.write(`[archive-digest] 找不到快照：${file}\n`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = (Array.isArray(data.allItems) && data.allItems.length)
  ? data.allItems
  : (Array.isArray(data.uniqueItems) && data.uniqueItems.length)
    ? data.uniqueItems
    : (Array.isArray(data.items) ? data.items : []);

// 主题与标题：优先用快照自带的主题（daily-collect 会写进 data.topic），其次设置里的第一个主题。
// 3.0.0 起不再有「科技」默认：主题未知时没有板块，只剩未归类清单。
function readSettings() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const file = `${home}/.dsh/plugin-data/dsh-search-contrl/settings.json`;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch {
    return {};
  }
}
const settings = readSettings();
const configuredTopics = Array.isArray(settings.topics) ? settings.topics : [];
const snapshotTopic = data.topic && typeof data.topic.label === "string" ? data.topic : null;
const argTopic = typeof args.topic === "string" && args.topic.trim() !== "" ? { label: args.topic.trim(), keywords: [], domains: [] } : null;
const topic = argTopic ?? snapshotTopic ?? configuredTopics.find(t => t && t.enabled !== false && typeof t.label === "string" && t.label.trim() !== "") ?? null;
const preset = presetForTopic(topic);
const feeds = feedsForPreset(preset);
const days = Number(data.window && data.window.days) || 1;
const title = renderTitle(settings.reportTitle, { topic: topic ? topic.label : "", date, days });
// 板块判定：按预设顺序取第一个命中（一条新闻只占一个板块，避免撑大 digest）
const BOARD_RULES = Object.entries(boardsForPreset(preset));

const cut = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function atOf(it) {
  const raw = String(it.at ?? '');
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(raw);
  return m ? { day: m[1], hm: m[2], raw } : { day: raw.slice(0, 10), hm: raw.slice(11, 16), raw };
}

const pool = windowMode === 'all' ? items : items.filter(it => atOf(it).day === date);
const seen = new Set();
const uniq = [];
for (const it of pool) {
  if (!it?.url || seen.has(it.url)) continue;
  seen.add(it.url);
  uniq.push(it);
}
uniq.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));

const buckets = new Map(BOARD_RULES.map(([name]) => [name, []]));
const others = [];
for (const it of uniq) {
  const hay = `${it.title ?? ''} ${it.desc ?? ''}`;
  const hit = BOARD_RULES.find(([, res]) => res.some(re => re.test(hay)));
  if (hit) buckets.get(hit[0]).push(it);
  else others.push(it);
}

const lines = [];
const win = data.window && typeof data.window === 'object' ? data.window : null;
lines.push(`# ${title}${windowMode === "all" ? `（全部 ${uniq.length} 条）` : ""}`, "");
lines.push(`> 脚本自动生成，未经过人工/模型筛选：按关键词归类，仅供快速浏览与后续成稿。共 ${uniq.length} 条。`, '');
lines.push(`- 快照时间：${data.generatedAt ?? '未知'}`);
lines.push(`- 快照文件：\`${path.basename(file)}\``);
lines.push(`- 主题：${topic ? topic.label : "未指定"}${preset ? `（预设 ${preset.id}）` : ""}`);
lines.push(`- 源：${feeds.length ? `${feeds.length} 个 RSS（${preset.label}）` : "无内置 RSS，本次靠检索补齐"}`);
lines.push('');

let shown = 0;
for (const [name, list] of buckets) {
  if (!list.length) continue;
  const take = list.slice(0, max);
  shown += take.length;
  lines.push(`## ${name}（${list.length}）`, '');
  lines.push('| 时间 | 标题 | 链接 |');
  lines.push('| --- | --- | --- |');
  for (const it of take) {
    const { day, hm } = atOf(it);
    const t = windowMode === 'all' ? `${day.slice(5)} ${hm}` : hm;
    const title = cut(it.title).replace(/\|/g, '｜').slice(0, 80);
    lines.push(`| ${t} | ${title} | [原文](${it.url}) |`);
  }
  lines.push('');
}
if (others.length) {
  lines.push(`## 未归类（${others.length}）`, '');
  for (const it of others.slice(0, Math.min(max, 6))) {
    lines.push(`- ${cut(it.title).slice(0, 80)} — ${it.url}`);
  }
  lines.push('');
}

const md = lines.join('\n');
if (args.out) {
  fs.mkdirSync(String(args.out).replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  fs.writeFileSync(String(args.out), md);
  process.stderr.write(`[archive-digest] 写入 ${args.out}（${uniq.length} 条，展示 ${shown} 条）\n`);
} else {
  process.stdout.write(md);
}
