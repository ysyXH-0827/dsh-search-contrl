/**
 * The plugin search tool. Registers as `search_contrl` when a Tavily key
 * is configured, making the Tavily direct adapter available to agents without
 * relying on DSH's web_search. Refuses all calls when the key is blank.
 *
 * @module dsh-search-contrl/search-tool
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tavilySearch, tavilyExtract } from './tavily.js';
import { bingSearch } from './bing.js';
import { buildBloggerQueries, buildTopicQueries, demoteSiteOperator, enabledBloggers, enabledSources, enabledTopics, filterResultsByDomain, preferDeepLinks, sourceChannel } from './custom-search.js';
import { countSettings, resolveDataDir } from './settings-store.js';
import { createBilibiliClient } from './bilibili-api.js';

/** The registered tool name. */
export const SEARCH_CONTRL_TOOL = 'search_contrl';

/** Default per-result content budget for batch mode, in characters. */
const DEFAULT_SNIPPET_CHARS = 400;

/** Maximum queries accepted by one batch call. */
const MAX_BATCH_QUERIES = 8;

/** Maximum concurrent upstream requests inside one batch call. */
const DEFAULT_CONCURRENCY = 6;

/** Bing rejects a wide burst; the keyless channel stays narrower on purpose. */
const BING_MAX_CONCURRENCY = 3;

/** Process-local result cache size and lifetime. */
const CACHE_MAX_ENTRIES = 64;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Tavily bills one credit per this many successful URL extractions. */
const URLS_PER_EXTRACT_CREDIT = 5;

/**
 * Extract-cache size and lifetime. A ten-minute search cache suits rolling
 * queries, but an extracted page body is a stable artifact: keeping it for a
 * day means the same archive is never paid for twice. This matters most for
 * multi-agent collection, where several workers converge on the same sources.
 */
const EXTRACT_CACHE_MAX_ENTRIES = 512;
const EXTRACT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Short lifetime for a remembered extraction failure. */
const EXTRACT_FAILURE_TTL_MS = 10 * 60 * 1000;

/** Soft cap on characters retained per cached page. */
const EXTRACT_CACHE_MAX_CHARS = 24000;

/** @type {Map<string, { at: number, value: Object }>} */
const cache = new Map();

/** @type {Map<string, { at: number, value: Object | null }>} */
const extractCache = new Map();

/**
 * Disk tier behind both memory caches.
 *
 * The caches above die with the process, so a Host restart inside the same day
 * pays Tavily again for pages it already extracted. Persisting the entries
 * turns "extracted once today" into a promise the next session can keep. Every
 * filesystem failure is swallowed: a cache that cannot be read or written must
 * never turn into a failed search.
 */
const DISK_CACHE_DIR = path.join(resolveDataDir(), 'cache');
const DISK_CACHE_OFF = process.env.DSH_SEARCH_CONTRL_NO_DISK_CACHE === '1';
const DISK_SWEEP_LIMIT = 1024;
let diskSwept = false;

/**
 * @param {'search' | 'extract'} kind
 * @param {string} key
 * @returns {string} absolute file path
 */
function diskCachePath(kind, key) {
  const name = createHash('sha1').update(key).digest('hex').slice(0, 20);
  return path.join(DISK_CACHE_DIR, `${kind}-${name}.json`);
}

/**
 * @param {'search' | 'extract'} kind
 * @param {string} key
 * @returns {{ at: number, value: Object | null } | undefined} `undefined` means "not on disk"
 */
function diskCacheRead(kind, key) {
  if (DISK_CACHE_OFF) return undefined;
  try {
    const entry = JSON.parse(fs.readFileSync(diskCachePath(kind, key), 'utf8'));
    if (!entry || typeof entry !== 'object' || !('value' in entry)) return undefined;
    return { at: Number(entry.at) || 0, value: entry.value };
  } catch {
    return undefined;
  }
}

/**
 * Keep the directory bounded once per process instead of stat-ing on every
 * write: the oldest files beyond the limit are dropped.
 */
function diskSweep() {
  if (diskSwept) return;
  diskSwept = true;
  try {
    const names = fs.readdirSync(DISK_CACHE_DIR);
    if (names.length <= DISK_SWEEP_LIMIT) return;
    const stamped = names.map(name => {
      const full = path.join(DISK_CACHE_DIR, name);
      try { return { full, at: fs.statSync(full).mtimeMs }; } catch { return { full, at: 0 }; }
    }).sort((a, b) => a.at - b.at);
    for (const file of stamped.slice(0, stamped.length - DISK_SWEEP_LIMIT)) {
      try { fs.unlinkSync(file.full); } catch { /* another process may have won */ }
    }
  } catch { /* an unreadable cache directory is not an error */ }
}

/**
 * @param {'search' | 'extract'} kind
 * @param {string} key
 * @param {{ at: number, value: Object | null }} entry
 */
function diskCacheWrite(kind, key, entry) {
  if (DISK_CACHE_OFF) return;
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskCachePath(kind, key), JSON.stringify(entry));
    diskSweep();
  } catch { /* ignore: the memory tier still works */ }
}

/** Circuit breaker: while set, extract calls are refused without spending credits. */
let creditGuardUntil = 0;

/** How long the credit circuit breaker stays open after a plan-limit error. */
const CREDIT_GUARD_MS = 10 * 60 * 1000;

/**
 * Whether an upstream failure means the plan has no credits left to spend.
 *
 * Only these errors are worth latching: a transient network fault or a single
 * unextractable page must not trip the breaker.
 *
 * @param {string} error
 * @returns {boolean}
 */
function isCreditExhaustedError(error) {
  if (typeof error !== 'string') return false;
  return /usage limit|credit|quota|exceeded|too many requests|\b429\b|\b432\b|\b433\b/i.test(error);
}

/**
 * Build the cache key for one search request.
 *
 * The provider is part of the key: the same query answered by Bing and by
 * Tavily are different results, so one must never serve the other's payload.
 *
 * @param {string} provider
 * @param {string} depth
 * @param {number} maxResults
 * @param {boolean} includeAnswer
 * @param {boolean} includeRawContent
 * @param {{ query: string, include_domains?: string[], exclude_domains?: string[] }} params
 * @returns {string}
 */
function cacheKey(provider, depth, maxResults, includeAnswer, includeRawContent, params) {
  return JSON.stringify([
    provider,
    depth,
    maxResults,
    includeAnswer,
    includeRawContent,
    params.query,
    [...(params.include_domains ?? [])].sort(),
    [...(params.exclude_domains ?? [])].sort(),
  ]);
}

/**
 * Providers the tool can route to.
 *
 * @type {ReadonlyArray<'auto' | 'bing' | 'tavily'>}
 */
const SEARCH_PROVIDERS = ['auto', 'bing', 'tavily'];

/**
 * Normalize a caller-supplied provider against the configured default.
 *
 * An unknown value never reaches this point from the schema, but the tool is
 * also called programmatically in tests, so the guard keeps routing total.
 *
 * @param {unknown} requested
 * @param {{ searchProvider: 'auto' | 'bing' | 'tavily' }} config
 * @returns {'auto' | 'bing' | 'tavily'}
 */
function resolveProvider(requested, config) {
  if (typeof requested === 'string' && SEARCH_PROVIDERS.includes(requested)) return requested;
  return config.searchProvider;
}

/**
 * Read one unexpired cache entry.
 *
 * @param {string} key
 * @returns {Object | undefined}
 */
function cacheGet(key) {
  let hit = cache.get(key);
  if (hit === undefined) {
    const stored = diskCacheRead('search', key);
    if (stored === undefined) return undefined;
    hit = stored;
  }
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Refresh recency so an actively reused query survives eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

/**
 * Store one cache entry, evicting the least recently used overflow.
 *
 * @param {string} key
 * @param {Object} value
 */
function cacheSet(key, value) {
  const entry = { at: Date.now(), value };
  cache.set(key, entry);
  diskCacheWrite('search', key, entry);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Trim a page body before caching it.
 *
 * A handful of pages return megabytes of markup; retaining them verbatim is
 * what turns a memory cache into a memory leak. The clip is far above any
 * realistic extraction budget, and the marker keeps truncation visible.
 *
 * @param {Object} normalized
 * @returns {Object}
 */
function clipForCache(normalized) {
  const content = normalized.content;
  if (typeof content !== 'string' || content.length <= EXTRACT_CACHE_MAX_CHARS) {
    return normalized;
  }
  return Object.assign({}, normalized, {
    content: content.slice(0, EXTRACT_CACHE_MAX_CHARS) +
      '\n\n[content truncated when cached; re-fetch with a cache bypass if the tail is needed]',
  });
}

/**
 * Read one unexpired extract-cache entry.
 *
 * A stored `null` marks a URL that recently came back without a body; it
 * expires far sooner than real content so a transient failure is never cached
 * for a full day.
 *
 * @param {string} url
 * @returns {Object | null | undefined} `undefined` means "not cached"
 */
function extractCacheGet(url) {
  let hit = extractCache.get(url);
  if (hit === undefined) {
    const stored = diskCacheRead('extract', url);
    if (stored === undefined) return undefined;
    hit = stored;
  }
  const ttl = hit.value === null ? EXTRACT_FAILURE_TTL_MS : EXTRACT_CACHE_TTL_MS;
  if (Date.now() - hit.at > ttl) {
    extractCache.delete(url);
    return undefined;
  }
  // Refresh recency so an actively reused URL survives eviction.
  extractCache.delete(url);
  extractCache.set(url, hit);
  return hit.value;
}

/**
 * Store one extract-cache entry, evicting the least recently used overflow.
 *
 * @param {string} url
 * @param {Object | null} value
 */
function extractCacheSet(url, value) {
  const entry = { at: Date.now(), value };
  extractCache.set(url, entry);
  diskCacheWrite('extract', url, entry);
  while (extractCache.size > EXTRACT_CACHE_MAX_ENTRIES) {
    const oldest = extractCache.keys().next();
    if (oldest.done) break;
    extractCache.delete(oldest.value);
  }
}

/**
 * Copy one Tavily result into a plain object holding only defined values.
 *
 * Tavily omits `published_date` on results it cannot date. Assigning it
 * unconditionally leaves an own property whose value is `undefined`, which the
 * harness rejects as "not lossless JSON" even though JSON.stringify would
 * silently drop it. Every field below is therefore admitted only when it holds
 * a value of the expected type.
 *
 * @param {{ url?: string, title?: string, content?: string, raw_content?: string, score?: number, published_date?: string }} r
 * @param {number} [snippetChars] - truncate content to this many characters; 0 or undefined keeps it whole
 * @returns {{ url: string, title?: string, content: string, score?: number, published_date?: string }}
 */
function normalizeResult(r, snippetChars) {
  const out = { url: typeof r.url === 'string' ? r.url : '' };

  if (typeof r.title === 'string') out.title = r.title;

  const body = typeof r.content === 'string'
    ? r.content
    : (typeof r.raw_content === 'string' ? r.raw_content : '');
  out.content = (typeof snippetChars === 'number' && snippetChars > 0 && body.length > snippetChars)
    ? `${body.slice(0, snippetChars)}…`
    : body;

  if (typeof r.score === 'number') out.score = r.score;
  if (typeof r.published_date === 'string' && r.published_date !== '') out.published_date = r.published_date;

  return out;
}

/**
 * Run `worker` over `items` with at most `limit` requests in flight, preserving
 * input order. Each item's settled outcome is captured, so one failure never
 * discards the rest of the batch.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<Array<{ status: 'fulfilled', value: R } | { status: 'rejected', reason: any }>>}
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Execute one cached search, routing through the configured provider.
 *
 * `auto` is keyless-first: Bing answers for free, and Tavily is only paid when
 * Bing fails outright and a key exists. A provider the caller names explicitly
 * is never swapped for a different one — that would make the return value lie
 * about where the results came from.
 *
 * @param {{ tavilyApiKey: string, searchProvider: 'auto' | 'bing' | 'tavily', bingMarket: string, searchDepth: string, maxResults: number, timeoutMs: number }} config
 * @param {{ query: string, provider?: string, search_depth?: string, max_results?: number, include_answer?: boolean, include_raw_content?: boolean, include_domains?: string[], exclude_domains?: string[], snippet_chars?: number }} params
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<{ ok: true, value: Object, cached: boolean } | { ok: false, error: string }>}
 */
async function runSearch(config, params, signal) {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (query === '') return { ok: false, error: 'search requires a query string' };

  const searchDepth = params.search_depth === 'advanced' || params.search_depth === 'basic'
    ? params.search_depth
    : config.searchDepth;
  const maxResults = Number.isInteger(params.max_results) && params.max_results > 0
    ? Math.min(params.max_results, 20)
    : config.maxResults;
  const includeAnswer = params.include_answer === true;
  const includeRawContent = params.include_raw_content === true;
  const includeDomains = Array.isArray(params.include_domains) ? params.include_domains : undefined;
  const excludeDomains = Array.isArray(params.exclude_domains) ? params.exclude_domains : undefined;
  const intent = resolveProvider(params.provider, config);

  const key = cacheKey(intent, searchDepth, maxResults, includeAnswer, includeRawContent, {
    query, include_domains: includeDomains, exclude_domains: excludeDomains,
  });
  const cached = cacheGet(key);
  if (cached !== undefined) return { ok: true, value: cached, cached: true };

  const options = {
    query,
    searchDepth,
    maxResults,
    includeAnswer,
    includeRawContent,
    includeDomains,
    excludeDomains,
  };

  let used = intent === 'auto' ? 'bing' : intent;
  let result = await attemptProvider(used, options, config, signal);

  if (!result.ok && intent === 'auto' && config.tavilyApiKey !== '') {
    const fallback = await attemptProvider('tavily', options, config, signal);
    if (fallback.ok) {
      used = 'tavily';
      result = fallback;
    } else {
      return { ok: false, error: `bing failed (${result.error}); tavily fallback failed (${fallback.error})` };
    }
  }

  if (!result.ok) return { ok: false, error: result.error };

  const value = {
    query: typeof result.data.query === 'string' ? result.data.query : query,
    provider: used,
    results: Array.isArray(result.data.results)
      ? result.data.results.map(r => normalizeResult(r, params.snippet_chars))
      : [],
  };
  if (typeof result.data.answer === 'string' && result.data.answer !== '') value.answer = result.data.answer;
  if (typeof result.data.response_time === 'number') value.response_time = result.data.response_time;

  cacheSet(key, value);
  return { ok: true, value, cached: false };
}

/**
 * Call one provider, translating the plugin's provider-neutral options into
 * that provider's own request shape.
 *
 * @param {'bing' | 'tavily'} provider
 * @param {{ query: string, searchDepth: string, maxResults: number, includeAnswer: boolean, includeRawContent: boolean, includeDomains?: string[], excludeDomains?: string[] }} options
 * @param {{ tavilyApiKey: string, bingMarket: string, timeoutMs: number }} config
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<{ ok: true, data: Object } | { ok: false, error: string }>}
 */
async function attemptProvider(provider, options, config, signal) {
  if (provider === 'bing') {
    return bingSearch(options.query, {
      maxResults: options.maxResults,
      market: config.bingMarket,
      includeDomains: options.includeDomains,
      excludeDomains: options.excludeDomains,
      timeoutMs: config.timeoutMs,
      signal,
    });
  }

  if (config.tavilyApiKey === '') {
    return {
      ok: false,
      error: 'provider "tavily" needs a Tavily API key; use provider "bing" (or leave provider on "auto") for keyless search',
    };
  }

  return tavilySearch(
    config.tavilyApiKey,
    {
      query: options.query,
      search_depth: options.searchDepth,
      max_results: options.maxResults,
      include_answer: options.includeAnswer,
      include_raw_content: options.includeRawContent,
      include_domains: options.includeDomains,
      exclude_domains: options.excludeDomains,
    },
    signal,
    config.timeoutMs
  );
}

/**
 * Read the live settings through the injected store API, tolerating a Host that
 * mounted no store (the tool must keep working with profile defaults).
 *
 * @param {{ read?: () => { value?: Object } } | undefined} settingsApi
 * @returns {{ searchSources: Array<Object>, topics: Array<Object>, bloggers: Array<Object> }}
 */
function settingsValue(settingsApi) {
  try {
    const snapshot = settingsApi?.read?.();
    const value = snapshot?.value;
    return value && typeof value === 'object' ? value : { searchSources: [], topics: [], bloggers: [] };
  } catch {
    return { searchSources: [], topics: [], bloggers: [] };
  }
}

/**
 * Run several prepared queries with the batch concurrency rules, returning the
 * same shape a `batch` call returns so callers do not branch on the origin.
 */
async function runQueryGroup(defaults, queries, { provider, signal, snippetChars, concurrency, domains }) {
  const started = Date.now();
  const effectiveProvider = resolveProvider(provider, defaults);
  const batchConcurrency = effectiveProvider === 'tavily'
    ? (concurrency ?? DEFAULT_CONCURRENCY)
    : Math.min(concurrency ?? DEFAULT_CONCURRENCY, BING_MAX_CONCURRENCY);

  const wanted = Array.isArray(domains) ? domains.filter(item => typeof item === 'string' && item !== '') : [];

  const settle = async entry => runSearch(
    defaults,
    {
      query: entry.query,
      provider: entry.provider ?? provider,
      include_domains: entry.includeDomains,
      exclude_domains: entry.excludeDomains,
      snippet_chars: snippetChars,
    },
    signal
  );

  const settled = await mapLimit(queries, batchConcurrency, settle);

  // Domain filtering may fire a follow-up request per entry, so map with plain
  // Promise.all: the network concurrency is already bounded by the batch above.
  const results = await Promise.all(queries.map(async (entry, index) => {
    const outcome = settled[index];
    if (outcome.status === 'rejected') {
      return { label: entry.label, query: entry.query, ok: false, error: String(outcome.reason?.message ?? outcome.reason) };
    }
    if (!outcome.value.ok) return { label: entry.label, query: entry.query, ok: false, error: outcome.value.error };

    let payload = { label: entry.label, ok: true, cached: outcome.value.cached === true, ...outcome.value.value };
    if (wanted.length === 0) return payload;

    // The free Bing RSS channel does not reliably honour `site:` — it happily
    // returns unrelated hosts. Keep the domain promise by filtering locally,
    // and retry once with the domain demoted to a plain keyword when the
    // filtered list comes back empty.
    const trimmed = preferDeepLinks(filterResultsByDomain(payload.results, wanted));
    const siteQuery = entry.siteQuery === true || /^\s*site:\S+/i.test(String(entry.query ?? ''));
    if (trimmed.length > 0 || !siteQuery) {
      return { ...payload, results: trimmed, dropped_by_domain: (payload.results?.length ?? 0) - trimmed.length };
    }

    const relaxed = await settle({ ...entry, query: demoteSiteOperator(entry.query) });
    if (!relaxed.ok) return { ...payload, results: trimmed, dropped_by_domain: payload.results?.length ?? 0 };
    payload = { ...payload, ...relaxed.value, query: demoteSiteOperator(entry.query) };
    const trimmedAgain = preferDeepLinks(filterResultsByDomain(payload.results, wanted));

    // Still nothing in scope: the free channel simply cannot do domain-scoped
    // search. Spend one credit on the paid channel (it honours include_domains)
    // and say so in the result instead of silently returning off-domain noise.
    if (trimmedAgain.length === 0 && effectiveProvider !== 'tavily' && typeof defaults?.tavilyApiKey === 'string' && defaults.tavilyApiKey !== '') {
      const paid = await settle({ ...entry, provider: 'tavily', includeDomains: wanted, query: demoteSiteOperator(entry.query) });
      if (paid.ok) {
        const paidResults = preferDeepLinks(filterResultsByDomain(paid.value.results, wanted));
        return {
          ...payload,
          ...paid.value,
          query: demoteSiteOperator(entry.query),
          results: paidResults,
          dropped_by_domain: (paid.value.results?.length ?? 0) - paidResults.length,
          site_operator_retried: true,
          domain_fallback: 'tavily',
        };
      }
    }

    return {
      ...payload,
      results: trimmedAgain,
      dropped_by_domain: (payload.results?.length ?? 0) - trimmedAgain.length,
      site_operator_retried: true,
    };
  }));

  const failed = results.filter(item => item.ok !== true).length;
  return {
    ok: failed < results.length,
    results,
    succeeded: results.length - failed,
    failed,
    concurrency: batchConcurrency,
    provider: effectiveProvider,
    elapsed_ms: Date.now() - started,
    ...(wanted.length === 0 ? {} : { domain_filter: wanted }),
    ...(failed === results.length ? { error: 'every query failed' } : {}),
  };
}

/**
 * Build the tool definition bound to one effectiveConfig function.
 *
 * @param {() => { tavilyApiKey: string, searchProvider: 'auto' | 'bing' | 'tavily', bingMarket: string, searchDepth: 'basic' | 'advanced', maxResults: number, timeoutMs: number }} getConfig
 * @param {{ read?: Function, history?: Function, restore?: Function, dataDir?: string, historyLimit?: number }} [settingsApi]
 * @returns {Object} tool definition ready for ctx.tools.register
 */

/** Concurrency used by the 'bloggers' action: enough to matter, low enough to stay polite. */
export const BLOGGER_CONCURRENCY = 4;

/** Strip the HTML that Weibo embeds in post bodies so the text stays readable. */
function plainText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Read one Bilibili creator's latest videos through the signed space API. */
async function readBilibiliCreator(mid, { cookie = '', ps = 6, deep = false } = {}) {
  const client = createBilibiliClient({ cookie });
  const videos = await client.latestVideos(mid, { ps });
  let newest = null;
  if (deep && videos.length > 0) {
    const view = await client.videoView(videos[0].bvid);
    const cid = view?.cid ?? (view?.pages ?? [])[0]?.cid;
    const conclusion = await client.aiConclusion(view?.bvid ?? videos[0].bvid, cid, mid);
    newest = {
      video: videos[0],
      summary: conclusion?.ok ? (conclusion.data ?? conclusion) : { ok: false, reason: conclusion?.reason ?? null },
    };
  }
  return { platform: 'bilibili', loggedIn: Boolean(cookie), videos, newest };
}

/** Read one Weibo creator's timeline with the stored login cookie. */
async function readWeiboCreator(uid, { cookie = '' } = {}) {
  const xsrf = (cookie.match(/XSRF-TOKEN=([^;]+)/) ?? [])[1] ?? '';
  const response = await fetch(
    'https://weibo.com/ajax/statuses/mymblog?uid=' + encodeURIComponent(uid) + '&page=1&feature=0',
    {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest',
        'x-xsrf-token': decodeURIComponent(xsrf),
        referer: 'https://weibo.com/u/' + uid,
        cookie,
      },
    }
  );
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  const posts = ((body?.data?.list) ?? []).map(item => ({
    id: item.mblogid,
    createdAt: item.created_at,
    text: plainText(item.text).slice(0, 800),
    reposts: item.reposts_count,
    comments: item.comments_count,
    likes: item.attitudes_count,
    images: (item.pics ?? []).length,
    video: item.page_info?.type ?? null,
    retweet: item.retweeted_status
      ? { user: item.retweeted_status.user?.screen_name ?? null, text: plainText(item.retweeted_status.text).slice(0, 300) }
      : null,
    url: 'https://weibo.com/' + uid + '/' + item.mblogid,
  }));
  return { platform: 'weibo', loggedIn: Boolean(cookie), status: response.status, posts, ...(body ? {} : { error: 'weibo returned a bot page instead of JSON; save the login cookie again' }) };
}

export function buildSearchTool(getConfig, settingsApi = {}) {
  return {
    name: SEARCH_CONTRL_TOOL,
    description: [
      'Search the web for technology news on two channels. The keyless Bing RSS channel is free and returns snippets (about ten results per page, no AI answer). Tavily needs an API key, costs 1 credit per search, and adds an AI answer plus richer content.',
      "provider 'auto' (the default) uses Bing first and only falls back to Tavily when Bing fails and a key is configured; 'bing' and 'tavily' pin one channel.",
      'Use this when the built-in web search is unavailable or when you need direct vendor page extraction.',
      "The 'search' action runs one query; the 'batch' action runs up to 8 queries concurrently in a single call and is the fast path for multi-topic collection (one call replaces six sequential calls at roughly 5x the wall-clock speed).",
      "The 'extract' action returns full page text and needs a Tavily key; extracted pages are cached per URL for 24 hours, so re-reading a page you already extracted costs no credits.",
      "The 'topic' action searches a topic the user defined in the settings GUI (arbitrary domains, not only technology); pass topicId to use a saved topic, or topic/keywords to search an ad-hoc one.",
      "The 'blogger' action searches one creator's output by their profile link: pass bloggerId for a saved creator, or url plus an optional label for an ad-hoc one. The link is turned into a site-scoped query on that platform. The 'bloggers' action reads EVERY saved creator in parallel in one call (concurrency defaults to 4, override with concurrency 1-8) and returns one entry per creator; for Bilibili and Weibo it reads the platform API directly when a login cookie exists.",
      "The 'settings' action lists the saved search sources, topics and creator links; the 'history' action lists or restores a previous settings version, which is how a bad edit is rolled back.",
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'extract', 'batch', 'topic', 'blogger', 'bloggers', 'settings', 'history', 'cookie'],
          description: "The operation to perform: 'search' for one web search, 'batch' for up to 8 concurrent searches, 'extract' to pull full content from URLs, 'topic' to search a user-defined topic, 'blogger' to search one creator's profile link, 'settings' to list the saved settings, 'history' to list or restore previous settings versions, 'cookie' to inspect or clear the stored login cookies.",
        },
        query: {
          type: 'string',
          description: 'search: natural language query describing what to find.',
        },
        provider: {
          type: 'string',
          enum: ['auto', 'bing', 'tavily'],
          description: "search and batch: which channel answers. 'auto' (default) prefers the free Bing channel and falls back to Tavily when a key is set; 'bing' is free but snippet-only; 'tavily' costs 1 credit per query.",
        },
        queries: {
          type: 'array',
          description: 'batch: 1 to 8 search requests, executed concurrently. Each entry takes the same fields as a search call plus an optional label.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string', description: 'batch: short tag echoed back to map the result to your topic.' },
              query: { type: 'string' },
              provider: { type: 'string', enum: ['auto', 'bing', 'tavily'], description: 'batch: per-query channel override; defaults to the call-level provider.' },
              include_domains: { type: 'array', items: { type: 'string' } },
              exclude_domains: { type: 'array', items: { type: 'string' } },
              max_results: { type: 'integer' },
              search_depth: { type: 'string', enum: ['basic', 'advanced'] },
              include_answer: { type: 'boolean' },
              snippet_chars: { type: 'integer', description: 'Truncate each result content to this many characters.' },
            },
            required: ['query'],
          },
        },
        concurrency: {
          type: 'integer',
          description: 'batch: maximum concurrent upstream requests, 1 to 8 (default 6).',
        },
        snippet_chars: {
          type: 'integer',
          description: 'batch: default per-result content budget in characters (default 400; 0 keeps content whole).',
        },
        include_answer: {
          type: 'boolean',
          description: 'batch: default answer flag for entries that do not set their own (default false, to keep the payload lean).',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'extract: 1 to 20 URLs to extract full content from.',
        },
        include_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'search: optional allowlist of domains to search within.',
        },
        exclude_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'search: optional blocklist of domains to exclude.',
        },
        include_raw_content: {
          type: 'boolean',
          description: 'search: whether to return full page HTML (costs more credits).',
        },
        sourceId: {
          type: 'string',
          description: "search and batch: id of a search source saved in the settings GUI. A 'bing'/'tavily' source pins that channel; a 'site' source adds its domain to include_domains.",
        },
        topicId: {
          type: 'string',
          description: 'topic: id of a saved topic from the settings GUI. Omit to search an ad-hoc topic passed as topic/keywords.',
        },
        topic: {
          type: 'object',
          additionalProperties: false,
          description: 'topic: ad-hoc topic definition, used when topicId is omitted.',
          properties: {
            label: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' }, description: 'Search terms joined into the query.' },
            domains: { type: 'array', items: { type: 'string' }, description: 'Optional site scopes; one query is issued per domain, at most 4.' },
          },
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'topic, blogger and batch: extra terms appended to every generated query.',
        },
        bloggerId: {
          type: 'string',
          description: 'blogger: id of a saved creator link from the settings GUI.',
        },
        url: {
          type: 'string',
          description: 'blogger: profile link of the creator to search, for example https://space.bilibili.com/123456 or https://x.com/handle.',
        },
        label: {
          type: 'string',
          description: 'blogger: display name of the creator, used as the second query term when the URL carries no handle.',
        },
        op: {
          type: 'string',
          enum: ['list', 'restore'],
          description: "history: 'list' shows previous settings versions; 'restore' puts one back.",
        },
        site: {
          type: 'string',
          description: "cookie: site id to clear, for example 'bilibili'.",
        },
        deep: {
          type: 'boolean',
          description: 'blogger: on a logged-in Bilibili creator, also fetch the newest video full metadata (tags, stats, platform AI summary when available).',
        },
        snapshot_id: {
          type: 'string',
          description: 'history restore: the snapshot id returned by a list operation.',
        },
        concurrency: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: "bloggers: how many creators to read at once (default 4, max 8).",
        },
        limit: {
          type: 'integer',
          description: 'history list: maximum number of versions to return (default 20).',
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 60_000,
    async execute(args, exec) {
      const input = typeof args === 'object' && args !== null ? args : {};
      const config = getConfig();

      // Bing needs no key, so the tool is usable on a bare install. `defaults`
      // carries the resolved config the search branches read; page extraction
      // is the only capability that still requires a Tavily key, and it says so
      // in its own branch rather than blocking every action up front.
      const defaults = {
        ...config,
        searchDepth: config.searchDepth === 'advanced' ? 'advanced' : 'basic',
        maxResults: Number.isInteger(config.maxResults) && config.maxResults > 0 ? config.maxResults : 5,
      };

      switch (input.action) {
        case 'search': {
          if (typeof input.query !== 'string' || input.query.trim() === '') {
            return { ok: false, error: 'search requires a query string' };
          }

          const source = typeof input.sourceId === 'string' && input.sourceId !== ''
            ? enabledSources(settingsValue(settingsApi)).find(item => item.id === input.sourceId)
            : undefined;
          if (typeof input.sourceId === 'string' && input.sourceId !== '' && source === undefined) {
            return { ok: false, error: `search source ${input.sourceId} is not saved or is disabled; call action 'settings' to list the available ids` };
          }
          const channel = sourceChannel(source);
          const includeDomains = [
            ...(Array.isArray(input.include_domains) ? input.include_domains : []),
            ...(channel.includeDomains ?? []),
          ];

          const outcome = await runSearch(
            defaults,
            {
              query: input.query,
              provider: channel.provider ?? input.provider,
              include_answer: input.include_answer !== false,
              include_raw_content: input.include_raw_content === true,
              include_domains: includeDomains.length === 0 ? undefined : includeDomains,
              exclude_domains: input.exclude_domains,
            },
            exec.signal
          );

          if (!outcome.ok) return { ok: false, error: outcome.error };
          return { ok: true, ...outcome.value, ...(source === undefined ? {} : { source: source.id }) };
        }

        case 'batch': {
          if (!Array.isArray(input.queries) || input.queries.length === 0) {
            return { ok: false, error: 'batch requires a queries array of 1 to 8 entries' };
          }
          if (input.queries.length > MAX_BATCH_QUERIES) {
            return { ok: false, error: `batch accepts at most ${MAX_BATCH_QUERIES} queries, got ${input.queries.length}` };
          }

          const concurrency = Number.isInteger(input.concurrency) && input.concurrency > 0
            ? Math.min(input.concurrency, 8)
            : DEFAULT_CONCURRENCY;
          const defaultSnippet = Number.isInteger(input.snippet_chars) && input.snippet_chars >= 0
            ? input.snippet_chars
            : DEFAULT_SNIPPET_CHARS;
          const defaultAnswer = input.include_answer === true;

          // Bing throttles a burst faster than Tavily does, and it is the
          // default channel; keep enough requests in flight to be fast without
          // tripping 429 on a batch of eight.
          const effectiveProvider = resolveProvider(input.provider, defaults);
          const batchConcurrency = effectiveProvider === 'tavily'
            ? concurrency
            : Math.min(concurrency, BING_MAX_CONCURRENCY);

          const started = Date.now();
          const settled = await mapLimit(input.queries, batchConcurrency, (entry) => {
            const item = typeof entry === 'object' && entry !== null ? entry : {};
            return runSearch(
              defaults,
              {
                query: item.query,
                provider: item.provider ?? input.provider,
                search_depth: item.search_depth,
                max_results: item.max_results,
                include_answer: item.include_answer === undefined ? defaultAnswer : item.include_answer === true,
                include_domains: item.include_domains,
                exclude_domains: item.exclude_domains,
                snippet_chars: Number.isInteger(item.snippet_chars) ? item.snippet_chars : defaultSnippet,
              },
              exec.signal
            );
          });

          const batches = settled.map((outcome, index) => {
            const entry = typeof input.queries[index] === 'object' && input.queries[index] !== null ? input.queries[index] : {};
            const label = typeof entry.label === 'string' && entry.label !== '' ? entry.label : `q${index + 1}`;

            if (outcome.status === 'rejected') {
              return { label, query: typeof entry.query === 'string' ? entry.query : '', ok: false, error: String(outcome.reason?.message ?? outcome.reason) };
            }
            if (!outcome.value.ok) {
              return { label, query: typeof entry.query === 'string' ? entry.query : '', ok: false, error: outcome.value.error };
            }
            return { label, ok: true, cached: outcome.value.cached === true, ...outcome.value.value };
          });

          const failed = batches.filter(b => b.ok !== true).length;

          // Same lossless-JSON rule as the other branches: only a defined
          // number may reach the harness.
          return {
            ok: failed < batches.length,
            results: batches,
            succeeded: batches.length - failed,
            failed,
            concurrency: batchConcurrency,
            provider: effectiveProvider,
            elapsed_ms: Date.now() - started,
            ...(failed === batches.length ? { error: 'every query in the batch failed' } : {}),
          };
        }

        case 'extract': {
          if (config.tavilyApiKey === '') {
            return {
              ok: false,
              error: 'extract needs a Tavily API key (page bodies have no keyless channel). Set the key in the plugin settings, or keep using the free search actions and fetch pages with the built-in web fetch.',
            };
          }
          if (!Array.isArray(input.urls) || input.urls.length === 0 || input.urls.length > 20) {
            return { ok: false, error: 'extract requires 1 to 20 URLs in the urls array' };
          }

          // Deduplicate the request itself: repeating a URL inside one call must
          // never multiply the number of billed extractions.
          const requested = [];
          const seenUrls = new Set();
          for (const url of input.urls) {
            if (typeof url !== 'string' || url === '' || seenUrls.has(url)) continue;
            seenUrls.add(url);
            requested.push(url);
          }
          if (requested.length === 0) {
            return { ok: false, error: 'extract requires 1 to 20 non-empty URL strings' };
          }

          // Serve every URL that was already extracted recently; only the
          // remainder is sent upstream. Extraction is billed per 5 successful
          // URLs, so each cache hit is a URL Tavily is never charged for again.
          // `refresh: true` opts one call out of the cache, for pages that are
          // known to have changed since they were last read.
          const refresh = input.refresh === true;
          const byUrl = new Map();
          const cachedUrls = new Set();
          const missing = [];
          for (const url of requested) {
            const hit = refresh ? undefined : extractCacheGet(url);
            if (hit === undefined) {
              missing.push(url);
            } else if (hit !== null) {
              byUrl.set(url, hit);
              cachedUrls.add(url);
            }
          }

          let failedResults = 0;
          let guardNotice = null;
          if (missing.length > 0 && Date.now() < creditGuardUntil) {
            // The plan already reported a credit or rate limit. Billing nothing
            // beats issuing another doomed request for every URL in the batch.
            guardNotice = {
              active: true,
              retry_after_ms: creditGuardUntil - Date.now(),
              reason: 'Tavily reported a credit or rate limit earlier; new extractions are held back briefly.',
            };
            failedResults = missing.length;
          } else if (missing.length > 0) {
            const result = await tavilyExtract(
              config.tavilyApiKey,
              missing,
              exec.signal,
              config.timeoutMs
            );

            if (!result.ok) {
              if (isCreditExhaustedError(result.error)) {
                creditGuardUntil = Date.now() + CREDIT_GUARD_MS;
              }
              // A cached subset still answers the call; only a total miss fails.
              if (byUrl.size === 0) {
                return {
                  ok: false,
                  error: result.error,
                  ...(creditGuardUntil > Date.now() ? { credit_guard: true } : {}),
                };
              }
              failedResults = missing.length;
            } else {
              // Same hazard as the search branch: raw_content can be absent on a
              // partially extracted page, and failed_results can be omitted. Never
              // leave an own property holding undefined.
              for (const r of (Array.isArray(result.data.results) ? result.data.results : [])) {
                const normalized = normalizeResult(r);
                if (typeof normalized.url === 'string' && normalized.url !== '') {
                  extractCacheSet(normalized.url, clipForCache(normalized));
                  byUrl.set(normalized.url, normalized);
                }
              }
              // A requested URL that came back without a body is remembered
              // briefly, so an immediate retry does not pay again for a page
              // that has already refused to yield content.
              for (const url of missing) {
                if (!byUrl.has(url)) extractCacheSet(url, null);
              }
              failedResults = typeof result.data.failed_results === 'number' ? result.data.failed_results : 0;
            }
          }

          const results = [];
          for (const url of requested) {
            const hit = byUrl.get(url);
            if (hit !== undefined) results.push(hit);
          }

          const newlyExtracted = results.filter(r => !cachedUrls.has(r.url)).length;

          return {
            ok: true,
            results,
            failed_results: failedResults,
            requested: requested.length,
            served_from_cache: cachedUrls.size,
            credits_estimated: Math.ceil(newlyExtracted / URLS_PER_EXTRACT_CREDIT),
            ...(guardNotice === null ? {} : { credit_guard: guardNotice }),
          };
        }

        case 'topic': {
          const settings = settingsValue(settingsApi);
          const saved = typeof input.topicId === 'string' && input.topicId !== ''
            ? enabledTopics(settings).find(item => item.id === input.topicId)
            : undefined;
          if (typeof input.topicId === 'string' && input.topicId !== '' && saved === undefined) {
            return { ok: false, error: `topic ${input.topicId} is not saved or is disabled; call action 'settings' to list the available ids` };
          }
          const topic = saved ?? (typeof input.topic === 'object' && input.topic !== null ? input.topic : { keywords: input.keywords });
          const built = buildTopicQueries(topic, { keywords: input.keywords, maxQueries: 4 });
          if (!built.ok) return { ok: false, error: built.error };

          const source = typeof input.sourceId === 'string' && input.sourceId !== ''
            ? enabledSources(settings).find(item => item.id === input.sourceId)
            : undefined;
          if (typeof input.sourceId === 'string' && input.sourceId !== '' && source === undefined) {
            return { ok: false, error: `search source ${input.sourceId} is not saved or is disabled; call action 'settings' to list the available ids` };
          }
          const channel = sourceChannel(source);

          const snippet = Number.isInteger(input.snippet_chars) && input.snippet_chars >= 0 ? input.snippet_chars : DEFAULT_SNIPPET_CHARS;
          const outcome = await runQueryGroup(
            defaults,
            built.queries.map(item => ({ ...item, provider: channel.provider ?? input.provider, includeDomains: channel.includeDomains })),
            {
              provider: channel.provider ?? input.provider,
              signal: exec.signal,
              snippetChars: snippet,
              domains: [...new Set([...(built.domains ?? []), ...(channel.includeDomains ?? [])])],
            }
          );
          return {
            ...outcome,
            topic: { id: saved?.id ?? null, label: typeof topic?.label === 'string' ? topic.label : '', keywords: topic?.keywords ?? [] },
            ...(source === undefined ? {} : { source: source.id }),
          };
        }

        case 'blogger': {
          const settings = settingsValue(settingsApi);
          const saved = typeof input.bloggerId === 'string' && input.bloggerId !== ''
            ? enabledBloggers(settings).find(item => item.id === input.bloggerId)
            : undefined;
          if (typeof input.bloggerId === 'string' && input.bloggerId !== '' && saved === undefined) {
            return { ok: false, error: `creator ${input.bloggerId} is not saved or is disabled; call action 'settings' to list the available ids` };
          }
          const blogger = saved ?? { url: input.url, label: input.label };
          const built = buildBloggerQueries(blogger, { keywords: input.keywords });
          if (!built.ok) return { ok: false, error: built.error };

          let apiFallback = null;
          const cookieHeader = typeof settingsApi?.cookieHeader === 'function' ? settingsApi.cookieHeader('bilibili') : '';
          const handle = String(blogger?.url ?? '').match(/space\.bilibili\.com\/(\d+)/);
          if (built.platform === 'bilibili' && handle) {
            // With a stored login the space API answers exactly; without it we
            // fall through to the search channels, which can only see indexed pages.
            try {
              // Same reader as the 'bloggers' batch: one implementation, so the
              // single and multi-creator paths cannot drift apart.
              const data = await readBilibiliCreator(handle[1], {
                cookie: cookieHeader,
                ps: 10,
                deep: input.deep === true,
              });
              const videos = data.videos;
              const deep = data.newest ? { video: data.newest.video, conclusion: data.newest.summary } : null;
              return {
                ok: true,
                channel: 'bilibili-api',
                loggedIn: data.loggedIn,
                creator: {
                  id: saved?.id ?? null,
                  label: typeof blogger.label === 'string' ? blogger.label : '',
                  platform: 'bilibili',
                  platformLabel: built.platformLabel,
                  mid: handle[1],
                  domain: 'bilibili.com',
                },
                videos,
                newest: videos[0] ?? null,
                ...(deep ? { deep } : {}),
                ...(apiFallback ? { apiFallback } : {}),
                note: cookieHeader
                  ? '数据来自 B站空间 API（已用保存的登录 Cookie，可读 AI 总结与完整统计）。'
                  : '数据来自 B站空间 API 的匿名读取；保存登录 Cookie 后可再取平台 AI 总结。',
              };
            } catch (error) {
              // A blocked or rate-limited API must not lose the creator: fall back
              // to the search channels and say why the API path was skipped.
              built.queries.unshift({ query: `${blogger.label ?? ''} 最新视频`, label: 'api-fallback' });
              apiFallback = error instanceof Error ? error.message : String(error);
            }
          }

          const snippet = Number.isInteger(input.snippet_chars) && input.snippet_chars >= 0 ? input.snippet_chars : DEFAULT_SNIPPET_CHARS;
          const outcome = await runQueryGroup(
            defaults,
            built.queries.map(item => ({ ...item, provider: input.provider })),
            {
              provider: input.provider,
              signal: exec.signal,
              snippetChars: snippet,
              domains: built.domain ? [built.domain] : [],
            }
          );
          return {
            ...outcome,
            blogger: {
              id: saved?.id ?? null,
              label: typeof blogger.label === 'string' ? blogger.label : '',
              platform: built.platform,
              platformLabel: built.platformLabel,
              domain: built.domain,
            },
          };
        }

        case 'cookie': {
          const op = typeof input.op === 'string' && input.op !== '' ? input.op : 'list';
          if (op === 'clear') {
            if (typeof settingsApi?.cookieClear !== 'function') {
              return { ok: false, error: 'cookie store is unavailable: this Host mounted the tool without plugin data' };
            }
            const cleared = settingsApi.cookieClear(typeof input.site === 'string' ? input.site : '');
            return { ok: true, op, cleared, cookies: typeof settingsApi.cookieSummary === 'function' ? settingsApi.cookieSummary() : null };
          }
          if (typeof settingsApi?.cookieSummary !== 'function') {
            return { ok: false, error: 'cookie store is unavailable: this Host mounted the tool without plugin data' };
          }
          return {
            ok: true,
            op,
            cookies: settingsApi.cookieSummary(),
            hint: "To capture a session, open DSH settings → sidebar「搜索控制」→ 登录 Cookie and press 获取 Cookie. Values are never returned to a page; only names and expiry are shown.",
          };
        }

        case 'bloggers': {
          const settings = settingsValue(settingsApi);
          const saved = enabledBloggers(settings);
          if (saved.length === 0) {
            return { ok: false, error: "no saved creators; add one in DSH settings → 搜索控制 → 博主" };
          }
          const takeAll = !(Number.isInteger(input.limit) && input.limit > 0);
          const targets = takeAll ? saved : saved.slice(0, Math.min(input.limit, saved.length));
          const requested = Number.isInteger(input.concurrency)
            ? Math.max(1, Math.min(8, input.concurrency))
            : BLOGGER_CONCURRENCY;
          // Report the fan-out that actually happened, not the number asked for.
          const concurrency = Math.min(requested, targets.length);
          const startedAt = Date.now();
          const cookieFor = site => (typeof settingsApi?.cookieHeader === 'function' ? settingsApi.cookieHeader(site) : '');
          const results = new Array(targets.length);
          let cursor = 0;

          const worker = async () => {
            while (cursor < targets.length) {
              const index = cursor;
              cursor += 1;
              const blogger = targets[index];
              const label = typeof blogger.label === 'string' ? blogger.label : '';
              const link = String(blogger.url ?? '');
              try {
                const bilibili = link.match(/space\.bilibili\.com\/(\d+)/);
                const weibo = link.match(/weibo\.(?:com|cn)\/(?:u\/)?(\d{6,})/);
                if (bilibili) {
                  const data = await readBilibiliCreator(bilibili[1], {
                    cookie: cookieFor('bilibili'),
                    ps: 6,
                    deep: input.deep === true,
                  });
                  results[index] = { ok: true, id: blogger.id, label, url: link, ...data, newest: data.newest ?? data.videos[0] ?? null };
                } else if (weibo) {
                  const data = await readWeiboCreator(weibo[1], { cookie: cookieFor('weibo') });
                  results[index] = { ok: data.error === undefined, id: blogger.id, label, url: link, ...data, ...(data.error ? {} : { newest: data.posts[0] ?? null }) };
                } else {
                  results[index] = {
                    ok: false,
                    id: blogger.id,
                    label,
                    url: link,
                    error: 'this link is not a platform with a direct read API; use action "blogger" with the same url for a site-scoped search',
                  };
                }
              } catch (error) {
                results[index] = {
                  ok: false,
                  id: blogger.id,
                  label,
                  url: link,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            }
          };

          await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
          const failed = results.filter(item => item?.ok !== true).length;
          return {
            ok: true,
            action: 'bloggers',
            concurrency,
            elapsedMs: Date.now() - startedAt,
            count: results.length,
            failed,
            creators: results,
          };
        }

        case 'settings': {
          const settings = settingsValue(settingsApi);
          return {
            ok: true,
            settings,
            counts: countSettings(settings),
            dataDir: typeof settingsApi?.dataDir === 'string' ? settingsApi.dataDir : null,
            historyLimit: Number.isInteger(settingsApi?.historyLimit) ? settingsApi.historyLimit : null,
            hint: "Edit these in DSH settings → Plugins → search-contrl. Every save keeps the previous version; use action 'history' to undo.",
          };
        }

        case 'history': {
          if (typeof settingsApi?.history !== 'function') {
            return { ok: false, error: 'settings history is unavailable: this Host mounted the tool without a settings store' };
          }
          if (input.op === 'restore') {
            if (typeof settingsApi?.restore !== 'function') {
              return { ok: false, error: 'settings restore is unavailable: this Host mounted the tool without a settings store' };
            }
            const restored = settingsApi.restore(input.snapshot_id);
            if (!restored?.ok) return { ok: false, error: restored?.error ?? 'rollback failed' };
            return {
              ok: true,
              restored: input.snapshot_id,
              snapshot: restored.snapshot,
              settings: restored.value,
            };
          }
          const limit = Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 100) : 20;
          return { ok: true, history: settingsApi.history(limit), hint: "Pass op 'restore' with snapshot_id to put one version back." };
        }

        default:
          return { ok: false, error: "action must be 'search', 'batch', 'extract', 'topic', 'blogger', 'bloggers', 'settings', 'history' or 'cookie'" };
      }
    },
  };
}
