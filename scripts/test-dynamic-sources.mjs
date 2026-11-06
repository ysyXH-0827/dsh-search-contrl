#!/usr/bin/env node
/**
 * Offline checks for lib/dynamic-sources.js: the question-first source plan.
 *
 * Pure functions, no I/O, no network. Pins the contract the skill and the
 * collector rely on: a question with no preset still yields discovery
 * queries, and a domain only becomes a source after it returned a result.
 */
import assert from 'node:assert/strict';
import {
  buildDiscoveryQueries,
  buildDynamicQueries,
  discoverDomains,
  parseUserQuestion,
  resolveSources,
} from '../lib/dynamic-sources.js';
import { presetForTopic } from '../lib/topic-presets.js';

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

check('parse strips report words and keeps the subject', () => {
  assert.deepEqual(parseUserQuestion('发一份脑机接口日报'), { topic: '脑机接口', keywords: ['脑机接口'] });
  assert.deepEqual(parseUserQuestion('最近7天固态电池有什么动态'), { topic: '固态电池', keywords: ['固态电池'] });
  assert.deepEqual(parseUserQuestion(''), { topic: '', keywords: [] });
  assert.deepEqual(parseUserQuestion('发日报'), { topic: '', keywords: [] });
  const parsed = parseUserQuestion('帮我整理一下无人机物流的最新进展');
  assert.ok(parsed.keywords.includes('无人机物流'));
  assert.ok(!parsed.keywords.includes('日报'));
});

check('discovery queries are three intents, not one broad query', () => {
  const queries = buildDiscoveryQueries({ topic: '脑机接口', keywords: ['脑机接口'] });
  assert.equal(queries.length, 3);
  assert.equal(queries[0], '脑机接口 最新');
  assert.equal(queries[1], '脑机接口 发布 公告');
  assert.equal(queries[2], '脑机接口 官网');
  assert.deepEqual(buildDiscoveryQueries({ topic: '', keywords: [] }), []);
});

check('discoverDomains counts hosts and never returns a search engine', () => {
  const results = [
    { url: 'https://www.ithome.com/1/123.htm' },
    { url: 'https://ithome.com/1/124.htm' },
    { url: 'https://www.bing.com/search?q=x' },
    { url: 'https://www.baidu.com/s?wd=x' },
    { url: 'https://example.com/a' },
    { url: 'not a url' },
    {},
  ];
  assert.deepEqual(discoverDomains(results), [
    { domain: 'ithome.com', count: 2 },
    { domain: 'example.com', count: 1 },
  ]);
  assert.deepEqual(discoverDomains([]), []);
});

check('dynamic queries scope to discovered domains, or fall back to discovery', () => {
  const parsed = { topic: '脑机接口', keywords: ['脑机接口'] };
  assert.deepEqual(
    buildDynamicQueries(parsed, [{ domain: 'nature.com', count: 3 }, { domain: '36kr.com', count: 2 }]),
    ['site:nature.com 脑机接口', 'site:36kr.com 脑机接口'],
  );
  assert.deepEqual(buildDynamicQueries(parsed, []), buildDiscoveryQueries(parsed));
  assert.deepEqual(buildDynamicQueries({ topic: '', keywords: [] }, [{ domain: 'x.com' }]), []);
});

check('resolveSources keeps preset as a shortcut', () => {
  const preset = presetForTopic({ label: '科技' });
  const resolved = resolveSources({ question: 'AI日报', preset });
  assert.equal(resolved.mode, 'preset');
  assert.equal(resolved.presetId, 'tech');
  assert.ok(resolved.feeds.length > 0);
  assert.ok(resolved.queries.length > 0);
});

check('resolveSources goes dynamic when no preset matches', () => {
  const resolved = resolveSources({ question: '发一份脑机接口日报', topic: { label: '脑机接口', keywords: ['脑机接口'] }, preset: null });
  assert.equal(resolved.mode, 'dynamic');
  assert.equal(resolved.presetId, null);
  assert.deepEqual(resolved.feeds, []);
  assert.deepEqual(resolved.queries, ['脑机接口 最新', '脑机接口 发布 公告', '脑机接口 官网']);
  assert.equal(resolved.reason.includes('discover'), true);
});

check('resolveSources asks first when there is nothing to search for', () => {
  const resolved = resolveSources({ question: '发日报', preset: null });
  assert.equal(resolved.mode, 'none');
  assert.deepEqual(resolved.queries, []);
});

console.log('');
if (failures.length > 0) {
  console.log(failures.length + ' failed, ' + passed + ' passed');
  for (const item of failures) console.log('  ' + item.name + '\n    ' + (item.error && item.error.stack));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
