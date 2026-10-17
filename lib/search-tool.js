/**
 * The plugin search tool. Registers as `tech_daily_search` when a Tavily key
 * is configured, making the Tavily direct adapter available to agents without
 * relying on DSH's web_search. Refuses all calls when the key is blank.
 *
 * @module dsh-tech-daily-report/search-tool
 */
import { tavilySearch, tavilyExtract } from './tavily.js';

/** The registered tool name. */
export const TECH_DAILY_SEARCH_TOOL = 'tech_daily_search';

/** Default per-result content budget for batch mode, in characters. */
const DEFAULT_SNIPPET_CHARS = 400;

/** Maximum queries accepted by one batch call. */
const MAX_BATCH_QUERIES = 8;

/** Maximum concurrent upstream requests inside one batch call. */
const DEFAULT_CONCURRENCY = 6;

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
 * @param {string} depth
 * @param {number} maxResults
 * @param {boolean} includeAnswer
 * @param {boolean} includeRawContent
 * @param {{ query: string, include_domains?: string[], exclude_domains?: string[] }} params
 * @returns {string}
 */
function cacheKey(depth, maxResults, includeAnswer, includeRawContent, params) {
  return JSON.stringify([
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
 * Read one unexpired cache entry.
 *
 * @param {string} key
 * @returns {Object | undefined}
 */
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
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
  cache.set(key, { at: Date.now(), value });
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
  const hit = extractCache.get(url);
  if (hit === undefined) return undefined;
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
  extractCache.set(url, { at: Date.now(), value });
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
 * Build the tool definition bound to one effectiveConfig function.
 *
 * @param {() => { tavilyApiKey: string, searchDepth: 'basic' | 'advanced', maxResults: number, timeoutMs: number }} getConfig
 * @returns {Object} tool definition ready for ctx.tools.register
 */
export function buildSearchTool(getConfig) {
  /**
   * Execute one cached Tavily search.
   *
   * @param {string} apiKey
   * @param {{ query: string, search_depth?: string, max_results?: number, include_answer?: boolean, include_raw_content?: boolean, include_domains?: string[], exclude_domains?: string[], snippet_chars?: number }} params
   * @param {AbortSignal | undefined} signal
   * @param {number} timeoutMs
   * @param {{ searchDepth: string, maxResults: number }} defaults
   * @returns {Promise<{ ok: true, value: Object, cached: boolean } | { ok: false, error: string }>}
   */
  async function runSearch(apiKey, params, signal, timeoutMs, defaults) {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (query === '') return { ok: false, error: 'search requires a query string' };

    const searchDepth = params.search_depth === 'advanced' || params.search_depth === 'basic'
      ? params.search_depth
      : defaults.searchDepth;
    const maxResults = Number.isInteger(params.max_results) && params.max_results > 0
      ? Math.min(params.max_results, 20)
      : defaults.maxResults;
    const includeAnswer = params.include_answer === true;
    const includeRawContent = params.include_raw_content === true;
    const includeDomains = Array.isArray(params.include_domains) ? params.include_domains : undefined;
    const excludeDomains = Array.isArray(params.exclude_domains) ? params.exclude_domains : undefined;

    const key = cacheKey(searchDepth, maxResults, includeAnswer, includeRawContent, {
      query, include_domains: includeDomains, exclude_domains: excludeDomains,
    });
    const cached = cacheGet(key);
    if (cached !== undefined) return { ok: true, value: cached, cached: true };

    const result = await tavilySearch(
      apiKey,
      {
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: includeAnswer,
        include_raw_content: includeRawContent,
        include_domains: includeDomains,
        exclude_domains: excludeDomains,
      },
      signal,
      timeoutMs
    );

    if (!result.ok) return { ok: false, error: result.error };

    const value = {
      query: typeof result.data.query === 'string' ? result.data.query : query,
      results: Array.isArray(result.data.results)
        ? result.data.results.map(r => normalizeResult(r, params.snippet_chars))
        : [],
    };
    if (typeof result.data.answer === 'string' && result.data.answer !== '') value.answer = result.data.answer;
    if (typeof result.data.response_time === 'number') value.response_time = result.data.response_time;

    cacheSet(key, value);
    return { ok: true, value, cached: false };
  }

  return {
    name: TECH_DAILY_SEARCH_TOOL,
    description: [
      'Search the web for technology news using Tavily.',
      'Supports natural language queries and returns AI-generated answers plus ranked results with URLs, titles, and snippets.',
      'Use this when the built-in web search is unavailable or when you need direct vendor page extraction.',
      "The 'search' action runs one query; the 'batch' action runs up to 8 queries concurrently in a single call and is the fast path for multi-topic collection (one call replaces six sequential calls at roughly 5x the wall-clock speed).",
      "The 'extract' action bypasses navigation-heavy pages and returns full text; extracted pages are cached per URL for 24 hours, so re-reading a page you already extracted costs no credits.",
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'extract', 'batch'],
          description: "The operation to perform: 'search' for one web search, 'batch' for up to 8 concurrent searches, 'extract' to pull full content from URLs.",
        },
        query: {
          type: 'string',
          description: 'search: natural language query describing what to find.',
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

      if (!config.tavilyApiKey) {
        return {
          ok: false,
          error: 'tech_daily_search requires a Tavily API key. Set it in the plugin settings (https://www.tavily.com/ offers 1000 free credits/month).',
        };
      }

      const defaults = {
        searchDepth: config.searchDepth === 'advanced' ? 'advanced' : 'basic',
        maxResults: Number.isInteger(config.maxResults) && config.maxResults > 0 ? config.maxResults : 5,
      };

      switch (input.action) {
        case 'search': {
          if (typeof input.query !== 'string' || input.query.trim() === '') {
            return { ok: false, error: 'search requires a query string' };
          }

          const outcome = await runSearch(
            config.tavilyApiKey,
            {
              query: input.query,
              include_answer: input.include_answer !== false,
              include_raw_content: input.include_raw_content === true,
              include_domains: input.include_domains,
              exclude_domains: input.exclude_domains,
            },
            exec.signal,
            config.timeoutMs,
            defaults
          );

          if (!outcome.ok) return { ok: false, error: outcome.error };
          return { ok: true, ...outcome.value };
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

          const started = Date.now();
          const settled = await mapLimit(input.queries, concurrency, (entry) => {
            const item = typeof entry === 'object' && entry !== null ? entry : {};
            return runSearch(
              config.tavilyApiKey,
              {
                query: item.query,
                search_depth: item.search_depth,
                max_results: item.max_results,
                include_answer: item.include_answer === undefined ? defaultAnswer : item.include_answer === true,
                include_domains: item.include_domains,
                exclude_domains: item.exclude_domains,
                snippet_chars: Number.isInteger(item.snippet_chars) ? item.snippet_chars : defaultSnippet,
              },
              exec.signal,
              config.timeoutMs,
              defaults
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
            concurrency,
            elapsed_ms: Date.now() - started,
            ...(failed === batches.length ? { error: 'every query in the batch failed' } : {}),
          };
        }

        case 'extract': {
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

        default:
          return { ok: false, error: "action must be 'search', 'batch' or 'extract'" };
      }
    },
  };
}
