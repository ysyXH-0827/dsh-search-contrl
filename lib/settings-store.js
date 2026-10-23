/**
 * Persistent settings store with a built-in rollback history.
 *
 * The plugin profile patch only carries the mount-time config (API key, market,
 * limits). Everything the GUI edits lives here instead of in the profile YAML:
 * the GUI must never rewrite a file the Host composes from several layers, and
 * a store of our own gives us something the profile cannot — a snapshot of
 * every previous version, restorable from the settings page or the tool.
 *
 * Layout inside the data directory:
 *
 *   settings.json          current version
 *   history/<ts>.json      one snapshot per write, newest first by name
 *
 * Writes are synchronous on purpose: the files are tiny, and a settings save
 * that loses a race with itself is worse than a few milliseconds of blocking.
 *
 * @module dsh-search-contrl/settings-store
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Current schema version of the stored document. */
export const SETTINGS_VERSION = 1;

/** How many previous versions are kept when a caller passes no limit. */
export const DEFAULT_HISTORY_LIMIT = 20;

/** File holding the current settings. */
export const SETTINGS_FILE = 'settings.json';

/** Directory holding the snapshots. */
export const HISTORY_DIR = 'history';

/** Search channel kinds a custom source may use. */
export const SOURCE_TYPES = ['bing', 'tavily', 'site'];

/**
 * Resolve the directory holding the store and its history.
 *
 * `SEARCH_CONTRL_DATA_DIR` exists so tests (and anyone running a second
 * profile) can point the store somewhere harmless instead of the real home.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} absolute directory path
 */
export function resolveDataDir(env = process.env) {
  const override = typeof env?.SEARCH_CONTRL_DATA_DIR === 'string'
    ? env.SEARCH_CONTRL_DATA_DIR.trim()
    : '';
  if (override !== '') return path.resolve(override);
  return path.join(os.homedir(), '.dsh', 'plugin-data', 'dsh-search-contrl');
}

/**
 * An empty settings document.
 *
 * @returns {{ version: number, updatedAt: string | null, searchSources: Array<Object>, topics: Array<Object>, bloggers: Array<Object> }}
 */
export function emptySettings() {
  return { version: SETTINGS_VERSION, updatedAt: null, searchSources: [], topics: [], bloggers: [] };
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    const text = asString(entry);
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function slug(value, fallback) {
  const base = asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base === '' ? fallback : base;
}

/**
 * Assign a unique id inside one collection, keeping an existing well-formed id
 * when it is already unique. Two entries can share a label; they must not share
 * an id, or the GUI's edit and delete actions would hit both.
 */
function uniqueId(prefix, wanted, label, used, index) {
  const candidate = asString(wanted) !== '' ? slug(wanted, `${prefix}-${index + 1}`) : slug(label, `${prefix}-${index + 1}`);
  let id = candidate;
  let n = 2;
  while (used.has(id)) {
    id = `${candidate}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Validate and normalise an arbitrary settings document.
 *
 * The GUI posts whatever its form holds, so this is the trust boundary: it
 * drops unknown fields, coerces types, de-duplicates ids, and bounds every list
 * so a malformed or hostile payload cannot grow the store without limit.
 *
 * @param {unknown} raw
 * @param {{ limit?: number }} [options] maximum entries per collection
 * @returns {{ version: number, updatedAt: string | null, searchSources: Array<Object>, topics: Array<Object>, bloggers: Array<Object> }}
 */
export function normalizeSettings(raw, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 200) : 60;
  const input = typeof raw === 'object' && raw !== null ? raw : {};
  const out = emptySettings();

  const sourceIds = new Set();
  if (Array.isArray(input.searchSources)) {
    for (const entry of input.searchSources.slice(0, limit)) {
      const item = typeof entry === 'object' && entry !== null ? entry : {};
      const label = asString(item.label) || asString(item.domain) || asString(item.id);
      if (label === '') continue;
      const type = SOURCE_TYPES.includes(item.type) ? item.type : 'bing';
      const domain = asString(item.domain).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (type === 'site' && domain === '') continue;
      out.searchSources.push({
        id: uniqueId('source', item.id, label, sourceIds, out.searchSources.length),
        label: label.slice(0, 80),
        type,
        domain: domain.slice(0, 120),
        enabled: item.enabled !== false,
      });
    }
  }

  const topicIds = new Set();
  if (Array.isArray(input.topics)) {
    for (const entry of input.topics.slice(0, limit)) {
      const item = typeof entry === 'object' && entry !== null ? entry : {};
      const label = asString(item.label) || asString(item.id);
      if (label === '') continue;
      const keywords = Array.isArray(item.keywords) ? asStringArray(item.keywords, 12) : [];
      const domains = Array.isArray(item.domains)
        ? asStringArray(item.domains, 8).map(domain => domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase())
        : [];
      if (keywords.length === 0 && domains.length === 0) continue;
      out.topics.push({
        id: uniqueId('topic', item.id, label, topicIds, out.topics.length),
        label: label.slice(0, 80),
        keywords: keywords.map(keyword => keyword.slice(0, 80)),
        domains: domains.map(domain => domain.slice(0, 120)),
        enabled: item.enabled !== false,
      });
    }
  }

  const bloggerIds = new Set();
  if (Array.isArray(input.bloggers)) {
    for (const entry of input.bloggers.slice(0, limit)) {
      const item = typeof entry === 'object' && entry !== null ? entry : {};
      const url = asString(item.url);
      if (url === '') continue;
      const label = asString(item.label) || url;
      out.bloggers.push({
        id: uniqueId('blogger', item.id, label, bloggerIds, out.bloggers.length),
        label: label.slice(0, 80),
        url: url.slice(0, 400),
        enabled: item.enabled !== false,
      });
    }
  }

  const updatedAt = asString(input.updatedAt);
  out.updatedAt = updatedAt === '' ? null : updatedAt;
  return out;
}

/**
 * Count the user-visible entries in a settings document.
 *
 * @param {ReturnType<typeof emptySettings>} settings
 * @returns {{ sources: number, topics: number, bloggers: number, total: number }}
 */
export function countSettings(settings) {
  const sources = Array.isArray(settings?.searchSources) ? settings.searchSources.length : 0;
  const topics = Array.isArray(settings?.topics) ? settings.topics.length : 0;
  const bloggers = Array.isArray(settings?.bloggers) ? settings.bloggers.length : 0;
  return { sources, topics, bloggers, total: sources + topics + bloggers };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function snapshotName(date) {
  return `${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * Read the current settings, falling back to an empty document when the store
 * does not exist yet or was corrupted. A broken store must never take the
 * plugin down: the report still has to run with the profile defaults.
 *
 * @param {string} dir
 * @returns {{ value: ReturnType<typeof emptySettings>, exists: boolean, path: string, error?: string }}
 */
export function readSettings(dir) {
  const file = path.join(dir, SETTINGS_FILE);
  const raw = readJson(file);
  if (raw === undefined) {
    const exists = fs.existsSync(file);
    return {
      value: emptySettings(),
      exists,
      path: file,
      ...(exists ? { error: 'settings.json is unreadable or not valid JSON; using an empty settings document' } : {}),
    };
  }
  return { value: normalizeSettings(raw), exists: true, path: file };
}

/**
 * Persist settings, first snapshotting the version being replaced.
 *
 * The snapshot is taken from the *previous* file, which is what makes the
 * history a real rollback trail: restoring any entry returns the exact document
 * that was live before its successor was saved.
 *
 * @param {string} dir
 * @param {unknown} raw next settings document
 * @param {{ reason?: string, limit?: number, now?: Date }} [options]
 * @returns {{ value: ReturnType<typeof emptySettings>, snapshot: string | null, savedAt: string }}
 */
export function saveSettings(dir, raw, options = {}) {
  ensureDir(dir);
  const now = options.now instanceof Date ? options.now : new Date();
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 100) : DEFAULT_HISTORY_LIMIT;
  const previous = readSettings(dir);

  let snapshot = null;
  if (previous.exists) {
    const historyDir = path.join(dir, HISTORY_DIR);
    ensureDir(historyDir);
    snapshot = snapshotName(now);
    fs.writeFileSync(
      path.join(historyDir, snapshot),
      `${JSON.stringify({ createdAt: now.toISOString(), reason: asString(options.reason) || 'save', settings: previous.value }, null, 2)}\n`,
      'utf8'
    );
    pruneHistory(dir, limit);
  }

  const value = normalizeSettings({ ...raw, updatedAt: now.toISOString() });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return { value, snapshot, savedAt: now.toISOString() };
}

/**
 * Delete the oldest snapshots beyond `limit`.
 *
 * @param {string} dir
 * @param {number} limit
 * @returns {string[]} names that were removed
 */
export function pruneHistory(dir, limit) {
  const historyDir = path.join(dir, HISTORY_DIR);
  let names;
  try {
    names = fs.readdirSync(historyDir).filter(name => name.endsWith('.json'));
  } catch {
    return [];
  }
  // Snapshot names start with an ISO timestamp, so a plain descending sort is
  // also a chronological sort. String sorting avoids parsing 20 file names.
  names.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const removed = [];
  for (const name of names.slice(Math.max(limit, 0))) {
    try {
      fs.unlinkSync(path.join(historyDir, name));
      removed.push(name);
    } catch {
      // A snapshot that cannot be deleted is not worth failing the save over.
    }
  }
  return removed;
}

/**
 * List snapshots, newest first, with a summary of what each one holds.
 *
 * @param {string} dir
 * @param {{ limit?: number }} [options]
 * @returns {Array<{ id: string, createdAt: string, reason: string, counts: ReturnType<typeof countSettings> }>}
 */
export function listHistory(dir, options = {}) {
  const historyDir = path.join(dir, HISTORY_DIR);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  let names;
  try {
    names = fs.readdirSync(historyDir).filter(name => name.endsWith('.json'));
  } catch {
    return [];
  }
  names.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const out = [];
  for (const name of names.slice(0, limit)) {
    const raw = readJson(path.join(historyDir, name));
    const settings = normalizeSettings(raw?.settings ?? {});
    out.push({
      id: name,
      createdAt: asString(raw?.createdAt) || name,
      reason: asString(raw?.reason) || 'save',
      counts: countSettings(settings),
    });
  }
  return out;
}

/**
 * Restore one snapshot as the live settings.
 *
 * The version being replaced is snapshotted first, so a restore is itself
 * undoable — a rollback that cannot be rolled back is a trap, not a feature.
 *
 * @param {string} dir
 * @param {string} id snapshot file name as returned by listHistory
 * @returns {{ ok: true, value: ReturnType<typeof emptySettings>, snapshot: string | null } | { ok: false, error: string }}
 */
export function restoreSettings(dir, id) {
  const name = asString(id);
  if (name === '' || name.includes('/') || name.includes('\\') || !name.endsWith('.json')) {
    return { ok: false, error: 'rollback requires a snapshot id from the history list' };
  }
  const file = path.join(dir, HISTORY_DIR, name);
  const raw = readJson(file);
  if (raw === undefined || typeof raw !== 'object' || raw === null) {
    return { ok: false, error: `snapshot ${name} does not exist or is unreadable` };
  }
  const restored = saveSettings(dir, raw.settings ?? {}, { reason: `restore:${name}` });
  return { ok: true, value: restored.value, snapshot: restored.snapshot };
}
