/**
 * Configuration surface for the tech daily report plugin.
 *
 * The Tavily API key lives here rather than in code so the Host validates it
 * against the profile patch and can generate a settings page from the same
 * schema. Every field is volatile: a settings write commits into the running
 * plugin's references instead of remounting the row, so the runtime reads
 * through effectiveConfig at call time.
 *
 * @module dsh-search-contrl/config
 */
import z from '@deepseek-ai/schemastery';

/** Schemastery schema backing the profile patch values and the settings page. */
export const Config = z.object({
  tavilyApiKey: z.string()
    .default('')
    .role('secret')
    .volatile()
    .description('Tavily API key (tvly-...). Free tier offers 1000 credits per month at https://www.tavily.com/. Leave blank to run search on the keyless Bing channel only; page extraction still needs a key.'),
  searchProvider: z.union(['auto', 'bing', 'tavily'])
    .default('auto')
    .volatile()
    .description("Search provider: 'auto' tries the keyless Bing channel first and falls back to Tavily when a key is set; 'bing' is free but returns snippets; 'tavily' returns an AI answer and richer content for 1 credit per call."),
  bingMarket: z.string()
    .default('zh-CN')
    .volatile()
    .description("Bing market for the keyless channel (for example 'zh-CN' or 'en-US')."),
  searchDepth: z.union(['basic', 'advanced'])
    .default('basic')
    .volatile()
    .description("Tavily search depth: 'basic' costs 1 credit per call, 'advanced' costs 2 and returns richer context."),
  maxResults: z.natural()
    .min(1)
    .max(20)
    .default(8)
    .volatile()
    .description('Maximum results returned per search call.'),
  timeoutMs: z.natural()
    .min(5000)
    .max(120000)
    .default(45000)
    .volatile()
    .description('HTTP timeout per Tavily request, in milliseconds.'),
  historyLimit: z.natural()
    .min(5)
    .max(100)
    .default(20)
    .volatile()
    .description('How many previous versions of the GUI settings are kept for rollback. Every save, reset and restore snapshots the version it replaces; the oldest snapshots beyond this limit are deleted.'),
});

/**
 * Resolve the effective config with defaults applied. Volatile fields arrive
 * as live references, so this reads the last committed value rather than a
 * snapshot taken at mount time.
 *
 * @param {Record<string, { get?: () => unknown } | undefined> | undefined} config
 * @returns {{ tavilyApiKey: string, searchProvider: 'auto' | 'bing' | 'tavily', bingMarket: string, searchDepth: 'basic' | 'advanced', maxResults: number, timeoutMs: number, historyLimit: number }}
 */
export function effectiveConfig(config) {
  const read = (key, fallback) => {
    const value = config?.[key]?.get?.();
    return value === undefined || value === null || value === '' ? fallback : value;
  };
  const provider = read('searchProvider', 'auto');
  const historyLimit = Number(read('historyLimit', 20));
  return {
    tavilyApiKey: String(read('tavilyApiKey', '')).trim(),
    searchProvider: provider === 'bing' || provider === 'tavily' ? provider : 'auto',
    bingMarket: String(read('bingMarket', 'zh-CN')).trim() || 'zh-CN',
    searchDepth: read('searchDepth', 'basic') === 'advanced' ? 'advanced' : 'basic',
    maxResults: Number(read('maxResults', 8)),
    timeoutMs: Number(read('timeoutMs', 45000)),
    historyLimit: Number.isInteger(historyLimit) && historyLimit >= 5 ? Math.min(historyLimit, 100) : 20,
  };
}
