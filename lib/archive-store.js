/**
 * archive-store.js — 读 daily-collect --archive 写下的按天快照。
 *
 * 快照格式（见 scripts/daily-collect.mjs）：{generatedAt, targetDate, title,
 * topic: {label, preset, keywords}, scale, uniqueItems, allItems, stats}。
 * allItems 是那次抓到的全部条目（含相邻日期），uniqueItems 是当日窗口内的
 * 条目；旧格式只有 {boards, others}。本模块是纯函数 + 同步文件读取，
 * 不做网络、不写磁盘，离线测试直接跑。
 */
import fs from 'node:fs';

/**
 * 从一份快照里取出条目：allItems 优先（它含相邻日期，是补窗口漂移的
 * 关键），没有 allItems 时退到 uniqueItems，再退到旧格式 boards + others。
 * 只要还有 url 就算一条；过滤后一条不剩按“无条目”处理。
 *
 * @param {unknown} data 解析后的快照 JSON
 * @returns {unknown[] | null}
 */
function snapshotItems(data) {
  if (!data || typeof data !== 'object') return null;
  let items = null;
  if (Array.isArray(data.allItems)) items = data.allItems;
  else if (Array.isArray(data.uniqueItems)) items = data.uniqueItems;
  else if (data.boards || Array.isArray(data.others)) {
    items = [...Object.values(data.boards ?? {}).flat(), ...(Array.isArray(data.others) ? data.others : [])];
  } else {
    return null;
  }
  const kept = items.filter(it => it && typeof it === 'object' && typeof it.url === 'string' && it.url !== '');
  return kept.length ? kept : null;
}

/**
 * 读某一天的快照。读不出（缺文件/坏 JSON/无条目）返回 null，不抛错：
 * 采集端把“没快照”当成“现抓”处理，而不是失败。
 *
 * @param {string} dir 归档目录
 * @param {string} day 'YYYY-MM-DD'
 * @returns {{ day: string, items: unknown[], topic: unknown } | null}
 */
function readDay(dir, day) {
  let raw;
  try {
    raw = fs.readFileSync(`${dir}/${day}.json`, 'utf8');
  } catch {
    return { ok: false, reason: 'missing' };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  const items = snapshotItems(data);
  if (!items) return { ok: false, reason: 'no-items' };
  return { ok: true, day, items, topic: data.topic ?? null };
}

export function loadArchiveDay(dir, day) {
  const r = readDay(dir, day);
  return r.ok ? { day: r.day, items: r.items, topic: r.topic } : null;
}

/**
 * 快照能不能用：主题必须对得上，绝不悄悄混主题。
 * - 快照没有可用的 topic 字段 → 不可用。
 * - 当前没有主题（label 为空）→ 不可用（无法核对）。
 * - 快照 preset 与当前 preset 都有值时必须相等；只有一边有 preset 时也不行。
 * - 两边都没有 preset 时，label 相等才算对上。
 *
 * @param {unknown} snapshotTopic 快照里的 topic
 * @param {{ label?: string | null, preset?: string | null } | null | undefined} current 当前主题
 */
export function archiveTopicMatches(snapshotTopic, current) {
  if (!snapshotTopic || typeof snapshotTopic !== 'object') return false;
  if (!current || typeof current.label !== 'string' || current.label === '') return false;
  const snapPreset = typeof snapshotTopic.preset === 'string' && snapshotTopic.preset !== '' ? snapshotTopic.preset : null;
  const curPreset = typeof current.preset === 'string' && current.preset !== '' ? current.preset : null;
  if (snapPreset !== null || curPreset !== null) return snapPreset !== null && snapPreset === curPreset;
  return typeof snapshotTopic.label === 'string' && snapshotTopic.label === current.label;
}

/**
 * 按请求日期读一窗口快照。返回已覆盖的日期、合并后的条目（按 URL 去重，
 * 快照之间常有重叠：allItems 会跨相邻日期）和跳过的日期及原因。
 *
 * @param {string} dir 归档目录
 * @param {string[]} days 请求的日期（'YYYY-MM-DD'）
 * @param {{ label?: string | null, preset?: string | null } | null | undefined} topic 当前主题
 * @returns {{ covered: string[], items: unknown[], skipped: { day: string, reason: string }[] }}
 */
export function loadArchiveWindow(dir, days, topic) {
  const covered = [];
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (const day of days) {
    const r = readDay(dir, String(day));
    if (!r.ok) {
      skipped.push({ day: String(day), reason: r.reason });
      continue;
    }
    if (!archiveTopicMatches(r.topic, topic)) {
      skipped.push({ day: String(day), reason: 'topic-mismatch' });
      continue;
    }
    covered.push(String(day));
    for (const it of r.items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      items.push(it);
    }
  }
  return { covered, items, skipped };
}
