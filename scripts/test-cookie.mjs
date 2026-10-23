/**
 * Cookie capture tests. No browser is opened: the launcher, fetch, WebSocket and
 * clock are all stubs, so the whole CDP handshake runs in milliseconds.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COOKIE_SITES,
  clearCookies,
  cookieHeader,
  cookieSite,
  hasLoginCookies,
  maskJar,
  pruneCookies,
  readJar,
  saveSiteCookies,
} from '../lib/cookie-jar.js';
import { createCookieCapture, createDevToolsClient, findBrowser, pickPort } from '../lib/cookie-capture.js';
import { createBilibiliClient, keyFromUrl, mixinKey, signWbi } from '../lib/bilibili-api.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const now = Date.parse('2026-10-23T12:00:00Z');
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cookie-test-'));

const sessionCookie = (name, value = 'v', domain = '.bilibili.com') => ({
  name, value, domain, path: '/', expires: -1, httpOnly: true, secure: true,
});

//#region cookie jar
await test('prune keeps same-domain live cookies and drops foreign/expired ones', () => {
  const kept = pruneCookies([
    sessionCookie('SESSDATA'),
    sessionCookie('foreign', 'v', '.example.com'),
    { ...sessionCookie('old'), expires: Math.floor(now / 1000) - 60 },
  ], 'bilibili.com', now);
  assert.deepEqual(kept.map(cookie => cookie.name), ['SESSDATA']);
});

await test('hasLoginCookies requires every required name', () => {
  const bili = cookieSite('bilibili');
  assert.equal(hasLoginCookies(bili, [sessionCookie('SESSDATA')]), true);
  assert.equal(hasLoginCookies(bili, [sessionCookie('bili_jct')]), false);
});

await test('saveSiteCookies refuses an incomplete login', () => {
  const dir = tempDir();
  const saved = saveSiteCookies(dir, 'bilibili', [sessionCookie('SESSDATA')], { now });
  assert.equal(saved.ok, true);
  const incomplete = saveSiteCookies(dir, 'zhihu', [sessionCookie('nope', 'v', '.zhihu.com')], { now });
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /z_c0/);
});

await test('maskJar never exposes a cookie value', () => {
  const dir = tempDir();
  saveSiteCookies(dir, 'bilibili', [sessionCookie('SESSDATA', 'secret-value')], { now });
  const masked = maskJar(readJar(dir, { now }));
  const flat = JSON.stringify(masked);
  assert.equal(flat.includes('secret-value'), false);
  assert.equal(masked.sites[0].cookies[0].name, 'SESSDATA');
  assert.equal(masked.counts.loggedIn, 1);
});

await test('cookieHeader builds a request header only for stored sites', () => {
  const dir = tempDir();
  saveSiteCookies(dir, 'bilibili', [sessionCookie('SESSDATA', 'abc123')], { now });
  assert.equal(cookieHeader(dir, 'bilibili', { now }), 'SESSDATA=abc123');
  assert.equal(cookieHeader(dir, 'zhihu', { now }), '');
  assert.equal(cookieHeader(dir, 'unknown', { now }), '');
});

await test('clearCookies removes one site or all sites', () => {
  const dir = tempDir();
  saveSiteCookies(dir, 'bilibili', [sessionCookie('SESSDATA')], { now });
  saveSiteCookies(dir, 'zhihu', [sessionCookie('z_c0', 'v', '.zhihu.com')], { now });
  const one = clearCookies(dir, 'bilibili');
  assert.deepEqual(one.cleared, ['bilibili']);
  assert.equal(readJar(dir).sites.bilibili, undefined);
  assert.ok(readJar(dir).sites.zhihu, 'clearing one site must keep the others');
  const all = clearCookies(dir);
  assert.deepEqual(all.cleared, ['zhihu']);
  assert.equal(Object.keys(readJar(dir).sites).length, 0);
});

await test('a corrupt jar degrades to empty instead of throwing', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'cookies.json'), '{not json', 'utf8');
  const jar = readJar(dir);
  assert.deepEqual(jar.sites, {});
  assert.ok(jar.error);
});
//#endregion

//#region capture
function fakeBrowser({ cookies, loginAfter = 2, fail = null }) {
  const calls = { launch: 0, killed: 0, profileDirs: [], reads: 0 };
  const launch = async (browser, port, profileDir, url) => {
    calls.launch += 1;
    calls.browser = browser.name;
    calls.port = port;
    calls.url = url;
    calls.profileDirs.push(profileDir);
    return { kill: () => { calls.killed += 1; } };
  };
  const fetchImpl = async url => {
    if (url.includes('/json/version')) {
      return { ok: true, status: 200, json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/x' }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const devToolsClient = () => ({
    ready: Promise.resolve(),
    send: async () => {
      calls.reads += 1;
      if (fail) throw new Error(fail);
      return { cookies: calls.reads >= loginAfter ? cookies : [] };
    },
    close: () => {},
  });
  return { launch, fetchImpl, devToolsClient, calls };
}

await test('capture waits for the login cookie, stores it and closes the window', async () => {
  const dir = tempDir();
  const fake = fakeBrowser({ cookies: [sessionCookie('SESSDATA', 'x1'), sessionCookie('bili_jct', 'x2')], loginAfter: 2 });
  let clock = now;
  const capture = createCookieCapture({
    dataDir: dir,
    exists: () => true,
    launch: fake.launch,
    fetchImpl: fake.fetchImpl,
    devToolsClient: fake.devToolsClient,
    now: () => clock,
    sleepImpl: async () => { clock += 1500; },
    platform: 'win32',
  });
  const result = await capture.start('bilibili');
  assert.equal(result.ok, true);
  assert.equal(result.site, 'bilibili');
  assert.equal(fake.calls.launch, 1);
  assert.equal(fake.calls.killed, 1, 'the browser window must be closed');
  assert.equal(fake.calls.url, 'https://passport.bilibili.com/login');
  assert.equal(fs.existsSync(fake.calls.profileDirs[0]), false, 'the temp profile must be removed');
  assert.equal(cookieHeader(dir, 'bilibili'), 'SESSDATA=x1; bili_jct=x2');
  assert.equal(capture.status().state, 'done');
});

await test('capture reports timeout without storing anything', async () => {
  const dir = tempDir();
  const fake = fakeBrowser({ cookies: [], loginAfter: 99 });
  let clock = now;
  const capture = createCookieCapture({
    dataDir: dir, exists: () => true, launch: fake.launch, fetchImpl: fake.fetchImpl,
    devToolsClient: fake.devToolsClient, now: () => clock, sleepImpl: async () => { clock += 60_000; },
    platform: 'win32', timeoutMs: 120_000,
  });
  const result = await capture.start('bilibili');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'timeout');
  assert.equal(cookieHeader(dir, 'bilibili'), '');
  assert.equal(capture.status().state, 'error');
});

await test('capture refuses to run twice at once', async () => {
  const dir = tempDir();
  const fake = fakeBrowser({ cookies: [sessionCookie('SESSDATA')], loginAfter: 1 });
  const capture = createCookieCapture({
    dataDir: dir, exists: () => true, launch: fake.launch, fetchImpl: fake.fetchImpl,
    devToolsClient: fake.devToolsClient, now: () => now, sleepImpl: async () => {}, platform: 'win32',
  });
  const first = capture.start('bilibili');
  const second = await capture.start('zhihu');
  assert.equal(second.ok, false);
  assert.equal(second.code, 'busy');
  await first;
});

await test('capture without a browser explains what to install', async () => {
  const capture = createCookieCapture({ dataDir: tempDir(), exists: () => false, platform: 'win32' });
  const result = await capture.start('bilibili');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'no-browser');
  assert.match(result.message, /Chrome|Edge/);
});

await test('findBrowser picks a known path per platform', () => {
  const win = findBrowser({ platform: 'win32', exists: p => p.endsWith('msedge.exe') });
  assert.equal(win.name, 'Edge');
  const none = findBrowser({ platform: 'linux', exists: () => false });
  assert.equal(none, null);
});

await test('pickPort returns a usable port', async () => {
  const port = await pickPort();
  assert.ok(port > 0 && port < 65_536);
});

await test('devToolsClient correlates replies by id', async () => {
  const sent = [];
  class FakeSocket {
    constructor() {
      this.listeners = {};
      queueMicrotask(() => {
        for (const fn of this.listeners.open ?? []) fn();
      });
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    send(raw) {
      const message = JSON.parse(raw);
      sent.push(message.method);
      const reply = JSON.stringify({ id: message.id, result: { cookies: [{ name: 'SESSDATA' }] } });
      for (const fn of this.listeners.message ?? []) fn({ data: reply });
    }
    close() {}
  }
  const client = createDevToolsClient('ws://test', { WebSocketImpl: FakeSocket });
  await client.ready;
  const result = await client.send('Network.getAllCookies');
  assert.deepEqual(sent, ['Network.getAllCookies']);
  assert.equal(result.cookies[0].name, 'SESSDATA');
  client.close();
});

//#endregion

//#region bilibili
await test('mixinKey is 32 chars and depends on both keys', () => {
  const a = mixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45');
  const b = mixinKey('4932caff0ff746eab6f01bf08b70ac45', '7cd084941338484aae1ad9425b84077c');
  assert.equal(a.length, 32);
  assert.notEqual(a, b);
});

await test('keyFromUrl strips directories and extension', () => {
  assert.equal(keyFromUrl('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png'), '7cd084941338484aae1ad9425b84077c');
  assert.equal(keyFromUrl(''), '');
});

await test('signWbi sorts params, appends wts and a 32-hex w_rid', () => {
  const query = signWbi({ bvid: 'BV1xx', cid: 123, up_mid: 9 }, 'k'.repeat(32), { now: 1_700_000_000 });
  assert.match(query, /^bvid=BV1xx&cid=123&up_mid=9&wts=1700000000&w_rid=[0-9a-f]{32}$/);
});

await test('latestVideos maps the space response into tool output', async () => {
  const client = createBilibiliClient({
    cookie: 'SESSDATA=x',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: { list: { vlist: [{
          bvid: 'BV11Un16fERV', title: '一加 Ace 7 Pro上手体验', created: 1761097800,
          length: '06:53', play: 398768, comment: 3562, description: '主动散热',
        }] } },
      }),
    }),
  });
  const videos = await client.latestVideos('25876945');
  assert.equal(videos.length, 1);
  assert.equal(videos[0].bvid, 'BV11Un16fERV');
  assert.equal(videos[0].views, 398768);
  assert.equal(videos[0].url, 'https://www.bilibili.com/video/BV11Un16fERV/');
});

await test('aiConclusion reports the missing login instead of throwing', async () => {
  const client = createBilibiliClient({
    cookie: '',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ code: -101, data: { isLogin: false, wbi_img: { img_url: 'https://x/aaaa.png', sub_url: 'https://x/bbbb.png' } } }),
    }),
  });
  const result = await client.aiConclusion('BV1', 2, 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-logged-in');
});
//#endregion

//#region routes
const { createSettingsHandlers } = await import('../lib/settings-api.js');

await test('cookie routes start a session, report status and clear it', async () => {
  const dir = tempDir();
  const states = { state: 'idle', site: null, message: '' };
  const capture = {
    status: () => ({ ...states }),
    async start(site) {
      states.state = 'waiting';
      states.site = site;
      saveSiteCookies(dir, site, [sessionCookie('SESSDATA')], { now });
      states.state = 'done';
      states.message = 'ok';
      return { ok: true, site };
    },
    cancel: () => ({ ok: true }),
  };
  const handlers = createSettingsHandlers({ dataDir: dir, pluginVersion: 'test', capture });

  const list = handlers.cookieList();
  assert.equal(list.ok, true);
  assert.ok(list.value.sites.some(site => site.id === 'bilibili'));

  const started = handlers.cookieStart({ site: 'bilibili' });
  assert.equal(started.ok, true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(handlers.cookieStatus().value.status.state, 'done');
  assert.equal(cookieHeader(dir, 'bilibili'), 'SESSDATA=v');

  assert.equal(handlers.cookieStart({ site: 'nope' }).ok, false);
  const cleared = handlers.cookieClear({ site: 'bilibili' });
  assert.deepEqual(cleared.value.cleared, ['bilibili']);
  assert.equal(cookieHeader(dir, 'bilibili'), '');
});
//#endregion

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('failed:', failures.join(', '));
  process.exit(1);
}
console.log('cookie sites:', COOKIE_SITES.map(site => site.id).join(', '));
