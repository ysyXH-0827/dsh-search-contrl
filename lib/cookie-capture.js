/**
 * Capture a logged-in browser session without asking the user to copy cookies.
 *
 * Flow: the settings page calls /cookie/start, the Host launches the user's own
 * browser with a throwaway profile pointed at the site's login page, the user
 * logs in normally, and this module reads the resulting cookies over the
 * DevTools protocol, keeps the ones that prove a login, and closes the window.
 *
 * Why Chrome DevTools and not an iframe: cookie access is cross-origin and
 * HttpOnly, so the renderer can never read it. The browser must be driven from
 * the Host process, and CDP is the only browser-native channel that needs no
 * extension and no user copy-paste.
 *
 * Everything that touches the OS is injectable (spawn, fetch, WebSocket, clock)
 * so the flow is unit-testable without opening a real window.
 *
 * @module dsh-search-contrl/cookie-capture
 */
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { cookieSite, hasLoginCookies, pruneCookies, saveSiteCookies } from './cookie-jar.js';

/** How long the login window may stay open before the capture gives up. */
const CAPTURE_TIMEOUT_MS = 300_000;
/** Cookie polling interval while the login window is open. */
const CAPTURE_POLL_MS = 1_500;

const WIN_BROWSERS = [
  { name: 'Edge', paths: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ] },
  { name: 'Chrome', paths: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ] },
  { name: 'Brave', paths: [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : '',
  ] },
];

const MAC_BROWSERS = [
  { name: 'Chrome', paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
  { name: 'Edge', paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
  { name: 'Chromium', paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'] },
];

const LINUX_BROWSERS = [
  { name: 'Chrome', paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'] },
  { name: 'Chromium', paths: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'] },
  { name: 'Edge', paths: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'] },
];

/**
 * Find a Chromium-family browser. Returns null instead of throwing: a machine
 * without one still gets the GUI, with a clear "no browser" message.
 */
export function findBrowser({ platform = process.platform, exists = fs.existsSync } = {}) {
  const table = platform === 'win32' ? WIN_BROWSERS : platform === 'darwin' ? MAC_BROWSERS : LINUX_BROWSERS;
  for (const browser of table) {
    for (const candidate of browser.paths) {
      if (!candidate) continue;
      try {
        if (exists(candidate)) return { name: browser.name, path: candidate };
      } catch {
        // A probe failing on one candidate must not stop the search.
      }
    }
  }
  return null;
}

/** Ask the OS for a free loopback port. */
export function pickPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** Minimal DevTools client: one WebSocket, request/response by id. */
export function createDevToolsClient(url, { WebSocketImpl = globalThis.WebSocket } = {}) {
  if (typeof WebSocketImpl !== 'function') {
    throw new Error('no WebSocket implementation available');
  }
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  let nextId = 1;
  let opened = false;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      opened = true;
      resolve();
    });
    socket.addEventListener('error', event => reject(new Error(`devtools socket failed: ${event?.message ?? 'error'}`)));
  });

  socket.addEventListener('message', event => {
    let payload;
    try {
      payload = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return;
    }
    if (payload?.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message ?? 'devtools error'));
      else resolve(payload.result);
    }
  });

  return {
    ready,
    get isOpen() {
      return opened;
    },
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      const message = JSON.stringify(payload);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          socket.send(message);
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() {
      try {
        socket.close();
      } catch {
        // Closing an already-closed socket is not an error worth surfacing.
      }
    },
  };
}

async function defaultLaunch(browser, port, profileDir, url) {
  const { spawn } = await import('node:child_process');
  const child = spawn(browser.path, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    url,
  ], { detached: false, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});

  // Edge/Chrome spawn a tree of helper processes that keep the profile directory
  // locked for a moment after the parent dies, so cleanup waits on the real exit
  // event instead of racing the filesystem.
  const exited = new Promise(resolve => {
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on('exit', code => done(code));
    child.on('close', code => done(code));
    setTimeout(() => done(null), 15_000);
  });

  return {
    pid: child.pid ?? null,
    exited,
    kill() {
      // taskkill /T also takes down the renderer/GPU helpers holding the profile.
      if (process.platform === 'win32' && child.pid) {
        try {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          killer.on('error', () => {});
          return;
        } catch {
          // fall through to the portable kill
        }
      }
      try {
        child.kill();
      } catch {
        // The browser may already be gone.
      }
    },
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * One capture session at a time. `start()` resolves only when the session ends
 * (login captured, cancelled, or timed out) so the GUI can simply poll status.
 */

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Close the browser and wait for it to exit, so the profile directory unlocks. */
export async function stopBrowser(handle, { sleepImpl = defaultSleep, graceMs = 6_000 } = {}) {
  if (!handle) return;
  try {
    handle.kill?.();
  } catch {
    // Killing an already-dead process is not an error worth surfacing.
  }
  if (!handle.exited) {
    await sleepImpl(250);
    return;
  }
  await Promise.race([handle.exited, sleepImpl(graceMs)]);
}

/**
 * Delete a temporary browser profile, tolerating Windows EPERM/EBUSY.
 *
 * Measured: right after kill() the directory is still held by surviving Edge
 * helper processes, so a single rmSync throws
 * "EPERM, Permission denied: ...\\dsh-search-contrl-bilibili-<ts>".
 * Retry with backoff and never throw: a leftover temp directory is a nuisance,
 * not a reason to lose the cookies the user just logged in for.
 */
export async function removeProfileDir(dir, { attempts = 8, delayMs = 250, sleepImpl = defaultSleep, rm } = {}) {
  const remove = rm ?? (target => fs.rmSync(target, { recursive: true, force: true }));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      remove(dir);
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleepImpl(delayMs * attempt);
    }
  }
  return { ok: false, attempts, error: lastError instanceof Error ? lastError.message : String(lastError) };
}

/** Remove profiles left behind by earlier failed cleanups; best effort only. */
async function sweepProfiles(root, { olderThanMs = 30 * 60 * 1000, now = Date.now() } = {}) {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { removed };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-search-contrl-')) continue;
    const target = path.join(root, entry.name);
    try {
      const stat = fs.statSync(target);
      if (now - stat.mtimeMs < olderThanMs) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Still locked: the next run tries again.
    }
  }
  return { removed };
}

function notReady(cause) {
  const error = new Error(cause instanceof Error ? cause.message : String(cause));
  error.code = 'not-ready';
  return error;
}

export function createCookieCapture(options = {}) {
  const {
    dataDir,
    platform = process.platform,
    exists = fs.existsSync,
    launch = defaultLaunch,
    fetchImpl = globalThis.fetch,
    WebSocketImpl = globalThis.WebSocket,
    now = Date.now,
    sleepImpl = sleep,
    timeoutMs = CAPTURE_TIMEOUT_MS,
    pollMs = CAPTURE_POLL_MS,
    profileRoot = os.tmpdir(),
    devToolsClient = createDevToolsClient,
  } = options;

  if (!dataDir) throw new Error('cookie capture needs a data dir');

  let state = { state: 'idle', site: null, startedAt: null, message: '', counts: null };
  let active = null;

  const snapshot = () => ({ ...state, browser: state.browser ?? null });

  /**
   * Read every cookie in the fresh profile.
   *
   * Measured on Edge 141: Network.getAllCookies is NOT available on the browser
   * target (-32601 "'Network.getAllCookies' wasn't found"), and that target is
   * exactly what /json/version hands out. The working paths are Storage.getCookies
   * on the browser target, or Network.getAllCookies addressed to an attached page
   * session. Try the cheap one first.
   */
  async function readCookies(port) {
    let version;
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`);
      if (!response?.ok) throw new Error(`devtools endpoint returned ${response?.status ?? 'no response'}`);
      version = await response.json();
    } catch (error) {
      throw notReady(error);
    }
    if (typeof version?.webSocketDebuggerUrl !== 'string') throw notReady(new Error('devtools did not publish a socket url'));

    const client = devToolsClient(version.webSocketDebuggerUrl, { WebSocketImpl });
    try {
      try {
        await client.ready;
      } catch (error) {
        throw notReady(error);
      }
      try {
        const direct = await client.send('Storage.getCookies');
        if (Array.isArray(direct?.cookies)) return direct.cookies;
      } catch {
        // Some builds do not expose Storage on the browser target; fall through.
      }
      const targets = await client.send('Target.getTargets');
      const page = (targets?.targetInfos ?? []).find(target => target.type === 'page');
      if (!page) throw new Error('浏览器里没有可用的页面目标，无法读取 Cookie');
      const attached = await client.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      const sessionId = attached?.sessionId;
      if (!sessionId) throw new Error('无法附加到浏览器页面，读取 Cookie 失败');
      const result = await client.send('Network.getAllCookies', {}, sessionId);
      return Array.isArray(result?.cookies) ? result.cookies : [];
    } finally {
      client.close();
    }
  }

  async function run(siteId) {
    const site = cookieSite(siteId);
    if (!site) throw new Error(`unknown cookie site: ${siteId}`);
    const browser = findBrowser({ platform, exists });
    if (!browser) {
      return { ok: false, code: 'no-browser', message: '没有找到 Chrome / Edge / Chromium，无法打开登录窗口。请安装其中一个浏览器，或手动粘贴 Cookie。' };
    }
    await sweepProfiles(profileRoot, { now: now() });
    const port = await pickPort();
    const profileDir = path.join(profileRoot, `dsh-search-contrl-${siteId}-${now()}`);
    const handle = await launch(browser, port, profileDir, site.loginUrl);
    state = { ...state, browser: browser.name, message: `已打开 ${browser.name}，请在窗口里登录 ${site.label}` };

    const deadline = now() + timeoutMs;
    try {
      let endpointReady = false;
      while (now() < deadline) {
        if (active?.cancelled) return { ok: false, code: 'cancelled', message: '已取消' };
        try {
          const raw = await readCookies(port);
          endpointReady = true;
          const cookies = pruneCookies(raw, site.domain, now());
          state = { ...state, cookiesSeen: cookies.length };
          if (hasLoginCookies(site, cookies)) {
            const saved = saveSiteCookies(dataDir, site.id, cookies, { now: now() });
            if (!saved.ok) return { ok: false, code: 'save-failed', message: saved.error };
            return {
              ok: true,
              site: site.id,
              label: site.label,
              names: cookies.map(cookie => cookie.name),
              counts: saved.counts,
              message: `${site.label} 登录已捕获，共保存 ${cookies.length} 个 Cookie`,
            };
          }
          state = { ...state, message: `等待 ${site.label} 登录…（已看到 ${cookies.length} 个 Cookie，缺少 ${site.required.join(' / ')}）` };
        } catch (error) {
          const code = error && typeof error === 'object' ? error.code : undefined;
          if (code === 'not-ready' && !endpointReady) {
            state = { ...state, message: `等待 ${browser.name} 启动调试端口…` };
          } else {
            // A method or permission error will not heal by polling again: report it.
            const message = error instanceof Error ? error.message : String(error);
            state = { ...state, state: 'error', message: `读取 Cookie 失败：${message}` };
            return { ok: false, code: 'cdp-error', message };
          }
        }
        await sleepImpl(pollMs);
      }
      return { ok: false, code: 'timeout', message: `等待登录超时（${Math.round(timeoutMs / 1000)} 秒）` };
    } finally {
      try {
        await stopBrowser(handle, { sleepImpl });
      } catch {
        // never let teardown mask the capture result
      }
      const cleanup = await removeProfileDir(profileDir, { sleepImpl });
      if (!cleanup.ok) {
        state = { ...state, cleanup: `临时配置目录未能删除（${cleanup.error ?? '被占用'}），下次启动会自动清理` };
      }
      active = null;
    }
  }

  return {
    status() {
      return snapshot();
    },

    /** One-shot read, used by diagnostics and the real-browser smoke test. */
    readOnce: port => readCookies(port),

    async start(siteId) {
      if (state.state === 'waiting') {
        return { ok: false, code: 'busy', message: '已有一次 Cookie 捕获在进行中' };
      }
      state = { state: 'waiting', site: siteId, startedAt: new Date(now()).toISOString(), message: '正在启动浏览器…', counts: null, browser: null };
      const token = { cancelled: false };
      active = token;
      try {
        const result = await run(siteId);
        state = {
          ...state,
          state: result.ok ? 'done' : result.code === 'cancelled' ? 'idle' : 'error',
          message: result.message,
          counts: result.counts ?? null,
          finishedAt: new Date(now()).toISOString(),
        };
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state = { ...state, state: 'error', message, finishedAt: new Date(now()).toISOString() };
        return { ok: false, code: 'capture-failed', message };
      }
    },

    cancel() {
      if (active) active.cancelled = true;
      return { ok: true, message: '正在取消…' };
    },
  };
}
