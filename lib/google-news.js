/**
 * Keyless discovery adapter on top of Google News RSS.
 *
 * Google serves `https://news.google.com/rss/search?q=...` as RSS 2.0 with no
 * API key and no per-call billing — the same cost as the Bing RSS channel
 * (0 credits), but the results are real news articles from real outlets
 * instead of encyclopedia and Q&A pages. Measured 2026-11-07 for
 * "脑机接口 最新": Bing's discovery round answered with 百度经验 / 知乎 /
 * 搜狗问问, while Google News answered with 新京报 / 财联社 / 央视网 /
 * 科学网 in ~1.8s.
 *
 * Two shapes to know before using it:
 * - an item's <link> is a news.google.com redirect, not the article. The
 *   redirect still opens the article when clicked, but following it with
 *   `redirect: 'manual'` dead-ends: the second hop answers 200 on Google's
 *   own host (the publisher URL is never exposed in a response header).
 *   The outlet name in the <source> tag is therefore the domain signal:
 *   outletDomain() maps the outlets we are sure about to their domains,
 *   and discoverDomains() counts those. An unmapped outlet still yields a
 *   candidate; it just does not become a site-scoped source.
 * - one page holds up to ~40 items, so there is no pagination: one request
 *   per query is the whole search. Google News ranks by relevance, not
 *   recency: without a date bound, a niche topic returns items spanning
 *   years ("脑机接口 最新" came back with 2019–2026 and zero items from
 *   the last two days). Bound the window with the `after:` / `before:`
 *   operators instead — widen each side by a day, because the operators
 *   are fuzzy at the boundary, and let the caller's window filter do the
 *   exact scoping by pubDate. Do NOT append a bare date string as a
 *   keyword ("脑机接口 最新 2026-11-07" returned 8 items, most months
 *   old): the date is then just another search term.
 *
 * This module is the discovery default for topics with no preset. Bing stays
 * as the fallback when Google News fails or answers nothing, and Tavily is
 * never spent by the dynamic path. Google News is also a first-class
 * `search` / `batch` provider (selectable in the settings page), not
 * discovery-only.
 *
 * @module dsh-search-contrl/google-news
 */

/** Google News RSS endpoint. Same host serves the news UI. */
const GOOGLE_NEWS_ENDPOINT = 'https://news.google.com/rss/search';

/** Default per-request timeout for the RSS fetch itself. */
const DEFAULT_TIMEOUT_MS = 12000;

/**
 * Outlet name (<source> tag) -> publisher domain, for the outlets we are
 * sure about. Only these become site-scoped sources: an unmapped outlet
 * still yields a candidate, it just does not contribute a domain. Add an
 * entry when a new outlet keeps showing up in discovery results; never
 * guess a mapping — a wrong domain would send the second round to the
 * wrong site.
 */
const OUTLET_DOMAINS = {
  '新京报': 'bjnews.com.cn',
  '财联社': 'cls.cn',
  '财联社电报': 'cls.cn',
  '央视网': 'cctv.com',
  '央视新闻': 'news.cctv.com',
  '科学网': 'sciencenet.cn',
  '中国科技网': 'stdaily.com',
  '人民网': 'people.com.cn',
  '新华社': 'xinhuanet.com',
  '中国新闻网': 'chinanews.com.cn',
  '东方财富': 'eastmoney.com',
  '财富号': 'eastmoney.com',
  '21财经': '21jingji.com',
  '第一财经': 'yicai.com',
  '界面新闻': 'jiemian.com',
  '澎湃': 'thepaper.cn',
  '36氪': '36kr.com',
  'IT之家': 'ithome.com',
  '钛媒体': 'tmtpost.com',
  '虎嗅': 'huxiu.com',
  '新浪财经': 'finance.sina.com.cn',
  '腾讯新闻': 'news.qq.com',
  '网易新闻': '163.com',
  '搜狐': 'sohu.com',
  '今日头条': 'toutiao.com',
  '观察者网': 'guancha.cn',
  '环球网': 'huanqiu.com',
  '中国证券报': 'cs.com.cn',
  '证券日报': 'zqrb.cn',
  '上海证券报': 'cnstock.com',
  '经济观察网': 'eeo.com.cn',
  '光明网': 'gmw.cn',
  '央广网': 'cnr.cn',
  '中国经济网': 'ce.cn',
  '中金在线': 'cnfol.com',
  '金融界': 'jrj.com.cn',
  '证券之星': 'stockstar.com',
  '长江网': 'cjn.cn',
  '上海有色金属网': 'smm.cn',
  '生物通': 'ebiotrade.com',
  '世界互联网大会': 'wicinternet.org',
  '中国共产党员网': '12371.cn',
};

/**
 * Publisher domain for an outlet name, or null when the outlet is not in
 * the table. The name must match exactly — Google News prints the outlet
 * as registered, so do not normalize or fuzzy-match it.
 *
 * @param {string} outlet
 * @returns {string | null}
 */
export function outletDomain(outlet) {
  if (typeof outlet !== 'string' || outlet === '') return null;
  return OUTLET_DOMAINS[outlet] ?? null;
}

/**
 * A normal browser identity keeps the response shape stable; the default
 * fetch UA gets the HTML UI instead of RSS on some endpoints.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Build the RSS URL for one query.
 *
 * @param {string} query
 * @param {{ hl?: string, gl?: string, ceid?: string }} [options]
 * @returns {string}
 */
export function buildGoogleNewsUrl(query, options = {}) {
  const params = new URLSearchParams({
    q: typeof query === 'string' ? query.trim() : '',
    hl: typeof options.hl === 'string' && options.hl !== '' ? options.hl : 'zh-CN',
    gl: typeof options.gl === 'string' && options.gl !== '' ? options.gl : 'CN',
    ceid: typeof options.ceid === 'string' && options.ceid !== '' ? options.ceid : 'CN:zh-Hans',
  });
  return `${GOOGLE_NEWS_ENDPOINT}?${params.toString()}`;
}

/**
 * Decode the XML entities Google News emits inside titles and descriptions.
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
 * Strip the inline markup Google News leaves in descriptions before handing
 * them to the report writer, which must never receive half a tag as "content".
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
 * Parse a Google News RSS document into normalized results.
 *
 * Only defined fields are attached, for the same lossless-JSON reason as
 * `toIsoDate`. A block without a link is dropped: it cannot be cited.
 * `source` is the outlet name from the <source> tag (e.g. "新京报"), and
 * `publisherDomain` is attached when that outlet is in the outlet table —
 * the domain discoverDomains() counts, since the <link> itself is a
 * Google redirect that never reveals the publisher host.
 *
 * @param {string} xml
 * @returns {Array<{ url: string, title: string, content: string, source: string, publisherDomain?: string, published_date?: string }>}
 */
export function parseGoogleNewsRss(xml) {
  const source = String(xml ?? '');
  const blocks = source.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const items = [];

  for (const block of blocks) {
    const url = readTag(block, 'link');
    if (url === '') continue;

    const title = readTag(block, 'title');
    const description = stripTags(readTag(block, 'description'));
    const published = toIsoDate(readTag(block, 'pubDate'));
    const outlet = readTag(block, 'source');
    const domain = outletDomain(outlet);

    const item = {
      url,
      title: title === '' ? url : title,
      content: description,
      source: outlet,
    };
    if (domain !== null) item.publisherDomain = domain;
    if (published !== undefined) item.published_date = published;
    items.push(item);
  }

  return items;
}

/**
 * Fetch one URL as text, honouring a timeout.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>}
 */
async function fetchText(url, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`google news request timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate the provider-neutral domain scope into Google News operators.
 *
 * Mirrors lib/bing.js buildBingQuery: include_domains become `site:` (OR-ed
 * when there are several), exclude_domains become `-site:`. Google News
 * honours both (verified live: `site:bjnews.com.cn 脑机接口` returns only
 * 新京报 items, `-site:xueqiu.com` drops that outlet entirely), so the
 * operators are a real scope here, not just a hint — the caller's local
 * domain filter still applies on top.
 *
 * @param {string} query
 * @param {{ includeDomains?: string[], excludeDomains?: string[] }} [options]
 * @returns {string}
 */
export function buildGoogleNewsQuery(query, options = {}) {
  const parts = [];

  if (Array.isArray(options.includeDomains)) {
    const sites = options.includeDomains
      .map(d => String(d).trim())
      .filter(d => d !== '')
      .map(d => `site:${d}`);
    if (sites.length > 0) parts.push(`(${sites.join(' OR ')})`);
  }

  if (Array.isArray(options.excludeDomains)) {
    for (const domain of options.excludeDomains) {
      const trimmed = String(domain).trim();
      if (trimmed !== '') parts.push(`-site:${trimmed}`);
    }
  }

  return parts.length === 0 ? query : `${query} ${parts.join(' ')}`;
}

/**
 * Run a keyless Google News search and normalize the results.
 *
 * The return shape mirrors the Bing adapter so callers do not branch on the
 * provider: `{ ok: true, data: { query, provider, results, response_time } }`
 * or `{ ok: false, error }`.
 *
 * @param {string} query
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, includeDomains?: string[], excludeDomains?: string[] }} [options]
 * @returns {Promise<{ ok: true, data: { query: string, provider: 'gnews', results: Array<Object>, response_time: number } } | { ok: false, error: string }>}
 */
export async function googleNewsSearch(query, options = {}) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (text === '') return { ok: false, error: 'google news search requires a query string' };

  const started = Date.now();
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;
  const effectiveQuery = buildGoogleNewsQuery(text, {
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
  });

  try {
    const xml = await fetchText(buildGoogleNewsUrl(effectiveQuery), timeoutMs, fetchImpl);
    const results = parseGoogleNewsRss(xml);
    return {
      ok: true,
      data: {
        query: effectiveQuery,
        provider: 'gnews',
        results,
        response_time: Date.now() - started,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `google news search failed: ${message}` };
  }
}


