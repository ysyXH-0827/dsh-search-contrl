#!/usr/bin/env node
/**
 * archive-pull.mjs — 从远端归档仓库拉快照到本地（本机不用天天开机）。
 *
 * 用法：
 *   node scripts/archive-pull.mjs --days=7                       # 拉最近 7 天
 *   node scripts/archive-pull.mjs --date=2026-10-25 --days=7     # 指定窗口末日
 *   node scripts/archive-pull.mjs --repo=ysyXH-0827/dsh-news-archive --branch=main
 *   node scripts/archive-pull.mjs --days=7 --force               # 覆盖本地已有快照
 *
 * 远端快照由 GitHub Actions 每天 23:05（北京时间）生成，落在 archive/<日期>.json。
 * 走 GitHub API（本机 github.com / raw.githubusercontent.com 常被墙），没有 token 时退回 raw。
 * 拉下来之后配合 archive-merge.mjs 拼多日窗口；缺哪天会明确列出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const BJ = 8 * 3600_000;
const fmt = t => new Date(t + BJ).toISOString().slice(0, 10);
const shiftDay = (d, delta) => fmt(new Date(`${d}T00:00:00+08:00`).getTime() + delta * 86400_000);

const date = args.date ?? fmt(Date.now());
const days = Math.max(1, Number(args.days ?? 7));
const repo = String(args.repo ?? 'ysyXH-0827/dsh-news-archive');
const branch = String(args.branch ?? 'main');
const dir = String(args.dir ?? 'reports/_data/archive');
const force = Boolean(args.force);

function resolveToken() {
  if (args.token) return String(args.token);
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const token = resolveToken();

/** 返回 {text, via} / {missing:true} / {error} */
async function fetchSnapshot(day) {
  if (token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/archive/${day}.json?ref=${branch}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'dsh-archive-pull' },
      });
      if (res.status === 404) return { missing: true };
      if (res.ok) {
        const j = await res.json();
        if (typeof j.content === 'string' && j.content.length) {
          return { text: Buffer.from(j.content, 'base64').toString('utf8'), via: 'api' };
        }
        if (j.download_url) {
          const raw = await fetch(j.download_url, { headers: { 'user-agent': 'dsh-archive-pull' } });
          if (raw.ok) return { text: await raw.text(), via: 'download_url' };
        }
        return { error: 'API 返回里没有内容' };
      }
      if (res.status !== 401 && res.status !== 403) return { error: `API HTTP ${res.status}` };
      // 401/403 时退回 raw
    } catch (e) {
      // 落回 raw
    }
  }
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/archive/${day}.json`, {
      headers: { 'user-agent': 'dsh-archive-pull' },
    });
    if (res.status === 404) return { missing: true };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { text: await res.text(), via: 'raw' };
  } catch (e) {
    return { error: e.message };
  }
}

const want = [];
for (let i = days - 1; i >= 0; i--) want.push(shiftDay(date, -i));

fs.mkdirSync(dir, { recursive: true });

const got = [];
const skippedLocal = [];
const missing = [];
const failed = [];
const vias = new Set();

for (const day of want) {
  const local = path.join(dir, `${day}.json`);
  if (fs.existsSync(local) && !force) { skippedLocal.push(day); continue; }
  const r = await fetchSnapshot(day);
  if (r.missing) { missing.push(day); continue; }
  if (r.error) { failed.push(`${day}(${r.error})`); continue; }
  let data;
  try { data = JSON.parse(r.text); } catch { failed.push(`${day}(JSON 损坏)`); continue; }
  const n = Array.isArray(data.allItems) ? data.allItems.length : Array.isArray(data.uniqueItems) ? data.uniqueItems.length : 0;
  if (!n) { failed.push(`${day}(空快照)`); continue; }
  fs.writeFileSync(local, JSON.stringify(data));
  vias.add(r.via);
  got.push(`${day}:${n}`);
}

process.stderr.write(`[archive-pull] ${repo}@${branch} ${want[0]}~${want[want.length - 1]}${token ? '（带 token）' : '（无 token，走 raw）'}\n`);
process.stderr.write(`[archive-pull] 新拉 ${got.length} 份${got.length ? '：' + got.join(', ') : ''}${vias.size ? ' [' + [...vias].join('+') + ']' : ''}\n`);
if (skippedLocal.length) process.stderr.write(`[archive-pull] 本地已有，跳过 ${skippedLocal.length} 天（--force 可覆盖）：${skippedLocal.join('、')}\n`);
if (missing.length) process.stderr.write(`[archive-pull] 远端没有：${missing.join('、')}\n`);
if (failed.length) process.stderr.write(`[archive-pull] 失败：${failed.join('; ')}\n`);

const have = want.filter(d => fs.existsSync(path.join(dir, `${d}.json`)));
process.stderr.write(`[archive-pull] 本地窗口覆盖 ${have.length}/${days} 天\n`);
process.exit(failed.length ? 1 : 0);
