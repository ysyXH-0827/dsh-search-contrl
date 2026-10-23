/**
 * Turn user-supplied topics and creator links into concrete queries.
 *
 * The report used to be hard-wired to six technology sections. The settings
 * page lets a user define arbitrary topics and paste a creator profile link,
 * so the query builder has to understand two shapes it never had before:
 *
 *   topic   -> a keyword bag, optionally scoped to one or more sites
 *   blogger -> a profile URL on a platform, turned into `site:<domain> <name>`
 *
 * Nothing here performs network I/O; it is pure string work so it can be tested
 * without a key, a network, or a running Host.
 *
 * @module dsh-tech-daily-report/custom-search
 */
/**
 * Platforms whose creator pages we know how to turn into a site-scoped query.
 *
 * `profile` marks URL shapes that carry a stable handle; the handle is what
 * makes a creator search repeatable instead of depending on a display name the
 * user typed.
 */
const PLATFORMS = [
  { platform: 'bilibili', domain: 'bilibili.com', label: '哔哩哔哩', match: /(^|\.)bilibili\.com$/, profile: /\/(\d+)\/?$/ },
  { platform: 'weibo', domain: 'weibo.com', label: '微博', match: /(^|\.)weibo\.com$/, profile: /\/(?:u\/)?(\d+)\/?$/ },
  { platform: 'zhihu', domain: 'zhihu.com', label: '知乎', match: /(^|\.)zhihu\.com$/, profile: /\/people\/([^/?#]+)/ },
  { platform: 'x', domain: 'x.com', label: 'X', match: /(^|\.)x\.com$/, profile: /^\/([A-Za-z0-9_]+)\/?$/ },
  { platform: 'twitter', domain: 'x.com', label: 'X', match: /(^|\.)twitter\.com$/, profile: /^\/([A-Za-z0-9_]+)\/?$/ },
  { platform: 'youtube', domain: 'youtube.com', label: 'YouTube', match: /(^|\.)youtube\.com$/, profile: /\/@([^/?#]+)/ },
  { platform: 'douyin', domain: 'douyin.com', label: '抖音', match: /(^|\.)douyin\.com$/, profile: /\/user\/([^/?#]+)/ },
  { platform: 'kuaishou', domain: 'kuaishou.com', label: '快手', match: /(^|\.)kuaishou\.com$/, profile: /\/profile\/([^/?#]+)/ },
  { platform: 'xiaohongshu', domain: 'xiaohongshu.com', label: '小红书', match: /(^|\.)xiaohongshu\.com$/, profile: /\/user\/profile\/([^/?#]+)/ },
  { platform: 'github', domain: 'github.com', label: 'GitHub', match: /(^|\.)github\.com$/, profile: /^\/([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'medium', domain: 'medium.com', label: 'Medium', match: /(^|\.)medium\.com$/, profile: /^\/@([^/?#]+)/ },
  { platform: 'substack', domain: 'substack.com', label: 'Substack', match: /(^|\.)substack\.com$/, profile: /^\/([^/?#]+)/ },
  { platform: 'csdn', domain: 'csdn.net', label: 'CSDN', match: /(^|\.)csdn\.net$/, profile: null },
  { platform: 'juejin', domain: 'juejin.cn', label: '掘金', match: /(^|\.)juejin\.cn$/, profile: /\/user\/([^/?#]+)/ },
  { platform: 'sspai', domain: 'sspai.com', label: '少数派', match: /(^|\.)sspai\.com$/, profile: /\/u\/([^/?#]+)/ },
  { platform: 'wechat', domain: 'mp.weixin.qq.com', label: '微信公众号', match: /(^|\.)mp\.weixin\.qq\.com$/, profile: null },
];

/**
 * Parse a creator profile link into the pieces a query needs.
 *
 * @param {string} rawUrl
 * @returns {{ ok: true, url: string, host: string, domain: string, platform: string, platformLabel: string, handle: string } | { ok: false, error: string }}
 */
export function parseBloggerUrl(rawUrl) {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (url === '') return { ok: false, error: 'creator link is empty' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `creator link is not a valid URL: ${url}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'creator link must start with http:// or https://' };
  }
  const host = parsed.hostname.toLowerCase();
  const known = PLATFORMS.find(entry => entry.match.test(host));
  const pathname = parsed.pathname;
  const handleMatch = known?.profile ? pathname.match(known.profile) : null;
  return {
    ok: true,
    url,
    host,
    domain: known?.domain ?? host.replace(/^www\./, ''),
    platform: known?.platform ?? 'website',
    platformLabel: known?.label ?? host,
    handle: handleMatch?.[1] ?? '',
  };
}

/**
 * Build the queries that fetch one creator's recent output.
 *
 * Two queries at most: one scoped by handle (stable), one by display name
 * (catches platforms whose search index does not expose the handle). The
 * dedupe keeps a label that duplicates the handle from wasting a request.
 *
 * @param {{ label?: string, url: string }} blogger
 * @param {{ keywords?: string[] }} [options]
 * @returns {{ ok: true, platform: string, domain: string, queries: Array<{ query: string, label: string }> } | { ok: false, error: string }}
 */
export function buildBloggerQueries(blogger, options = {}) {
  const parsed = parseBloggerUrl(blogger?.url ?? '');
  if (!parsed.ok) return parsed;
  const label = typeof blogger?.label === 'string' ? blogger.label.trim() : '';
  const extra = Array.isArray(options.keywords) ? options.keywords.map(String).filter(Boolean).slice(0, 4) : [];
  const scoped = (term) => `site:${parsed.domain} ${term}${extra.length > 0 ? ` ${extra.join(' ')}` : ''}`.trim();

  const terms = [];
  const seen = new Set();
  for (const term of [parsed.handle, label]) {
    const text = String(term ?? '').trim();
    if (text === '' || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    terms.push(text);
    if (terms.length >= 2) break;
  }
  if (terms.length === 0) return { ok: false, error: 'creator link needs a label or a handle in the URL' };

  return {
    ok: true,
    platform: parsed.platform,
    platformLabel: parsed.platformLabel,
    domain: parsed.domain,
    queries: terms.map((term, index) => ({
      query: scoped(term),
      label: index === 0 ? 'handle' : 'name',
    })),
  };
}

/**
 * Build the queries that fetch one user-defined topic.
 *
 * A topic without domains is one broad query; a topic with domains becomes one
 * site-scoped query per domain, because a single `(site:a OR site:b)` query is
 * not understood by every channel. The cap keeps one topic from turning into a
 * credit-burning burst.
 *
 * @param {{ label?: string, keywords?: string[], domains?: string[] }} topic
 * @param {{ keywords?: string[], maxQueries?: number }} [options]
 * @returns {{ ok: true, queries: Array<{ query: string, label: string }> } | { ok: false, error: string }}
 */
export function buildTopicQueries(topic, options = {}) {
  const base = Array.isArray(topic?.keywords) ? topic.keywords.map(String).map(text => text.trim()).filter(Boolean) : [];
  const extra = Array.isArray(options.keywords) ? options.keywords.map(String).map(text => text.trim()).filter(Boolean) : [];
  const terms = [...new Set([...base, ...extra])];
  if (terms.length === 0) return { ok: false, error: 'topic needs at least one keyword' };
  const maxQueries = Number.isInteger(options.maxQueries) && options.maxQueries > 0 ? Math.min(options.maxQueries, 8) : 4;
  const domains = Array.isArray(topic?.domains)
    ? [...new Set(topic.domains.map(String).map(domain => domain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')).filter(Boolean))]
    : [];
  const keywordText = terms.join(' ');

  if (domains.length === 0) {
    return { ok: true, queries: [{ query: keywordText, label: 'topic' }] };
  }
  return {
    ok: true,
    queries: domains.slice(0, maxQueries).map(domain => ({ query: `site:${domain} ${keywordText}`.trim(), label: domain })),
  };
}

/**
 * Resolve a source entry into the channel a query should use.
 *
 * A `site` source is not a channel of its own: it is a domain restriction on
 * top of whichever channel the caller already uses, so the effective provider
 * stays `auto`/`bing`/`tavily` and the domain becomes `include_domains`.
 *
 * @param {{ type?: string, domain?: string }} source
 * @returns {{ provider?: 'auto' | 'bing' | 'tavily', includeDomains?: string[] }}
 */
export function sourceChannel(source) {
  const type = source?.type;
  if (type === 'bing' || type === 'tavily') return { provider: type };
  const domain = typeof source?.domain === 'string' ? source.domain.trim() : '';
  if (type === 'site' && domain !== '') return { includeDomains: [domain] };
  return {};
}

/**
 * The enabled custom sources, in declaration order.
 *
 * @param {{ searchSources?: Array<Object> }} settings
 * @returns {Array<Object>}
 */
export function enabledSources(settings) {
  return (Array.isArray(settings?.searchSources) ? settings.searchSources : []).filter(source => source.enabled !== false);
}

/**
 * The enabled topics, in declaration order.
 *
 * @param {{ topics?: Array<Object> }} settings
 * @returns {Array<Object>}
 */
export function enabledTopics(settings) {
  return (Array.isArray(settings?.topics) ? settings.topics : []).filter(topic => topic.enabled !== false);
}

/**
 * The enabled creator links, in declaration order.
 *
 * @param {{ bloggers?: Array<Object> }} settings
 * @returns {Array<Object>}
 */
export function enabledBloggers(settings) {
  return (Array.isArray(settings?.bloggers) ? settings.bloggers : []).filter(blogger => blogger.enabled !== false);
}
