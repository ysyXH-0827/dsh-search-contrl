/**
 * verify-links: bounded-concurrency link checking with retry and a disk cache.
 *
 * Why: unbounded Promise.all on a batch of IT之家 links returns some 429s
 * (server-side throttling), which then have to be re-checked one by one. And a
 * repeated month re-checks every URL even though nothing changed. This tool
 * bounds concurrency, retries 429/5xx with backoff, and caches a successful
 * verdict for 24 hours.
 *
 * Usage:
 *   node scripts/verify-links.mjs --file ../reports/month-2026-05/README.md
 *   node scripts/verify-links.mjs --urls "https://a" "https://b" --concurrency 6
 *   node scripts/verify-links.mjs --file <path> --cache-hours 24 --refresh
 *
 * Exit code: 0 when every URL is reachable, 1 when any URL fails after retries.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, '.cache', 'links');

function parseArgs(argv) {
  const out = { urls: [], file: '', concurrency: 6, cacheHours: 24, refresh: false, retries: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--urls') { while (argv[i + 1] && !String(argv[i + 1]).startsWith('--')) out.urls.push(argv[++i]); }
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--concurrency') out.concurrency = Math.min(Number(argv[++i]) || 6, 12);
    else if (a === '--cache-hours') out.cacheHours = Number(argv[++i]) || 24;
    else if (a === '--retries') out.retries = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--refresh') out.refresh = true;
  }
  return out;
}

async function collectFromDir(dir, acc) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectFromDir(full, acc);
    else if (entry.name.endsWith('.md')) {
      const text = await readFile(full, 'utf8');
      for (const m of text.matchAll(/\((https?:\/\/[^)]+)\)/g)) acc.add(m[1]);
    }
  }
}

const keyFor = (url) => createHash('sha1').update(url).digest('hex').slice(0, 20);

async function cachedVerdict(url, hours, refresh) {
  if (refresh) return null;
  try {
    const file = join(CACHE_DIR, `${keyFor(url)}.json`);
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > hours * 3600 * 1000) return null;
    const row = JSON.parse(await readFile(file, 'utf8'));
    return row.status === 200 ? row : null;
  } catch {
    return null;
  }
}

async function checkOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), 15000);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

async function checkWithRetry(url, retries) {
  let status = 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    status = await checkOnce(url);
    if (status === 200) return status;
    if (![0, 429, 500, 502, 503, 504].includes(status)) return status;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return status;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const urls = new Set(args.urls);
  if (args.file) await collectFromDir(args.file, urls);
  const list = [...urls];
  if (list.length === 0) {
    console.error('usage: node scripts/verify-links.mjs (--file <path> | --urls <url...>) [--concurrency 6] [--cache-hours 24] [--refresh]');
    process.exit(2);
  }
  await mkdir(CACHE_DIR, { recursive: true });

  const started = Date.now();
  const verdicts = new Map();
  let cacheHits = 0;
  const queue = [...list];
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= queue.length) return;
      const url = queue[index];
      const hit = await cachedVerdict(url, args.cacheHours, args.refresh);
      if (hit !== null) {
        cacheHits += 1;
        verdicts.set(url, hit.status);
        continue;
      }
      const status = await checkWithRetry(url, args.retries);
      verdicts.set(url, status);
      if (status === 200) {
        await writeFile(join(CACHE_DIR, `${keyFor(url)}.json`), JSON.stringify({ url, status, at: Date.now() }), 'utf8');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, list.length) }, worker));

  const failures = list.filter((u) => verdicts.get(u) !== 200).map((u) => ({ url: u, status: verdicts.get(u) }));
  const throttled = failures.filter((f) => f.status === 429).length;
  console.log(JSON.stringify({
    checked: list.length,
    ok: list.length - failures.length,
    failed: failures.length,
    throttled_429: throttled,
    cache_hits: cacheHits,
    concurrency: args.concurrency,
    elapsed_ms: Date.now() - started,
    failures: failures.slice(0, 10),
  }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
