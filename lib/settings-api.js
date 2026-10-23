/**
 * HTTP bridge between the settings GUI and the settings store.
 *
 * The GUI runs in the Web renderer, the store runs in the Host process, and the
 * only channel between them is the Host web server. Four endpoints cover the
 * whole workflow:
 *
 *   POST /describe   read settings + rollback history
 *   POST /save       write a new version (snapshotting the previous one)
 *   POST /rollback   restore one snapshot (snapshotting the current one)
 *   POST /reset      clear all custom entries (still snapshotted)
 *   POST /preview    show the queries a draft entry would send (no credits)
 *
 * Every endpoint requires a POST and a same-origin request from a loopback
 * Host: a settings write is local-only by construction, so a page on another
 * origin must never be able to add a creator link or flip a provider.
 *
 * @module dsh-tech-daily-report/settings-api
 */
import {
  DEFAULT_HISTORY_LIMIT,
  SOURCE_TYPES,
  countSettings,
  emptySettings,
  listHistory,
  readSettings,
  restoreSettings,
  saveSettings,
} from './settings-store.js';
import { buildBloggerQueries, buildTopicQueries, parseBloggerUrl } from './custom-search.js';

/** Prefix shared by every route in this bridge. */
export const SETTINGS_BRIDGE_PREFIX = '/api/tech-daily-report-settings';

/** Largest JSON body the bridge will read, in bytes. */
const MAX_JSON_BODY_BYTES = 128 * 1024;

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  return value === '::1' || value === '127.0.0.1' || value.startsWith('127.');
}

function loopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/**
 * Reject cross-site requests and anything that did not come from the local
 * machine. `sec-fetch-site` is the cheap first gate; the Origin/Host comparison
 * covers clients that do not send Fetch Metadata.
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {boolean}
 */
export function isBridgeRequestAllowed(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const hostHeader = request.headers.host;
  if (typeof hostHeader !== 'string' || hostHeader === '') return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (new URL(origin).host !== hostUrl.host) return false;
    } catch {
      return false;
    }
  }
  if (loopbackHostname(hostUrl.hostname)) return isLoopbackAddress(request.socket?.remoteAddress);
  return false;
}

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Build the bridge handlers bound to one data directory.
 *
 * @param {{ dataDir: string, pluginVersion: string, historyLimit?: number }} options
 * @returns {Record<string, Function>}
 */
export function createSettingsHandlers({ dataDir, pluginVersion, historyLimit = DEFAULT_HISTORY_LIMIT }) {
  const limit = Number.isInteger(historyLimit) && historyLimit > 0 ? historyLimit : DEFAULT_HISTORY_LIMIT;

  const describe = () => {
    const current = readSettings(dataDir);
    return {
      ok: true,
      value: {
        settings: current.value,
        counts: countSettings(current.value),
        history: listHistory(dataDir, { limit }),
        meta: {
          dataDir,
          pluginVersion,
          sourceTypes: SOURCE_TYPES,
          historyLimit: limit,
          exists: current.exists,
          ...(current.error ? { error: current.error } : {}),
        },
      },
    };
  };

  return {
    describe,

    save(requestBody) {
      const settings = requestBody?.settings;
      if (typeof settings !== 'object' || settings === null) {
        return { ok: false, code: 'settings-rejected', message: 'save requires a settings object' };
      }
      const saved = saveSettings(dataDir, settings, { reason: 'gui-save', limit });
      return { ok: true, value: { settings: saved.value, snapshot: saved.snapshot, savedAt: saved.savedAt, ...describe().value } };
    },

    rollback(requestBody) {
      const id = requestBody?.id;
      if (typeof id !== 'string' || id === '') {
        return { ok: false, code: 'settings-rejected', message: 'rollback requires the snapshot id to restore' };
      }
      const restored = restoreSettings(dataDir, id);
      if (!restored.ok) return { ok: false, code: 'rollback-failed', message: restored.error };
      return { ok: true, value: { settings: restored.value, snapshot: restored.snapshot, rolledBackTo: id, ...describe().value } };
    },

    reset() {
      const saved = saveSettings(dataDir, emptySettings(), { reason: 'gui-reset', limit });
      return { ok: true, value: { settings: saved.value, snapshot: saved.snapshot, savedAt: saved.savedAt, ...describe().value } };
    },

    /**
     * Show the queries a draft topic or creator link would send, without
     * spending a Tavily credit. The GUI uses this to answer "what will this
     * actually search for" before the user saves.
     */
    preview(requestBody) {
      const kind = requestBody?.kind === 'blogger' ? 'blogger' : 'topic';
      if (kind === 'blogger') {
        const parsed = parseBloggerUrl(requestBody?.url);
        if (!parsed.ok) {
          return { ok: false, code: 'invalid-blogger', message: parsed.error ?? 'creator link is not usable' };
        }
        const built = buildBloggerQueries({ url: requestBody.url, label: requestBody.label });
        if (!built.ok) return { ok: false, code: 'invalid-blogger', message: built.error };
        return {
          ok: true,
          value: {
            kind,
            platform: parsed.platform,
            domain: parsed.domain,
            queries: built.queries.map(item => item.query),
            note: 'site: 查询只覆盖已被搜索引擎收录的页面；公众号、抖音等平台的封闭内容可能搜不到。',
          },
        };
      }
      const built = buildTopicQueries({ keywords: requestBody?.keywords, domains: requestBody?.domains });
      if (!built.ok) return { ok: false, code: 'invalid-topic', message: built.error ?? 'topic needs at least one keyword' };
      return { ok: true, value: { kind, queries: built.queries.map(item => item.query) } };
    },

    history() {
      return { ok: true, value: { history: listHistory(dataDir, { limit }), meta: { dataDir, historyLimit: limit } } };
    },
  };
}

/**
 * Route definitions for the Host web server.
 *
 * @param {{ dataDir: string, pluginVersion: string, historyLimit?: number }} options
 * @returns {Array<{ kind: 'exact', path: string, handler: (req: any, res: any) => Promise<void> }>}
 */
export function buildSettingsRoutes(options) {
  const handlers = createSettingsHandlers(options);

  const route = (suffix, handler) => ({
    kind: 'exact',
    path: `${SETTINGS_BRIDGE_PREFIX}/${suffix}`,
    async handler(request, response) {
      if (!isBridgeRequestAllowed(request)) {
        writeJson(response, 403, { ok: false, code: 'forbidden', message: 'settings requests must come from the local Host origin' });
        return;
      }
      if (request.method !== 'POST') {
        writeJson(response, 405, { ok: false, code: 'method-not-allowed', message: `method not allowed: ${request.method ?? ''}` });
        return;
      }
      const body = await readJsonBody(request);
      if (body === undefined) {
        writeJson(response, 400, { ok: false, code: 'malformed-json', message: 'request body is not valid JSON or is too large' });
        return;
      }
      let payload;
      try {
        payload = await handler(body);
      } catch (error) {
        payload = { ok: false, code: 'internal-error', message: error instanceof Error ? error.message : String(error) };
      }
      writeJson(response, payload?.ok === false ? 400 : 200, payload);
    },
  });

  return [
    route('describe', () => handlers.describe()),
    route('save', body => handlers.save(body)),
    route('rollback', body => handlers.rollback(body)),
    route('reset', () => handlers.reset()),
    route('preview', body => handlers.preview(body)),
    route('history', () => handlers.history()),
  ];
}
