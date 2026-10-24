#!/usr/bin/env node
/**
 * report-metrics — 量一份报告，再决定要不要重采。
 *
 * 用法：
 *   node scripts/report-metrics.mjs reports/week-2026-10-19_10-24/README.md
 *   node scripts/report-metrics.mjs <file> --check-links --concurrency 6
 *   node scripts/report-metrics.mjs <file> --json
 *
 * 设计意图（2.2.2 复盘）：用户说“重新发一次报告”时，正确动作是**读已有文件**，
 * 不是重跑采集。这个脚本把“重新发的成本”变成可核对的数字：
 * 报告本体多少 token、渲染耗时多少毫秒、链接是否还全绿。
 */
import fs from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 粗略 token 估算：中文 0.62 token/字，ASCII 0.25 token/字符（区间 0.55–0.72 / 0.22–0.28）。 */
export function estimateTokens(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = text.length - cjk;
  const mid = Math.round(cjk * 0.62 + ascii * 0.25);
  return {
    cjk,
    ascii,
    mid,
    low: Math.round(cjk * 0.55 + ascii * 0.22),
    high: Math.round(cjk * 0.72 + ascii * 0.28),
  };
}

/** 统计结构：不解析 Markdown 语义，只数行首标记，避免引入依赖。 */
export function analyzeReport(text) {
  const lines = text.split(/\r?\n/);
  const sections = (text.match(/^## /gm) || []).length;
  const items = (text.match(/^### /gm) || []).length;
  const links = [...new Set([...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]))];
  const pending = (text.match(/待补|TODO|undefined/g) || []).length;
  const tokens = estimateTokens(text);
  return {
    lines: lines.length - (lines[lines.length - 1] === '' ? 1 : 0),
    chars: text.length,
    bytes: Buffer.byteLength(text),
    sections,
    items,
    uniqueLinks: links.length,
    links,
    pendingMarkers: pending,
    tokens,
  };
}

async function checkOne(url, timeoutMs) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status < 400) return { url, ok: true, status: res.status, method };
      if (method === 'GET') return { url, ok: false, status: res.status };
    } catch (error) {
      if (method === 'GET') return { url, ok: false, status: `ERR ${error.cause?.code || error.name}` };
    }
  }
  return { url, ok: false, status: 'unreachable' };
}

/** 并发上限内的链接复测；HEAD 被 403/405 拦时用 GET 复测，避免把反爬当死链。 */
export async function checkLinks(urls, { concurrency = 6, timeoutMs = 20_000 } = {}) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, urls.length || 1)) }, async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      results.push(await checkOne(urls[index], timeoutMs));
    }
  });
  await Promise.all(workers);
  const failed = results.filter((r) => !r.ok);
  return { checked: results.length, ok: results.length - failed.length, failed, results };
}

function formatHuman(file, m, linkRun) {
  const rows = [
    `file        ${file}`,
    `size        ${m.bytes} B / ${m.chars} 字符 / ${m.lines} 行`,
    `structure   ${m.sections} 个 ## 板块 · ${m.items} 个 ### 条目 · ${m.uniqueLinks} 个唯一外链`,
    `tokens      ≈ ${m.tokens.mid}（区间 ${m.tokens.low}–${m.tokens.high}；中文 ${m.tokens.cjk} 字，ASCII ${m.tokens.ascii} 字符）`,
    `pending     ${m.pendingMarkers} 处 待补/TODO/undefined`,
  ];
  if (linkRun) {
    rows.push(
      `links       ${linkRun.checked} 个实测：ok ${linkRun.ok} / failed ${linkRun.failed.length}` +
        (linkRun.failed.length ? ` → ${linkRun.failed.map((f) => `${f.status} ${f.url}`).join('; ')}` : ''),
    );
  }
  return rows.join('\n');
}

async function main(argv) {
  const args = argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: node scripts/report-metrics.mjs <report.md> [--check-links] [--json]');
    return 2;
  }
  const asJson = args.includes('--json');
  const withLinks = args.includes('--check-links');
  const concIndex = args.indexOf('--concurrency');
  const concurrency = concIndex >= 0 ? Number(args[concIndex + 1]) || 6 : 6;

  let file = target;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) file = path.join(target, 'README.md');
  if (!fs.existsSync(file)) {
    console.error(`not found: ${file}`);
    return 1;
  }

  const t0 = performance.now();
  const text = fs.readFileSync(file, 'utf8');
  const metrics = analyzeReport(text);
  const readMs = +(performance.now() - t0).toFixed(2);

  let linkRun = null;
  if (withLinks) {
    const t1 = performance.now();
    linkRun = await checkLinks(metrics.links, { concurrency });
    linkRun.elapsedMs = Math.round(performance.now() - t1);
  }

  if (asJson) {
    const { links, ...rest } = metrics;
    console.log(JSON.stringify({ file, ...rest, readMs, links: linkRun }, null, 2));
  } else {
    console.log(formatHuman(file, metrics, linkRun));
    console.log(`read        ${readMs} ms` + (linkRun ? ` · links ${linkRun.elapsedMs} ms` : ''));
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  main(process.argv).then((code) => process.exit(code));
}

export { formatHuman, main };
