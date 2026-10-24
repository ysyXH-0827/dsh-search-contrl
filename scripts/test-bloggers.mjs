// Contract tests for the 'bloggers' batch action: it must read every saved
// creator in one call, in parallel, and never let one bad link sink the batch.
import assert from 'node:assert/strict';
import { buildSearchTool, BLOGGER_CONCURRENCY } from '../lib/search-tool.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('ok - ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL - ' + name);
    console.log('       ' + (error instanceof Error ? error.message : String(error)));
  }
}

function settingsApiFor(bloggers, cookies = {}) {
  return {
    read: () => ({ value: { version: 1, searchSources: [], topics: [], bloggers }, error: null }),
    cookieHeader: site => cookies[site] ?? '',
    history: () => [],
    restore: () => ({ ok: true }),
  };
}

function weiboPayload(count) {
  return JSON.stringify({
    data: {
      list: Array.from({ length: count }, (_, index) => ({
        mblogid: 'M' + index,
        created_at: 'Fri Oct 23 1' + index + ':06:00 +0800 2026',
        text: '<a href="/n/x">#爆料#</a> 第 ' + index + ' 条<br />正文',
        reposts_count: index,
        comments_count: index * 2,
        attitudes_count: index * 3,
        pics: [],
        user: { id: 6048569942, screen_name: '数码闲聊站' },
      })),
    },
  });
}

const tool = () => buildSearchTool(() => ({ searchProvider: 'bing', maxResults: 5 }), undefined);

await test('the action enum exposes bloggers and the concurrency knob', async () => {
  const t = tool();
  assert.ok(t.parameters.properties.action.enum.includes('bloggers'), 'bloggers must be a valid action');
  const knob = t.parameters.properties.concurrency;
  assert.equal(knob.type, 'integer');
  assert.equal(knob.minimum, 1);
  assert.equal(knob.maximum, 8);
  assert.ok(t.description.includes("'bloggers' action"), 'the tool must document the batch action');
  assert.ok(BLOGGER_CONCURRENCY >= 2 && BLOGGER_CONCURRENCY <= 8);
});

await test('bloggers reads every saved creator and keeps per-creator results', async () => {
  const originalFetch = globalThis.fetch;
  let inFlight = 0;
  let peak = 0;
  globalThis.fetch = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 20));
    inFlight -= 1;
    return { ok: true, status: 200, text: async () => weiboPayload(2) };
  };
  try {
    const t = buildSearchTool(
      () => ({ searchProvider: 'bing', maxResults: 5 }),
      settingsApiFor(
        [
          { id: 'a', label: '博主A', url: 'https://weibo.com/u/6048569942', enabled: true },
          { id: 'b', label: '博主B', url: 'https://weibo.com/u/6048569943', enabled: true },
        ],
        { weibo: 'XSRF-TOKEN=abc; SUB=xyz' }
      )
    );
    const result = await t.execute({ action: 'bloggers' }, { signal: undefined });
    assert.equal(result.ok, true);
    assert.equal(result.action, 'bloggers');
    assert.equal(result.count, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.concurrency, 2);
    assert.ok(Number.isInteger(result.elapsedMs));
    assert.equal(result.creators.length, 2);
    assert.equal(result.creators[0].posts.length, 2);
    assert.equal(result.creators[0].posts[0].text.includes('<a'), false, 'HTML must be stripped');
    assert.equal(result.creators[0].newest.id, 'M0');
    assert.ok(peak >= 2, 'creators must be read concurrently, peak in-flight was ' + peak);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('an unsupported profile link is reported, not thrown', async () => {
  const t = buildSearchTool(
    () => ({ searchProvider: 'bing', maxResults: 5 }),
    settingsApiFor([{ id: 'x', label: '知乎某人', url: 'https://www.zhihu.com/people/someone', enabled: true }])
  );
  const result = await t.execute({ action: 'bloggers' }, { signal: undefined });
  assert.equal(result.ok, true, 'the batch itself must still succeed');
  assert.equal(result.failed, 1);
  assert.match(result.creators[0].error, /action "blogger"/);
});

await test('no saved creators is an explicit error, not an empty success', async () => {
  const t = buildSearchTool(() => ({ searchProvider: 'bing', maxResults: 5 }), settingsApiFor([]));
  const result = await t.execute({ action: 'bloggers' }, { signal: undefined });
  assert.equal(result.ok, false);
  assert.match(result.error, /no saved creators/);
});

await test('the concurrency request is clamped to the creator count', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => weiboPayload(1) });
  try {
    const t = buildSearchTool(
      () => ({ searchProvider: 'bing', maxResults: 5 }),
      settingsApiFor([{ id: 'a', label: 'A', url: 'https://weibo.com/u/6048569942', enabled: true }], { weibo: 'SUB=1' })
    );
    const result = await t.execute({ action: 'bloggers', concurrency: 99 }, { signal: undefined });
    assert.equal(result.concurrency, 1, 'asking for 99 must not report 99');
    assert.equal(result.count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('a failing creator does not sink the others', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes('6048569943')) throw new Error('network exploded');
    return { ok: true, status: 200, text: async () => weiboPayload(1) };
  };
  try {
    const t = buildSearchTool(
      () => ({ searchProvider: 'bing', maxResults: 5 }),
      settingsApiFor(
        [
          { id: 'a', label: 'A', url: 'https://weibo.com/u/6048569942', enabled: true },
          { id: 'b', label: 'B', url: 'https://weibo.com/u/6048569943', enabled: true },
        ],
        { weibo: 'SUB=1' }
      )
    );
    const result = await t.execute({ action: 'bloggers' }, { signal: undefined });
    assert.equal(result.ok, true);
    assert.equal(result.failed, 1);
    assert.equal(result.creators.filter(item => item.ok).length, 1);
    assert.match(result.creators.find(item => !item.ok).error, /network exploded/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
