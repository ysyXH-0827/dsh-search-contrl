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
import { DEFAULT_REPORT_TITLE, normalizeTitleTemplate } from './report-title.js';

/** Current schema version of the stored document. */
const SETTINGS_VERSION = 1;

/** How many previous versions are kept when a caller passes no limit. */
export const DEFAULT_HISTORY_LIMIT = 20;

/** File holding the current settings. */
const SETTINGS_FILE = 'settings.json';

/** Directory holding the snapshots. */
const HISTORY_DIR = 'history';

/** Search channel kinds a custom source may use. */
export const SOURCE_TYPES = ['bing', 'tavily', 'site'];

/**
 * How a finished report reaches the user.
 *
 * - file: write the markdown under reports/ and hand over the path
 * - chat: render the whole body in the conversation, no file
 * - both: write the file and also render the body
 */
export const DELIVERY_MODES = ['file', 'chat', 'both'];

/**
 * 事件程度：报告只收大事件 / 大 + 中 / 连小更新一起收。
 * large = 8–10 条，medium = 12–16 条（默认），small = 16–24 条。
 */
/**
 * 报告排版：table = 每板块一张表（默认）；list = 逐条分条输出。
 */
export const REPORT_FORMATS = ['table', 'list'];
export const DEFAULT_REPORT_FORMAT = 'table';

export const EVENT_SCALES = ['large', 'medium', 'small'];
export const DEFAULT_EVENT_SCALE = 'medium';

// 博主动态只覆盖这两个平台，字数与 AI 总结都按平台分别设置
export const POST_PLATFORMS = ['weibo', 'bili'];
/** 要点字数下限的默认值：微博短句、B 站需要更完整的评论 */
export const POINT_LENGTH_DEFAULTS = { weibo: 20, bili: 50 };
/** 设置页提供的字数控位（20 字一个挡位），也可以自定义任意 10–200 的值 */
export const POINT_LENGTH_STEPS = [20, 40, 60, 80];
/** 是否取平台 AI 总结：B 站有总结接口，微博没有 */
export const AI_SUMMARY_DEFAULTS = { weibo: false, bili: true };

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
  return {
    version: SETTINGS_VERSION,
    updatedAt: null,
    delivery: { mode: 'file' },
    searchSources: [],
    topics: [],
    bloggers: [],
    // 博主动态是否在报告里附原文链接（默认开启）
    showPostLinks: true,
    // 博主动态是否附一句「要点」
    showPostPoints: true,
    // 要点字数下限（按平台）：微博 20、B 站 50；设置页按 20 字挡位选择或自定义
    pointLength: { ...POINT_LENGTH_DEFAULTS },
    // 是否取平台 AI 总结（按平台）：B 站有 AI 总结接口，微博没有
    aiSummary: { ...AI_SUMMARY_DEFAULTS },
    // 报告事件程度：large / medium / small
    eventScale: DEFAULT_EVENT_SCALE,
    // 报告排版：table（默认）/ list
    reportFormat: DEFAULT_REPORT_FORMAT,
    // 报告标题模板：支持 {主题} / {类型} / {日期}
    reportTitle: DEFAULT_REPORT_TITLE,
  };
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

  // 博主动态原链接开关：只有显式 false / 'false' / 0 才算关闭，其它一律按开启处理
  if (input.showPostLinks !== undefined) {
    const v = input.showPostLinks;
    out.showPostLinks = !(v === false || v === 'false' || v === 0 || v === '0');
  }

  // 博主要点开关：同样只在显式 false/0 时关闭
  if (input.showPostPoints !== undefined) {
    const v = input.showPostPoints;
    out.showPostPoints = !(v === false || v === 'false' || v === 0 || v === '0');
  }

  // 要点字数：按平台分别钳制在 10–200，非法值回落默认（20 字挡位只是 UI 预设）
  const pointLengthInput = typeof input.pointLength === "object" && input.pointLength !== null ? input.pointLength : {};
  for (const platform of POST_PLATFORMS) {
    const raw = Number(pointLengthInput[platform]);
    out.pointLength[platform] = Number.isFinite(raw)
      ? Math.min(200, Math.max(10, Math.round(raw)))
      : POINT_LENGTH_DEFAULTS[platform];
  }

  // AI 总结开关：按平台，只有显式 false / "false" / 0 才算关闭
  const aiSummaryInput = typeof input.aiSummary === "object" && input.aiSummary !== null ? input.aiSummary : {};
  for (const platform of POST_PLATFORMS) {
    const v = aiSummaryInput[platform];
    if (v === undefined) continue;
    out.aiSummary[platform] = !(v === false || v === "false" || v === 0 || v === "0");
  }

  // 报告排版：不在枚举里的一律回落表格
  const wantedFormat = asString(input.reportFormat).toLowerCase();
  out.reportFormat = REPORT_FORMATS.includes(wantedFormat) ? wantedFormat : DEFAULT_REPORT_FORMAT;

  // 事件程度：不在枚举里的一律回落默认档
  const wantedScale = asString(input.eventScale).toLowerCase();
  out.eventScale = EVENT_SCALES.includes(wantedScale) ? wantedScale : DEFAULT_EVENT_SCALE;

  // 报告标题模板：空串回落默认，超长截断（渲染在 lib/report-title.js，单一实现）
  out.reportTitle = normalizeTitleTemplate(input.reportTitle);

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
        // 可选的预设 id：钉住后即使标签改了也还按原预设取源
        preset: asString(item.preset).slice(0, 40),
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

  // delivery 既接受对象 { mode } 也接受裸字符串，方便手工编辑 settings.json。
  const rawDelivery = typeof input.delivery === 'string' ? { mode: input.delivery } : input.delivery;
  const wantedMode = asString(rawDelivery && typeof rawDelivery === 'object' ? rawDelivery.mode : '');
  out.delivery = { mode: DELIVERY_MODES.includes(wantedMode) ? wantedMode : 'file' };

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
 * A snapshot name that is never already taken.
 *
 * Two saves can land in the same millisecond — the settings card saves on a
 * debounce and the CLI can write twice in a row — and the plain timestamp name
 * would silently overwrite the earlier snapshot. Losing a rollback point is a
 * data-loss bug, so the second write gets a numeric suffix instead.
 */
function uniqueSnapshotName(historyDir, date) {
  // Negative slice: everything except the ".json" tail. A positive bound here
  // truncated every name to "2026-1", so snapshots from different days shared a
  // prefix and the history list could no longer be ordered by time.
  const base = snapshotName(date).slice(0, -'.json'.length);
  let candidate = `${base}.json`;
  for (let n = 2; n < 1000; n += 1) {
    if (!fs.existsSync(path.join(historyDir, candidate))) return candidate;
    candidate = `${base}-${n}.json`;
  }
  return candidate;
}

/**
 * Newest-first ordering for snapshot names.
 *
 * The suffix created by uniqueSnapshotName means a plain string sort is no
 * longer chronological: "...Z-2.json" and "...Z.json" share a timestamp. Parse
 * the trailing counter so the newest write is always listed and pruned first.
 */
function compareSnapshotNames(a, b) {
  const split = (name) => {
    const match = /^(.*?)(?:-(\d+))?\.json$/.exec(name);
    return { stamp: match ? match[1] : name, index: match && match[2] ? Number(match[2]) : 1 };
  };
  const left = split(a);
  const right = split(b);
  if (left.stamp !== right.stamp) return left.stamp < right.stamp ? 1 : -1;
  return right.index - left.index;
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
    snapshot = uniqueSnapshotName(historyDir, now);
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
function pruneHistory(dir, limit) {
  const historyDir = path.join(dir, HISTORY_DIR);
  let names;
  try {
    names = fs.readdirSync(historyDir).filter(name => name.endsWith('.json'));
  } catch {
    return [];
  }
  names.sort(compareSnapshotNames);
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
  names.sort(compareSnapshotNames);
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
