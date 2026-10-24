/**
 * Keyless search adapter on top of Bing's RSS output.
 *
 * Bing serves `https://www.bing.com/search?q=...&format=rss` as RSS 2.0 with no
 * API key and no per-call billing, which makes it the free channel for this
 * plugin: locate candidate pages without spending Tavily credits, then pay for
 * a page body only when the snippet is not enough.
 *
 * Two honest limitations, both reflected in the tool result rather than hidden:
 * a page holds about ten items, and an item carries a snippet instead of the
 * page body. Pagination is attempted, but Bing may repeat or ignore the `first`
 * offset, so the adapter deduplicates and stops as soon as a page adds nothing.
 *
 * @module dsh-search-contrl/bing
 */

/** Bing's RSS endpoint. Same host serves the HTML search UI. */
const BING_ENDPOINT = 'https://www.bing.com/search';

/** Items per RSS page. Bing's RSS output does not honour larger counts. */
const BING_PAGE_SIZE = 10;

/** Hard cap on fetched pages per query, so a bad offset cannot loop. */
const BING_MAX_PAGES = 3;

/** Default per-request timeout, matching the plugin's own defaults. */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Bing answers a missing or exotic user agent with the HTML UI instead of RSS.
 * Presenting a normal browser identity keeps the response shape stable.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Build the RSS URL for one page of results.
 *
 * @param {string} query
 * @param {{ market?: string, first?: number }} [options]
 * @returns {string}
 */
function buildBingUrl(query, options = {}) {
  const market = typeof options.market === 'string' && options.market !== '' ? options.market : 'zh-CN';
  const first = Number.isInteger(options.first) && options.first > 0 ? options.first : 0;
  const params = new URLSearchParams({
    q: query,
    format: 'rss',
    count: String(BING_PAGE_SIZE),
    mkt: market,
  });
  if (first > 0) params.set('first', String(first));
  return `${BING_ENDPOINT}?${params.toString()}`;
}

/**
 * Translate the structured domain filters into Bing's query syntax.
 *
 * Bing has no request field for allow/deny lists, but it does understand
 * `site:` and `-site:` operators; folding the filters into the query keeps the
 * tool's public shape identical across providers.
 *
 * @param {string} query
 * @param {string[]} [includeDomains]
 * @param {string[]} [excludeDomains]
 * @returns {string}
 */
function buildBingQuery(query, includeDomains, excludeDomains) {
  const parts = [];

  if (Array.isArray(includeDomains)) {
    const sites = includeDomains
      .map(d => String(d).trim())
      .filter(d => d !== '')
      .map(d => `site:${d}`);
    if (sites.length > 0) parts.push(`(${sites.join(' OR ')})`);
  }

  if (Array.isArray(excludeDomains)) {
    for (const domain of excludeDomains) {
      const trimmed = String(domain).trim();
      if (trimmed !== '') parts.push(`-site:${trimmed}`);
    }
  }

  return parts.length === 0 ? query : `${query} ${parts.join(' ')}`;
}

/**
 * Decode the XML entities Bing emits inside titles and descriptions.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Read one tag's inner text from an `<item>` block, unwrapping CDATA.
 *
 * @param {string} block
 * @param {string} tag
 * @returns {string}
 */
function readTag(block, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (match === null) return '';
  let value = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
  if (cdata !== null) value = cdata[1];
  return decodeEntities(value).trim();
}

/**
 * Strip the inline markup Bing leaves in descriptions before handing them to
 * the report writer, which must never receive half a tag as "content".
 *
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert a `pubDate` into an ISO date string when it parses, and omit it
 * otherwise. Returning `undefined` here is deliberate: an own property holding
 * `undefined` is rejected by the harness as "not lossless JSON", so callers
 * must only ever see the key when it carries a real value.
 *
 * @param {string} raw
 * @returns {string | undefined}
 */
function toIsoDate(raw) {
  if (raw === '') return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

/**
 * Parse a Bing RSS document into normalized results.
 *
 * Only defined fields are attached, for the same lossless-JSON reason as
 * `toIsoDate`. A block without a link is dropped: it cannot be cited.
 *
 * @param {string} xml
 * @returns {Array<{ url: string, title: string, content: string, published_date?: string }>}
 */
function parseBingRss(xml) {
  const source = String(xml ?? '');
  const blocks = source.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const items = [];

  for (const block of blocks) {
    const url = readTag(block, 'link');
    if (url === '') continue;

    const title = readTag(block, 'title');
    const description = stripTags(readTag(block, 'description'));
    const published = toIsoDate(readTag(block, 'pubDate'));

    const item = {
      url,
      title: title === '' ? url : title,
      content: description,
    };
    if (published !== undefined) item.published_date = published;
    items.push(item);
  }

  return items;
}

/**
 * Fetch one URL as text, honouring both an outer abort signal and a timeout.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @param {AbortSignal} [outerSignal]
 * @returns {Promise<string>}
 */
async function fetchText(url, timeoutMs, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`bing request timed out after ${timeoutMs} ms`)), timeoutMs);
  const onOuterAbort = () => controller.abort(outerSignal?.reason);
  if (outerSignal !== undefined) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    });

    if (!response.ok) {
      // 429/503 are the shapes Bing uses when it throttles; say so, because the
      // caller's next move (slow down vs give up) depends on the difference.
      const hint = response.status === 429 || response.status === 503 ? ' (Bing is throttling, slow down)' : '';
      throw new Error(`HTTP ${response.status}${hint}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
    if (outerSignal !== undefined) outerSignal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Run a keyless Bing search and normalize the results.
 *
 * The return shape mirrors the Tavily adapter so callers do not branch on the
 * provider: `{ ok: true, data: { query, provider, results, response_time } }`
 * or `{ ok: false, error }`.
 *
 * @param {string} query
 * @param {{ maxResults?: number, market?: string, includeDomains?: string[], excludeDomains?: string[], timeoutMs?: number, signal?: AbortSignal, maxPages?: number }} [options]
 * @returns {Promise<{ ok: true, data: { query: string, provider: 'bing', results: Array<Object>, response_time: number } } | { ok: false, error: string }>}
 */
export async function bingSearch(query, options = {}) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (text === '') return { ok: false, error: 'bing search requires a query string' };

  const started = Date.now();
  const maxResults = Number.isInteger(options.maxResults) && options.maxResults > 0
    ? Math.min(options.maxResults, BING_PAGE_SIZE * BING_MAX_PAGES)
    : BING_PAGE_SIZE;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const market = typeof options.market === 'string' && options.market !== '' ? options.market : 'zh-CN';
  const pages = Number.isInteger(options.maxPages) && options.maxPages > 0
    ? Math.min(options.maxPages, BING_MAX_PAGES)
    : BING_MAX_PAGES;
  const effectiveQuery = buildBingQuery(text, options.includeDomains, options.excludeDomains);

  const results = [];
  const seen = new Set();

  try {
    for (let page = 0; page < pages && results.length < maxResults; page += 1) {
      const url = buildBingUrl(effectiveQuery, { market, first: page * BING_PAGE_SIZE });
      const xml = await fetchText(url, timeoutMs, options.signal);
      const pageItems = parseBingRss(xml);
      if (pageItems.length === 0) break;

      let added = 0;
      for (const item of pageItems) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        results.push(item);
        added += 1;
        if (results.length >= maxResults) break;
      }
      // A page that repeats what we already have means the offset was ignored:
      // stop instead of paying for the same ten links on every page.
      if (added === 0) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `bing search failed: ${message}` };
  }

  return {
    ok: true,
    data: {
      query: text,
      provider: 'bing',
      results,
      response_time: Date.now() - started,
    },
  };
}
