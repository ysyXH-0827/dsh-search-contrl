/**
* Dynamic search sources: decide sources from what the user asked, not from
* a preset table alone.
*
* Old flow (3.0): topic -> presetForTopic() -> preset.feeds /.domains /
*.queries. If no preset matched, the caller got no feeds and one broad
* query built from the topic keywords. That is honest, but it wastes the
* one thing the user actually gave us: the question itself.
*
* New flow:
* 1. Parse the user's question into core keywords (strip report words,
* dates and politeness, keep the subject).
* 2. If a preset matches, use it — it is a shortcut, not a requirement.
* 3. If no preset matches, build discovery queries from the keywords
* ("<keywords> 最新", "<keywords> 发布 公告", "<keywords> 官网"),
* run them once, then count which domains actually answer.
* 4. The top domains become the sources for the second, site-scoped
* round. No domain is invented: a source only enters the plan after
* it returned a result for this question.
*
* Everything here is pure string work with no I/O, so it can be tested
* offline. The network stages live in lib/search-tool.js (`topic` action)
* and scripts/daily-collect.mjs, which call these helpers.
*
* @module dsh-search-contrl/dynamic-sources
*/

/** Words that describe the report, not the subject. Stripped before parsing. */
const REPORT_WORDS = [
'日报', '周报', '月报', '报告', '发一份', '发一下', '来一份', '发日报',
'帮我', '请', '给我', '整理', '汇总', '看看', '查一下', '搜索', '检索',
'今天', '昨日', '昨天', '明天', '本周', '本月', '这周', '这月',
'动态', '新闻', '资讯', '发生了什么', '有什么', '怎么样', '如何',
'最近', '过去', '未来', '一下', '一个', '一份', '最新', '进展',
];

const DATE_WINDOW = /最近\s*\d+\s*天|过去\s*\d+\s*天|\d+\s*天内|\d+天/g;

/** Hosts that are search engines / aggregators, never a source by themselves. */
const EXCLUDED_HOSTS = new Set([
'bing.com', 'www.bing.com', 'baidu.com', 'www.baidu.com',
'google.com', 'www.google.com', 'news.google.com', 'sogou.com', 'so.com',
'duckduckgo.com', 'yandex.com', 'wikipedia.org',
]);

/** Encyclopedia / dictionary hosts: they answer every query, but they are
 * reference pages, not news sources. Never let them become a source. */
const EXCLUDED_DISCOVERY_SUFFIXES = [
'wikipedia.org', 'baike.baidu.com', 'baike.sogou.com', 'zdic.net',
'wikiwand.com', 'hanyu.com',
];

/**
* Parse a user's question into the subject it is actually about.
*
* @param {string} question
* @returns {{ topic: string, keywords: string[]}}
*/
export function parseUserQuestion(question) {
let text = typeof question === 'string'? question.trim(): '';
if (text === '') return { topic: '', keywords: []};
text = text.replace(DATE_WINDOW, ' ');
for (const word of REPORT_WORDS) {
text = text.split(word).join(' ');
}
const tokens = text
.split(/[\s,，、；;：:。！!？?「」『』（）()\[\]《》的/]+/u)
.map(token => token.trim())
.filter(token => token.length >= 2)
.filter(token =>!REPORT_WORDS.includes(token));
const keywords = [...new Set(tokens)].slice(0, 4);
return { topic: keywords.join(' '), keywords};
}

/**
* Discovery queries for a parsed question: one broad, one for
* announcements, one for official sources. Capped at 3 on purpose —
* discovery is a probe, not the collection itself.
*
* @param {{ topic: string, keywords: string[]}} parsed
* @param {number} [maxQueries]
* @returns {string[]}
*/
export function buildDiscoveryQueries(parsed, maxQueries = 3) {
const base = Array.isArray(parsed?.keywords) && parsed.keywords.length > 0
? parsed.keywords.join(' ')
: String(parsed?.topic?? '').trim();
if (base === '') return [];
const queries = [
`${base} 最新`,
`${base} 发布 公告`,
`${base} 官网`,
];
return queries.slice(0, Math.max(1, Math.min(3, Number(maxQueries) || 3)));
}

/**
* Count which domains actually answered a set of results.
* Search-engine / aggregator hosts are never sources.
*
* @param {Array<{ url?: string}>} results
* @param {number} [maxDomains]
* @returns {Array<{ domain: string, count: number}>}
*/
export function discoverDomains(results, maxDomains = 4) {
const counts = new Map();
for (const item of Array.isArray(results)? results: []) {
// Google News results carry the publisher domain from their outlet name
// (publisherDomain): their URL is a news.google.com redirect that never
// reveals the publisher host. Any other result is counted by its URL host.
const named = typeof item?.publisherDomain === 'string' ? item.publisherDomain.trim().toLowerCase().replace(/^www\./, '') : '';
if (named !== '') {
if (!EXCLUDED_HOSTS.has(named) && !EXCLUDED_DISCOVERY_SUFFIXES.some(suffix => named === suffix || named.endsWith('.' + suffix))) {
counts.set(named, (counts.get(named)?? 0) + 1);
}
continue;
}
if (typeof item?.url!== 'string') continue;
let host;
try {
host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '');
} catch {
continue;
}
if (host === '' || EXCLUDED_HOSTS.has(host)) continue;
if (EXCLUDED_DISCOVERY_SUFFIXES.some(suffix => host === suffix || host.endsWith('.' + suffix))) continue;
counts.set(host, (counts.get(host)?? 0) + 1);
}
return [...counts.entries()]
.map(([domain, count]) => ({ domain, count}))
.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
.slice(0, Math.max(1, Math.min(8, Number(maxDomains) || 4)));
}

/**
* Second-round queries, scoped to the domains discovery actually found.
* With no domains, fall back to the discovery queries themselves.
*
* @param {{ topic: string, keywords: string[]}} parsed
* @param {Array<{ domain: string} | string>} domains
* @param {number} [maxQueries]
* @returns {string[]}
*/
export function buildDynamicQueries(parsed, domains, maxQueries = 4) {
const base = Array.isArray(parsed?.keywords) && parsed.keywords.length > 0
? parsed.keywords.join(' ')
: String(parsed?.topic?? '').trim();
if (base === '') return [];
const list = (Array.isArray(domains)? domains: [])
.map(entry => typeof entry === 'string'? entry: entry?.domain)
.map(domain => String(domain?? '').trim().toLowerCase().replace(/^www\./, ''))
.filter(Boolean);
if (list.length === 0) return buildDiscoveryQueries(parsed, maxQueries);
return list.slice(0, Math.max(1, Math.min(8, Number(maxQueries) || 4)))
.map(domain => `site:${domain} ${base}`.trim());
}

/**
* Resolve the source plan for one request.
* Preset is a shortcut; a question with no preset is not an error,
* it is the dynamic path.
*
* @param {{ question?: string, topic?: { label?: string, keywords?: string[], domains?: string[]}, preset?: { id?: string, label?: string, queries?: string[], domains?: string[], feeds?: Array<Object>} | null}} input
* @returns {{ mode: 'preset' | 'dynamic' | 'none', presetId: string | null, topic: string, keywords: string[], queries: string[], domains: string[], feeds: Array<Object>, reason: string}}
*/
export function resolveSources(input = {}) {
const preset = input?.preset?? null;
if (preset) {
return {
mode: 'preset',
presetId: typeof preset.id === 'string'? preset.id: null,
topic: typeof preset.label === 'string'? preset.label: '',
keywords: Array.isArray(preset.keywords)? preset.keywords.slice(): [],
queries: Array.isArray(preset.queries)? preset.queries.slice(): [],
domains: Array.isArray(preset.domains)? preset.domains.slice(): [],
feeds: Array.isArray(preset.feeds)? preset.feeds.slice(): [],
reason: 'preset matched; use its feeds, domains and query seeds',
};
}
const fromTopic = typeof input?.topic?.label === 'string' && input.topic.label.trim()!== ''
? input.topic.label
: '';
const parsed = parseUserQuestion(input?.question?? fromTopic);
const keywords = parsed.keywords.length > 0
? parsed.keywords
: (Array.isArray(input?.topic?.keywords)? input.topic.keywords.map(String).map(s => s.trim()).filter(Boolean).slice(0, 4): []);
if (keywords.length === 0) {
return {
mode: 'none', presetId: null, topic: '', keywords: [],
queries: [], domains: [], feeds: [],
reason: 'no preset and no keywords in the question; ask the user for a topic first',
};
}
const withKeywords = { topic: keywords.join(' '), keywords};
return {
mode: 'dynamic',
presetId: null,
topic: withKeywords.topic,
keywords,
queries: buildDiscoveryQueries(withKeywords),
domains: Array.isArray(input?.topic?.domains)? input.topic.domains.slice(): [],
feeds: [],
reason: 'no preset matched; discover sources from the question first, then scope to the domains that answered',
};
}
