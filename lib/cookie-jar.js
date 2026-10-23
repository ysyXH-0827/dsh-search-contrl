/**
 * Cookie storage for the optional logged-in channels.
 *
 * A cookie jar holds the browser cookies a user captured after logging in, one
 * entry per site. It is deliberately small and boring: read, write, mask, drop.
 *
 * Security rules baked in here:
 *   - the file is written with mode 0600 and lives under the plugin data dir;
 *   - values are NEVER returned to the renderer — only names, domain, expiry and
 *     a masked preview, so a settings page (or a log) cannot leak a session;
 *   - expired cookies are pruned on read, so a stale login cannot silently
 *     look valid.
 *
 * @module dsh-search-contrl/cookie-jar
 */
import fs from 'node:fs';
import path from 'node:path';

/** File name of the jar inside the plugin data dir. */
export const COOKIE_FILE = 'cookies.json';
/** Bumped when the on-disk shape changes in an incompatible way. */
export const COOKIE_VERSION = 1;

/** Sites the GUI can capture, with the cookie that proves a real login. */
export const COOKIE_SITES = [
  {
    id: 'bilibili',
    label: '哔哩哔哩',
    loginUrl: 'https://passport.bilibili.com/login',
    probeUrl: 'https://www.bilibili.com/',
    domain: 'bilibili.com',
    required: ['SESSDATA'],
    useful: ['bili_jct', 'DedeUserID', 'buvid3'],
    why: '博主最新视频、视频信息、AI 视频总结与字幕',
  },
  {
    id: 'zhihu',
    label: '知乎',
    loginUrl: 'https://www.zhihu.com/signin',
    probeUrl: 'https://www.zhihu.com/',
    domain: 'zhihu.com',
    required: ['z_c0'],
    useful: ['d_c0'],
    why: '知乎问答与专栏正文',
  },
  {
    id: 'weibo',
    label: '微博',
    loginUrl: 'https://weibo.com/login.php',
    probeUrl: 'https://weibo.com/',
    domain: 'weibo.com',
    required: ['SUB'],
    useful: ['SUBP'],
    why: '博主最新微博',
  },
  {
    id: 'xiaohongshu',
    label: '小红书',
    loginUrl: 'https://www.xiaohongshu.com/login',
    probeUrl: 'https://www.xiaohongshu.com/',
    domain: 'xiaohongshu.com',
    required: ['web_session'],
    useful: ['a1', 'webId'],
    why: '博主笔记与正文',
  },
  {
    id: 'douyin',
    label: '抖音',
    loginUrl: 'https://www.douyin.com/',
    probeUrl: 'https://www.douyin.com/',
    domain: 'douyin.com',
    required: ['sessionid'],
    useful: ['sid_tt', 'uid_tt'],
    why: '博主视频列表',
  },
  {
    id: 'x',
    label: 'X（推特）',
    loginUrl: 'https://x.com/i/flow/login',
    probeUrl: 'https://x.com/',
    domain: 'x.com',
    required: ['auth_token'],
    useful: ['ct0'],
    why: '博主最新推文',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube',
    probeUrl: 'https://www.youtube.com/',
    domain: 'youtube.com',
    required: ['SID', 'SAPISID', 'LOGIN_INFO'],
    useful: ['HSID', 'SSID', 'APISID'],
    why: '频道视频列表与字幕',
  },
  {
    id: 'github',
    label: 'GitHub',
    loginUrl: 'https://github.com/login',
    probeUrl: 'https://github.com/',
    domain: 'github.com',
    required: ['user_session'],
    useful: ['logged_in'],
    why: '仓库、issue 与 release',
  },
];

/** Look up a site profile by id, or null. */
export function cookieSite(id) {
  return COOKIE_SITES.find(site => site.id === id) ?? null;
}

/** Absolute path of the jar inside a data dir. */
export function cookieJarPath(dataDir) {
  return path.join(dataDir, COOKIE_FILE);
}

function emptyJar() {
  return { version: COOKIE_VERSION, updatedAt: null, sites: {} };
}

/** True when a cookie record is past its expiry (session cookies never expire). */
export function isCookieExpired(cookie, now = Date.now()) {
  const expires = Number(cookie?.expires);
  if (!Number.isFinite(expires) || expires <= 0) return false;
  // CDP reports seconds; also tolerate milliseconds from other sources.
  const ms = expires > 1e12 ? expires : expires * 1000;
  return ms <= now;
}

/** Keep only cookies that belong to the site domain and are still alive. */
export function pruneCookies(cookies, domain, now = Date.now()) {
  if (!Array.isArray(cookies)) return [];
  return cookies
    .filter(cookie => cookie && typeof cookie.name === 'string' && cookie.name !== '')
    .filter(cookie => {
      const scope = String(cookie.domain ?? '').replace(/^\./, '');
      return scope === domain || scope.endsWith(`.${domain}`);
    })
    .filter(cookie => !isCookieExpired(cookie, now))
    .map(cookie => ({
      name: cookie.name,
      value: String(cookie.value ?? ''),
      domain: cookie.domain ?? `.${domain}`,
      path: cookie.path ?? '/',
      expires: Number(cookie.expires) || 0,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
    }));
}

/** Does this cookie list prove a logged-in session for the site? */
export function hasLoginCookies(site, cookies) {
  if (!site || !Array.isArray(cookies)) return false;
  const names = new Set(cookies.map(cookie => cookie.name));
  return site.required.every(name => names.has(name));
}

/**
 * Read the jar. A missing, corrupt or foreign file degrades to an empty jar so
 * a broken cookie file can never block the plugin from starting.
 */
export function readJar(dataDir, { now = Date.now() } = {}) {
  const file = cookieJarPath(dataDir);
  if (!fs.existsSync(file)) return { ...emptyJar(), exists: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sites = {};
    for (const [id, entry] of Object.entries(parsed?.sites ?? {})) {
      const site = cookieSite(id);
      if (!site) continue;
      const cookies = pruneCookies(entry?.cookies, site.domain, now);
      if (cookies.length === 0) continue;
      sites[id] = {
        site: id,
        domain: site.domain,
        savedAt: typeof entry?.savedAt === 'string' ? entry.savedAt : null,
        cookies,
        loggedIn: hasLoginCookies(site, cookies),
      };
    }
    return { version: parsed?.version ?? COOKIE_VERSION, updatedAt: parsed?.updatedAt ?? null, sites, exists: true };
  } catch (error) {
    return { ...emptyJar(), exists: true, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Write the jar atomically with restrictive permissions. */
export function writeJar(dataDir, jar) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = cookieJarPath(dataDir);
  const temp = `${file}.${process.pid}.tmp`;
  const payload = {
    version: COOKIE_VERSION,
    updatedAt: new Date().toISOString(),
    sites: jar?.sites ?? {},
  };
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes; the file still lives under the user profile.
  }
  return payload;
}

/** Store one captured site, replacing any previous session for it. */
export function saveSiteCookies(dataDir, siteId, cookies, { now = Date.now() } = {}) {
  const site = cookieSite(siteId);
  if (!site) return { ok: false, error: `unknown cookie site: ${siteId}` };
  const kept = pruneCookies(cookies, site.domain, now);
  if (!hasLoginCookies(site, kept)) {
    return { ok: false, error: `${site.label} 的登录 Cookie 不完整（缺少 ${site.required.join(' / ')}）` };
  }
  const jar = readJar(dataDir, { now });
  jar.sites[site.id] = { site: site.id, domain: site.domain, savedAt: new Date(now).toISOString(), cookies: kept, loggedIn: true };
  const written = writeJar(dataDir, jar);
  return { ok: true, entry: written.sites[site.id], counts: jarCounts(written) };
}

/** Remove one site (or, with no id, every site) from the jar. */
export function clearCookies(dataDir, siteId = '') {
  const jar = readJar(dataDir);
  if (siteId === '') {
    writeJar(dataDir, emptyJar());
    return { ok: true, cleared: Object.keys(jar.sites) };
  }
  const before = Object.keys(jar.sites);
  delete jar.sites[siteId];
  writeJar(dataDir, jar);
  return { ok: true, cleared: before.filter(id => id === siteId) };
}

/** Counts for the GUI summary. */
export function jarCounts(jar) {
  const sites = Object.values(jar?.sites ?? {});
  return {
    sites: sites.length,
    loggedIn: sites.filter(site => site.loggedIn).length,
    cookies: sites.reduce((sum, site) => sum + site.cookies.length, 0),
  };
}

/**
 * Renderer-safe view of the jar. Cookie values are dropped, and each cookie is
 * shown as name + expiry + a masked hint so the user can confirm "it is there"
 * without the page ever holding a credential.
 */
export function maskJar(jar) {
  const sites = Object.values(jar?.sites ?? {}).map(entry => {
    const site = cookieSite(entry.site);
    return {
      site: entry.site,
      label: site?.label ?? entry.site,
      domain: entry.domain,
      savedAt: entry.savedAt,
      loggedIn: Boolean(entry.loggedIn),
      why: site?.why ?? '',
      cookies: entry.cookies.map(cookie => ({
        name: cookie.name,
        domain: cookie.domain,
        expiresAt: cookie.expires ? new Date((cookie.expires > 1e12 ? cookie.expires : cookie.expires * 1000)).toISOString() : null,
        httpOnly: cookie.httpOnly,
        preview: `${String(cookie.value).slice(0, 2)}***${String(cookie.value).slice(-2)}`,
      })),
    };
  });
  return { updatedAt: jar?.updatedAt ?? null, counts: jarCounts(jar), sites };
}

/** Cookie header string for one site, or '' when nothing is stored. */
export function cookieHeader(dataDir, siteId, { now = Date.now() } = {}) {
  const site = cookieSite(siteId);
  if (!site) return '';
  const entry = readJar(dataDir, { now }).sites[site.id];
  if (!entry || !entry.cookies.length) return '';
  return entry.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}
