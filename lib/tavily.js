/**
 * Tavily direct search adapter. Called only when DSH built-in search fails or
 * when extracting full content from vendor pages whose navigation occupies
 * most of the web_fetch output. This bypasses the DSH web_search tool and
 * hits the Tavily API directly when a key is configured.
 *
 * Returns null when the API is unreachable or disabled; business errors like
 * rate limits come back as { ok: false, error: string }.
 *
 * @module dsh-tech-daily-report/tavily
 */

/**
 * Tavily search API request schema.
 *
 * @typedef {Object} TavilySearchRequest
 * @property {string} query - natural language query
 * @property {string} [search_depth='basic'] - 'basic' | 'advanced'
 * @property {number} [max_results=5] - 1 to 20
 * @property {boolean} [include_answer=true] - whether to return an AI-generated answer
 * @property {boolean} [include_raw_content=false] - return full page HTML
 * @property {string[]} [include_domains] - allowlist domains
 * @property {string[]} [exclude_domains] - blocklist domains
 */

/**
 * Tavily search response schema.
 *
 * @typedef {Object} TavilySearchResponse
 * @property {string} [answer] - AI-generated answer
 * @property {Array<{ url: string, title: string, content: string, score: number, published_date?: string }>} results
 * @property {string} query
 * @property {number} response_time
 */

/**
 * Tavily extract API request schema.
 *
 * @typedef {Object} TavilyExtractRequest
 * @property {string[]} urls - URLs to extract content from (max 20)
 */

/**
 * Tavily extract response schema.
 *
 * @typedef {Object} TavilyExtractResponse
 * @property {Array<{ url: string, raw_content: string }>} results
 * @property {number} failed_results
 */

/**
 * Execute one Tavily search call.
 *
 * @param {string} apiKey - Tavily API key (tvly-...)
 * @param {TavilySearchRequest} params - search parameters
 * @param {AbortSignal} [signal] - cancellation signal
 * @param {number} [timeoutMs=45000] - HTTP timeout
 * @returns {Promise<{ ok: true, data: TavilySearchResponse } | { ok: false, error: string }>}
 */
export async function tavilySearch(apiKey, params, signal, timeoutMs = 45000) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('tvly-')) {
    return { ok: false, error: 'tavilyApiKey is blank or malformed' };
  }

  const endpoint = 'https://api.tavily.com/search';
  const body = JSON.stringify({
    api_key: apiKey,
    query: params.query,
    search_depth: params.search_depth ?? 'basic',
    max_results: params.max_results ?? 5,
    include_answer: params.include_answer ?? true,
    include_raw_content: params.include_raw_content ?? false,
    include_domains: params.include_domains,
    exclude_domains: params.exclude_domains,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const composite = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      signal: composite,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Tavily search HTTP ${response.status}: ${text || response.statusText}`,
      };
    }

    const data = await response.json();
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Tavily search timed out or was cancelled' };
    }
    return { ok: false, error: `Tavily search fetch failed: ${err.message}` };
  }
}

/**
 * Extract full page content from one or more URLs.
 *
 * @param {string} apiKey - Tavily API key
 * @param {string[]} urls - URLs to extract (max 20)
 * @param {AbortSignal} [signal] - cancellation signal
 * @param {number} [timeoutMs=45000] - HTTP timeout
 * @returns {Promise<{ ok: true, data: TavilyExtractResponse } | { ok: false, error: string }>}
 */
export async function tavilyExtract(apiKey, urls, signal, timeoutMs = 45000) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('tvly-')) {
    return { ok: false, error: 'tavilyApiKey is blank or malformed' };
  }
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 20) {
    return { ok: false, error: 'urls must be an array of 1 to 20 strings' };
  }

  const endpoint = 'https://api.tavily.com/extract';
  const body = JSON.stringify({
    api_key: apiKey,
    urls,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const composite = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      signal: composite,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Tavily extract HTTP ${response.status}: ${text || response.statusText}`,
      };
    }

    const data = await response.json();
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Tavily extract timed out or was cancelled' };
    }
    return { ok: false, error: `Tavily extract fetch failed: ${err.message}` };
  }
}
