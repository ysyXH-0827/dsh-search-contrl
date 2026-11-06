#!/usr/bin/env node
/**
 * Offline checks for lib/google-news.js: the free discovery channel.
 *
 * Pure helpers plus stubbed fetch — no network, no Google. Pins the
 * contract daily-collect and the topic action rely on: the RSS URL shape,
 * the parse (including the <source> outlet name, the publisher domain it
 * maps to, and dropped link-less items), the outlet table, and the failure
 * shapes callers fall back on.
 */
import assert from 'node:assert/strict';
import {
  buildGoogleNewsQuery,
  buildGoogleNewsUrl,
  googleNewsSearch,
  outletDomain,
  parseGoogleNewsRss,
} from '../lib/google-news.js';
import { discoverDomains } from '../lib/dynamic-sources.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok   ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.log('FAIL ' + name + ': ' + (error && error.message));
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('ok   ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.log('FAIL ' + name + ': ' + (error && error.message));
  }
}

const SAMPLE_XML = '<rss version="2.0"><channel><title>test</title>'
  + '<item><title><![CDATA[“北脑一号”已完成10例人体植入]]></title>'
  + '<link>https://news.google.com/rss/articles/CBMiXWh0dHBzOi8vd3d3LmJqbmV3cy5jb20uY24vZGV0YWlsLzE</link>'
  + '<description><![CDATA[中国脑机接口迈向<b>临床应用</b>]]></description>'
  + '<pubDate>Fri, 06 Nov 2026 22:38:00 GMT</pubDate>'
  + '<source url="https://www.bjnews.com.cn">新京报</source></item>'
  + '<item><title>无来源条目</title>'
  + '<link>https://news.google.com/rss/articles/CBMiYWh0dHBzOi8vd3d3LmNjdHYuY29tL3g</link>'
  + '<description>央视网消息</description>'
  + '<pubDate>Sat, 07 Nov 2026 01:00:00 GMT</pubDate></item>'
  + '<item><title>无链接条目</title><description>x</description></item>'
  + '</channel></rss>';

check('the RSS url carries the query and the Chinese locale', () => {
  const url = buildGoogleNewsUrl('脑机接口 最新');
  assert.ok(url.startsWith('https://news.google.com/rss/search?'));
  // URLSearchParams form-encodes spaces as '+', so assert on the parsed
  // value rather than the raw encoding.
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('q'), '脑机接口 最新');
  assert.equal(parsed.searchParams.get('hl'), 'zh-CN');
  assert.equal(parsed.searchParams.get('gl'), 'CN');
  assert.equal(parsed.searchParams.get('ceid'), 'CN:zh-Hans');
  assert.equal(buildGoogleNewsUrl('  固态电池  '), buildGoogleNewsUrl('固态电池'));
  assert.equal(
    new URL(buildGoogleNewsUrl('脑机接口 after:2026-11-05 before:2026-11-08')).searchParams.get('q'),
    '脑机接口 after:2026-11-05 before:2026-11-08',
  );
});

check('buildGoogleNewsQuery translates domain scope into site: operators', () => {
  assert.equal(buildGoogleNewsQuery('脑机接口', { includeDomains: ['bjnews.com.cn'] }), '脑机接口 (site:bjnews.com.cn)');
  assert.equal(
    buildGoogleNewsQuery('脑机接口', { includeDomains: ['bjnews.com.cn', 'cls.cn'] }),
    '脑机接口 (site:bjnews.com.cn OR site:cls.cn)',
  );
  assert.equal(buildGoogleNewsQuery('脑机接口', { excludeDomains: ['xueqiu.com'] }), '脑机接口 -site:xueqiu.com');
  assert.equal(
    buildGoogleNewsQuery('脑机接口', { includeDomains: ['bjnews.com.cn'], excludeDomains: ['xueqiu.com'] }),
    '脑机接口 (site:bjnews.com.cn) -site:xueqiu.com',
  );
  assert.equal(buildGoogleNewsQuery('脑机接口', {}), '脑机接口');
  assert.equal(buildGoogleNewsQuery('脑机接口', { includeDomains: ['  ', ''] }), '脑机接口');
});

check('parse attaches the publisher domain for mapped outlets only', () => {
  const items = parseGoogleNewsRss(SAMPLE_XML);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '“北脑一号”已完成10例人体植入');
  assert.equal(items[0].source, '新京报');
  assert.equal(items[0].publisherDomain, 'bjnews.com.cn');
  assert.ok(items[0].content.includes('临床应用'));
  assert.ok(!items[0].content.includes('<b>'));
  assert.equal(items[0].published_date, '2026-11-06T22:38:00.000Z');
  assert.equal(items[1].source, '');
  assert.equal(items[1].publisherDomain, undefined);
  assert.ok(!('publisherDomain' in items[1]));
  assert.equal(items[1].published_date, '2026-11-07T01:00:00.000Z');
  assert.deepEqual(parseGoogleNewsRss(''), []);
  assert.deepEqual(parseGoogleNewsRss(null), []);
});

check('outletDomain maps known outlets and nothing else', () => {
  assert.equal(outletDomain('新京报'), 'bjnews.com.cn');
  assert.equal(outletDomain('财联社'), 'cls.cn');
  assert.equal(outletDomain('财联社电报'), 'cls.cn');
  assert.equal(outletDomain('央视网'), 'cctv.com');
  assert.equal(outletDomain('21财经'), '21jingji.com');
  assert.equal(outletDomain('不存在的媒体'), null);
  assert.equal(outletDomain(''), null);
  assert.equal(outletDomain(null), null);
  assert.equal(outletDomain(undefined), null);
});

function stubFetch(handler) {
  return async (url, options) => handler(String(url), options ?? {});
}

const okResponse = (text, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => text,
  headers: { get: () => null },
});

await checkAsync('googleNewsSearch returns gnews-shaped results on success', async () => {
  const fetchImpl = stubFetch(async url => {
    assert.ok(url.includes('news.google.com/rss/search'));
    return okResponse(SAMPLE_XML);
  });
  const result = await googleNewsSearch('脑机接口 最新', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.data.provider, 'gnews');
  assert.equal(result.data.query, '脑机接口 最新');
  assert.equal(result.data.results.length, 2);
  assert.equal(typeof result.data.response_time, 'number');
});

await checkAsync('googleNewsSearch folds include/exclude domains into the request', async () => {
  let seen = '';
  const fetchImpl = stubFetch(async url => {
    seen = url;
    return okResponse(SAMPLE_XML);
  });
  const result = await googleNewsSearch('脑机接口 最新', {
    fetchImpl,
    includeDomains: ['bjnews.com.cn'],
    excludeDomains: ['xueqiu.com'],
  });
  assert.equal(result.ok, true);
  const effective = new URL(seen).searchParams.get('q');
  assert.equal(effective, '脑机接口 最新 (site:bjnews.com.cn) -site:xueqiu.com');
  assert.equal(result.data.query, effective);
});

await checkAsync('googleNewsSearch fails honestly on an empty query and an HTTP error', async () => {
  assert.equal((await googleNewsSearch('')).ok, false);
  assert.equal((await googleNewsSearch('   ')).ok, false);
  const failing = stubFetch(async () => okResponse('nope', 500));
  const result = await googleNewsSearch('脑机接口', { fetchImpl: failing });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('HTTP 500'));
  const throwing = stubFetch(async () => { throw new Error('boom'); });
  assert.equal((await googleNewsSearch('脑机接口', { fetchImpl: throwing })).ok, false);
});

check('an unresolved Google News link never becomes a discovered domain', () => {
  const results = [
    { url: 'https://news.google.com/rss/articles/CBMiX' },
    { url: 'https://www.bjnews.com.cn/detail/1.html' },
    { url: 'https://www.bjnews.com.cn/detail/2.html' },
  ];
  assert.deepEqual(discoverDomains(results), [{ domain: 'bjnews.com.cn', count: 2 }]);
});

check('discoverDomains counts a mapped outlet under its publisher domain', () => {
  const results = [
    { url: 'https://news.google.com/rss/articles/A', publisherDomain: 'bjnews.com.cn' },
    { url: 'https://news.google.com/rss/articles/B', publisherDomain: 'bjnews.com.cn' },
    { url: 'https://news.google.com/rss/articles/C', publisherDomain: 'cls.cn' },
    { url: 'https://news.google.com/rss/articles/D' },
    { url: 'https://www.ithome.com/1.htm' },
  ];
  assert.deepEqual(discoverDomains(results), [
    { domain: 'bjnews.com.cn', count: 2 },
    { domain: 'cls.cn', count: 1 },
    { domain: 'ithome.com', count: 1 },
  ]);
});

console.log('');
if (failures.length > 0) {
  console.log(failures.length + ' failed, ' + passed + ' passed');
  for (const item of failures) console.log('  ' + item.name + '\n    ' + (item.error && item.error.stack));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
