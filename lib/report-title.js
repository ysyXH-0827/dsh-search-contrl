/**
 * Report title templates.
 *
 * A report title used to be hard-coded ("科技日报｜日期") inside the skill body and
 * inside scripts/archive-digest.mjs, so a user searching anything else still got a
 * technology headline. The template lives in settings.json now, and both the skill
 * body and the scripts render it through this one helper, which keeps the
 * placeholder set and the empty-topic cleanup identical on every path.
 */

/** @type {string} */
export const DEFAULT_REPORT_TITLE = '{主题}{类型}｜{日期}';

/** Hard cap: a title longer than this is a paragraph, not a title. */
export const MAX_TITLE_LENGTH = 120;

/** Placeholders the settings page offers as click-to-insert chips. */
export const TITLE_TOKENS = [
  { token: '{主题}', label: '主题', sample: 'AI' },
  { token: '{类型}', label: '报告类型', sample: '日报' },
  { token: '{日期}', label: '日期', sample: '2026-10-24' },
];

/**
 * Report kind from the window length. Kept deliberately coarse: the scripts only
 * need a word for the title, and inventing a new word for a 10-day window would
 * surprise users.
 *
 * @param {number} days
 * @returns {string}
 */
export function kindForDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 1) return '日报';
  if (n <= 7) return '周报';
  return '月报';
}

/**
 * Normalise a template coming from the GUI (or from an old settings file).
 *
 * Empty/blank falls back to the default so a user who clears the field still gets
 * a titled report instead of a bare date.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTitleTemplate(raw) {
  if (typeof raw !== 'string') return DEFAULT_REPORT_TITLE;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return DEFAULT_REPORT_TITLE;
  return text.slice(0, MAX_TITLE_LENGTH);
}

/**
 * Render a template for one report.
 *
 * An empty topic placeholder is the normal case (no topic configured): it simply
 * disappears, and the separator it leaves behind is trimmed, so the default
 * template renders as "日报｜2026-10-24" instead of "｜日报｜2026-10-24".
 *
 * @param {unknown} template
 * @param {{ topic?: string, date?: string, days?: number }} [options]
 * @returns {string}
 */
export function renderTitle(template, options = {}) {
  const text = normalizeTitleTemplate(template);
  const topic = typeof options.topic === 'string' ? options.topic.trim() : '';
  const date = typeof options.date === 'string' ? options.date.trim() : '';
  const kind = kindForDays(options.days ?? 1);
  const out = text
    .replace(/\{主题\}/g, topic)
    .replace(/\{类型\}/g, kind)
    .replace(/\{日期\}/g, date)
    // Collapse the gaps an empty placeholder leaves behind.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([｜|·—/-])\s*(?=[｜|·—/-])/g, '$1')
    .replace(/^[\s｜|·—/-]+/, '')
    .replace(/[\s｜|·—/-]+$/, '')
    .trim();
  if (out === '') return date || kind;
  return out.slice(0, MAX_TITLE_LENGTH);
}

/** Placeholders a template actually uses; the settings page shows a live preview. */
export function describeTemplate(template) {
  const text = normalizeTitleTemplate(template);
  return TITLE_TOKENS.map(item => item.token).filter(token => text.includes(token));
}
