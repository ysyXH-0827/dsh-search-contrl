/**
 * Real-browser smoke test for the cookie reader.
 *
 * It opens a throwaway Edge/Chrome window, plants a SESSDATA cookie through a
 * second DevTools connection, then asks the plugin's reader to find it. This is
 * the only test that proves the CDP method choice against an actual browser; it
 * is not part of `npm test` because it launches a browser.
 *
 *   node scripts/smoke-cdp.mjs [--keep-open]
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCookieCapture } from '../lib/cookie-capture.js';

const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-smoke-'));
const capture = createCookieCapture({ dataDir: profileDir, platform: process.platform });

const browser = await (async () => {
  const { findBrowser } = await import('../lib/cookie-capture.js');
  const found = findBrowser({ platform: process.platform, exists: fs.existsSync });
  if (!found) throw new Error('no Chrome/Edge found');
  return found;
})();
console.log('browser =', browser.name);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(browser.path, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}-browser`,
  '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank',
], { stdio: 'ignore' });

async function devtoolsUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools never came up');
}

function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('socket failed')));
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      return new Promise(resolve => {
        pending.set(id, resolve);
        socket.send(JSON.stringify(payload));
      });
    },
    close: () => socket.close(),
  };
}

try {
  const version = await devtoolsUrl();
  const browserClient = connect(version.webSocketDebuggerUrl);
  await browserClient.ready;

  const targets = await browserClient.send('Target.getTargets');
  const page = targets.result.targetInfos.find(target => target.type === 'page');
  if (!page) throw new Error('no page target');
  const attached = await browserClient.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const sessionId = attached.result.sessionId;
  const planted = await browserClient.send('Network.setCookie', {
    name: 'SESSDATA', value: 'smoke-value', domain: '.bilibili.com', path: '/', httpOnly: true, secure: true,
  }, sessionId);
  console.log('planted SESSDATA =', planted.result.success);

  const cookies = await capture.readOnce(port);
  const found = cookies.find(cookie => cookie.name === 'SESSDATA');
  console.log('readOnce returned', cookies.length, 'cookies; SESSDATA =', Boolean(found));
  if (!found) throw new Error('the reader did not see the planted cookie');
  if (found.value !== 'smoke-value') throw new Error('cookie value mismatch');
  console.log('SMOKE OK');
  browserClient.close();
} finally {
  child.kill();
  await sleep(400);
  for (const dir of [profileDir, `${profileDir}-browser`]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
