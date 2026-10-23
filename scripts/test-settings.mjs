/**
 * Unit tests for the settings store, the query builder and the HTTP bridge.
 *
 * Run with: node scripts/test-settings.mjs
 *
 * These cover the parts that can be proven without a Host: the trust boundary
 * (what a save is allowed to store), the rollback trail (every write snapshots
 * the version it replaces), the query shapes (topic and creator links), and the
 * bridge guard (localhost only, POST only). The GUI itself is exercised by
 * scripts/test-client.mjs, not here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  countSettings,
  emptySettings,
  listHistory,
  normalizeSettings,
  readSettings,
  restoreSettings,
  saveSettings,
} from '../lib/settings-store.js';
import { buildBloggerQueries, buildTopicQueries, demoteSiteOperator, filterResultsByDomain, parseBloggerUrl, preferDeepLinks, sourceChannel } from '../lib/custom-search.js';
import { buildSettingsRoutes, isBridgeRequestAllowed } from '../lib/settings-api.js';

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-settings-'));
}

const sample = {
  searchSources: [
    { label: '官方博客', type: 'site', domain: 'https://openai.com/blog/x' },
    { label: '快通道', type: 'bing', enabled: false },
    { label: '', type: 'bing' },
    { label: '无域名站点', type: 'site' },
  ],
  topics: [
    { label: '半导体设备', keywords: ['光刻机', '刻蚀机'], domains: ['https://www.sec.gov/', 'nimble'] },
    { label: '空主题', keywords: [] },
    { label: '重复一', keywords: ['A'] },
    { label: '重复一', keywords: ['B'] },
  ],
  bloggers: [
    { label: '老石谈芯', url: 'https://space.bilibili.com/123456' },
    { label: '空链接', url: '' },
  ],
};

test('normalize drops empty entries and bounds fields', () => {
  const value = normalizeSettings(sample);
  assert.equal(value.searchSources.length, 2, 'label-less and domain-less site entries are dropped');
  assert.equal(value.searchSources[0].domain, 'openai.com', 'the path is stripped from a pasted domain');
  assert.equal(value.searchSources[1].enabled, false, 'an explicit disabled flag survives');
  assert.equal(value.topics.length, 3, 'a keyword-less topic is dropped');
  assert.deepEqual(value.topics[0].domains, ['www.sec.gov', 'nimble'], 'domains are normalised to host names');
  assert.equal(value.topics[1].id !== value.topics[2].id, true, 'duplicate labels never share an id');
  assert.equal(value.bloggers.length, 1, 'a creator without a link is dropped');
});

test('normalize is idempotent', () => {
  const once = normalizeSettings(sample);
  const twice = normalizeSettings(once);
  assert.deepEqual(twice, once, 'saving a saved document must not change it');
});

test('normalize rejects a non-object payload', () => {
  assert.deepEqual(normalizeSettings(null), emptySettings());
  assert.deepEqual(normalizeSettings('nonsense'), emptySettings());
});

test('save snapshots the version it replaces', () => {
  const dir = tempDir();
  const first = saveSettings(dir, { topics: [{ label: '主题一', keywords: ['a'] }] });
  assert.equal(first.snapshot, null, 'the first save has no previous version to snapshot');
  const second = saveSettings(dir, { topics: [{ label: '主题二', keywords: ['b'] }] });
  assert.ok(second.snapshot !== null, 'the second save snapshots the first version');
  const history = listHistory(dir);
  assert.equal(history.length, 1);
  assert.equal(history[0].counts.topics, 1, 'the snapshot holds the replaced document');
});

test('restore brings the old document back and is itself undoable', () => {
  const dir = tempDir();
  saveSettings(dir, { topics: [{ label: 'v1', keywords: ['one'] }] });
  saveSettings(dir, { topics: [{ label: 'v2', keywords: ['two'] }] });
  const target = listHistory(dir)[0].id;
  const restored = restoreSettings(dir, target);
  assert.equal(restored.ok, true);
  assert.equal(readSettings(dir).value.topics[0].label, 'v1', 'the current document is the restored one');
  const undo = listHistory(dir);
  assert.ok(undo.length >= 2, 'the restore snapshotted v2, so the rollback is reversible');
  const ids = undo.map(entry => entry.id);
  assert.ok(ids.includes(target), 'the restored snapshot is still listed');
});

test('restore rejects path traversal and unknown ids', () => {
  const dir = tempDir();
  saveSettings(dir, { topics: [] });
  assert.equal(restoreSettings(dir, '../../etc/passwd').ok, false);
  assert.equal(restoreSettings(dir, 'no-such.json').ok, false);
  assert.equal(restoreSettings(dir, '').ok, false);
});

test('history is capped by the limit option', () => {
  const dir = tempDir();
  // Pin the clock. Seven back-to-back saves can otherwise share a millisecond,
  // which used to collapse two snapshots into one and make this assertion flaky.
  for (let i = 0; i < 7; i += 1) {
    saveSettings(dir, { topics: [{ label: `t${i}`, keywords: ['k'] }] }, { limit: 3, now: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)) });
  }
  assert.equal(listHistory(dir).length, 3, 'the oldest snapshots beyond the limit are deleted');
});

test('two saves in the same millisecond keep separate snapshots', () => {
  const dir = tempDir();
  const now = new Date('2026-10-23T12:00:00.000Z');
  saveSettings(dir, { topics: [{ label: 'v1', keywords: ['one'] }] }, { now });
  saveSettings(dir, { topics: [{ label: 'v2', keywords: ['two'] }] }, { now });
  saveSettings(dir, { topics: [{ label: 'v3', keywords: ['three'] }] }, { now });
  const history = listHistory(dir);
  // Three saves leave two snapshots: the very first write has nothing to replace.
  assert.equal(history.length, 2, 'a collision must not overwrite a rollback point');
  assert.equal(new Set(history.map((entry) => entry.id)).size, 2, 'the ids stay distinct');
  assert.deepEqual(
    history.map((entry) => entry.counts.topics),
    [1, 1],
    'each snapshot still holds the document it replaced'
  );
});

test('same-millisecond snapshots list the newest first', () => {
  const dir = tempDir();
  const now = new Date('2026-10-23T12:00:00.000Z');
  saveSettings(dir, { topics: [{ label: 'a', keywords: ['k'] }] }, { now });
  saveSettings(dir, { topics: [{ label: 'b', keywords: ['k'] }] }, { now, reason: 'second' });
  const [newest] = listHistory(dir);
  assert.equal(newest.reason, 'second', 'the later write is the one the UI offers first');
});

test('counts summarise the document', () => {
  const counts = countSettings(normalizeSettings(sample));
  assert.deepEqual(counts, { sources: 2, topics: 3, bloggers: 1, total: 6 });
});

test('a corrupted store falls back to empty instead of throwing', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
  const current = readSettings(dir);
  assert.deepEqual(current.value, emptySettings());
  assert.equal(current.error !== undefined, true, 'the corruption is reported, not silently swallowed');
});

test('creator links parse into a platform and a site scoped query', () => {
  const bilibili = parseBloggerUrl('https://space.bilibili.com/123456');
  assert.equal(bilibili.ok, true);
  assert.equal(bilibili.platform, 'bilibili');
  assert.equal(bilibili.domain, 'bilibili.com');
  const x = buildBloggerQueries({ label: 'Some Dev', url: 'https://x.com/somedev' });
  assert.equal(x.ok, true);
  assert.deepEqual(x.queries.map(item => item.query), ['site:x.com Some Dev', 'site:x.com somedev']);
  const wechat = buildBloggerQueries({ label: '某个公众号', url: 'https://mp.weixin.qq.com/s/abcdef' });
  assert.deepEqual(wechat.queries.map(item => item.query), ['site:mp.weixin.qq.com 某个公众号']);
});

test('creator queries reject junk links', () => {
  assert.equal(buildBloggerQueries({ url: 'not a url' }).ok, false);
  assert.equal(buildBloggerQueries({ url: 'ftp://example.com/x' }).ok, false);
  assert.equal(buildBloggerQueries({}).ok, false);
});

test('topic queries become one query, or one per domain', () => {
  const plain = buildTopicQueries({ keywords: ['固态电池', '量产'] });
  assert.deepEqual(plain.queries.map(item => item.query), ['固态电池 量产']);
  const scoped = buildTopicQueries({ keywords: ['芯片'], domains: ['reuters.com', 'bloomberg.com'] });
  assert.deepEqual(scoped.queries.map(item => item.query), ['site:reuters.com 芯片', 'site:bloomberg.com 芯片']);
  assert.equal(buildTopicQueries({ keywords: [] }).ok, false);
});

test('a site source turns into a domain restriction, not a channel', () => {
  assert.deepEqual(sourceChannel({ type: 'site', domain: 'openai.com' }), { includeDomains: ['openai.com'] });
  assert.deepEqual(sourceChannel({ type: 'bing' }), { provider: 'bing' });
  assert.deepEqual(sourceChannel({ type: 'site', domain: '' }), {});
});

test('the bridge accepts loopback same-origin requests only', () => {
  const request = (overrides = {}) => ({
    method: 'POST',
    headers: { host: '127.0.0.1:49381', ...overrides.headers },
    socket: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1', localAddress: '127.0.0.1' },
  });
  assert.equal(isBridgeRequestAllowed(request()), true);
  assert.equal(isBridgeRequestAllowed(request({ headers: { origin: 'http://127.0.0.1:49381' } })), true);
  assert.equal(isBridgeRequestAllowed(request({ headers: { origin: 'http://evil.example' } })), false);
  assert.equal(isBridgeRequestAllowed(request({ headers: { 'sec-fetch-site': 'cross-site' } })), false);
  assert.equal(isBridgeRequestAllowed(request({ remoteAddress: '10.0.0.5' })), false);
  assert.equal(isBridgeRequestAllowed({ headers: {}, socket: {} }), false);
});

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) { this.body = chunk ?? ''; },
  };
}

function fakeRequest(body, overrides = {}) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    method: overrides.method ?? 'POST',
    headers: { host: '127.0.0.1:49381', 'content-type': 'application/json', ...(overrides.headers ?? {}) },
    socket: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield* chunks; },
  };
}

await test('the bridge routes save, describe and roll back', async () => {
  const dir = tempDir();
  const routes = buildSettingsRoutes({ dataDir: dir, pluginVersion: 'test', historyLimit: 10 });
  const byPath = suffix => routes.find(route => route.path.endsWith(suffix));

  const describe = byPath('describe');
  const firstResponse = fakeResponse();
  await describe.handler(fakeRequest({}), firstResponse);
  const first = JSON.parse(firstResponse.body);
  assert.equal(first.ok, true);
  assert.equal(first.value.counts.total, 0);

  const save = byPath('save');
  const seedResponse = fakeResponse();
  await save.handler(fakeRequest({ settings: { topics: [] } }), seedResponse);
  const saveResponse = fakeResponse();
  await save.handler(fakeRequest({ settings: { topics: [{ label: '二次元', keywords: ['番剧'] }] } }), saveResponse);
  const saved = JSON.parse(saveResponse.body);
  assert.equal(saved.ok, true);
  assert.equal(saved.value.counts.topics, 1);

  const history = byPath('history');
  const historyResponse = fakeResponse();
  await history.handler(fakeRequest({}), historyResponse);
  assert.equal(JSON.parse(historyResponse.body).value.history.length, 1);

  const snapshotId = JSON.parse(historyResponse.body).value.history[0].id;
  const rollback = byPath('rollback');
  const rollbackResponse = fakeResponse();
  await rollback.handler(fakeRequest({ id: snapshotId }), rollbackResponse);
  const rolled = JSON.parse(rollbackResponse.body);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.value.counts.topics, 0, 'the snapshot before the save had no topics');

  const forbidden = fakeResponse();
  await save.handler(fakeRequest({ settings: {} }, { headers: { origin: 'http://evil.example' } }), forbidden);
  assert.equal(forbidden.statusCode, 403);

  const wrongMethod = fakeResponse();
  await save.handler(fakeRequest({}, { method: 'GET' }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});


await test('heredoc topic keeps its domains so callers can filter results', async () => {
  const built = buildTopicQueries({ keywords: ['solid state battery'], domains: ['reuters.com'] });
  assert.deepEqual(built.domains, ['reuters.com']);
});

await test('site: is demoted to a plain keyword for channels that ignore it', async () => {
  assert.equal(demoteSiteOperator('site:bilibili.com 影视飓风'), 'bilibili.com 影视飓风');
  assert.equal(demoteSiteOperator('plain query'), 'plain query');
});

await test('domain filter keeps the domain and its subdomains only', async () => {
  const kept = filterResultsByDomain(
    [
      { url: 'https://reuters.com/a' },
      { url: 'https://www.reuters.com/b' },
      { url: 'https://m.ithome.com/c' },
      { url: 'not a url' },
      {},
    ],
    ['reuters.com']
  );
  assert.equal(kept.length, 2);
  assert.equal(filterResultsByDomain([{ url: 'https://x.com/1' }], []).length, 1, 'no domains means no filtering');
});


await test('a creator name is queried before its numeric handle', async () => {
  const built = buildBloggerQueries({ url: 'https://space.bilibili.com/946974', label: '影视飓风' });
  assert.equal(built.queries[0].label, 'name');
  assert.ok(built.queries[0].query.includes('影视飓风'));
});

await test('bare homepages give way to real content pages', async () => {
  const kept = preferDeepLinks([
    { url: 'https://www.bilibili.com/' },
    { url: 'https://space.bilibili.com/946974' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].url, 'https://space.bilibili.com/946974');
  const onlyHome = preferDeepLinks([{ url: 'https://www.bilibili.com/' }]);
  assert.equal(onlyHome.length, 1, 'a homepage-only answer is still returned');
});

const failed = failures.length;
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
