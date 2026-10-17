/**
 * bing-search: concurrent keyless Bing searches with a disk cache.
 *
 * The plugin's own `tech_daily_search` batch action is available only after a
 * profile restart, and it talks to the in-process cache. This CLI is the
 * out-of-band tool for report collection: it reuses the same adapter
 * (`lib/bing.js`), fans queries out concurrently, and caches each query's
 * normalized result on disk so a repeated scan costs milliseconds.
 *
 * Usage:
 *   node scripts/bing-search.mjs "查询1" "查询2" "查询3" --max 5 --concurrency 4
 *   node scripts/bing-search.mjs "查询1" --cache-hours 6 --refresh
 *
 * Output: one JSON line per query plus a final summary line with timings.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bingSearch } from '../lib/bing.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, '.cache', 'bing');

function parseArgs(argv) {
  const out = { queries: [], max: 5, market: 'zh-CN', concurrency: 4, cacheHours: 6, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--max') out.max = Number(argv[++i]) || 5;
    else if (a === '--market') out.market = argv[++i] || 'zh-CN';
    else if (a === '--concurrency') out.concurrency = Math.min(Number(argv[++i]) || 4, 8);
    else if (a === '--cache-hours') out.cacheHours = Number(argv[++i]) || 6;
    else if (a === '--refresh') out.refresh = true;
    else out.queries.push(a);
  }
  return out;
}

const keyFor = (query, max, market) =>
  createHash('sha1').update(`${market}|${max}|${query}`).digest('hex').slice(0, 20);

async function cacheGet(key, hours, refresh) {
  if (refresh) return null;
  const file = join(CACHE_DIR, `${key}.json`);
  try {
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > hours * 3600 * 1000) return null;
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.queries.length === 0) {
    console.error('usage: node scripts/bing-search.mjs "query" ["query2" ...] [--max N] [--concurrency N] [--cache-hours N] [--refresh]');
    process.exit(2);
  }
  await mkdir(CACHE_DIR, { recursive: true });

  const started = Date.now();
  const rows = new Array(args.queries.length);
  let cursor = 0;
  let cacheHits = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= args.queries.length) return;
      const query = args.queries[index];
      const key = keyFor(query, args.max, args.market);
      const cached = await cacheGet(key, args.cacheHours, args.refresh);
      if (cached !== null) {
        cacheHits += 1;
        rows[index] = { ...cached, cached: true, ms: 0 };
        continue;
      }
      const t0 = Date.now();
      const outcome = await bingSearch(query, { maxResults: args.max, market: args.market, timeoutMs: 20000 });
      const ms = Date.now() - t0;
      if (outcome.ok) {
        const row = {
          query,
          ok: true,
          ms,
          count: outcome.data.results.length,
          results: outcome.data.results.map((r) => ({
            title: r.title,
            url: r.url,
            ...(r.published_date ? { published_date: r.published_date } : {}),
            snippet: (r.content || '').slice(0, 160),
          })),
        };
        rows[index] = row;
        await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(row), 'utf8');
      } else {
        rows[index] = { query, ok: false, ms, error: outcome.error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, args.queries.length) }, worker));
  for (const row of rows) console.log(JSON.stringify(row));
  console.log(JSON.stringify({
    summary: true,
    queries: args.queries.length,
    concurrency: args.concurrency,
    cache_hits: cacheHits,
    wall_ms: Date.now() - started,
    sum_query_ms: rows.reduce((s, r) => s + (r?.ms || 0), 0),
  }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
