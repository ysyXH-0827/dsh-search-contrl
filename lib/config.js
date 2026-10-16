/**
 * Configuration surface for the tech daily report plugin.
 *
 * The Tavily API key lives here rather than in code so the Host validates it
 * against the profile patch and can generate a settings page from the same
 * schema. Every field is volatile: a settings write commits into the running
 * plugin's references instead of remounting the row, so the runtime reads
 * through effectiveConfig at call time.
 *
 * @module dsh-tech-daily-report/config
 */
import z from '@deepseek-ai/schemastery';

/** Schemastery schema backing the profile patch values and the settings page. */
export const Config = z.object({
  tavilyApiKey: z.string()
    .default('')
    .role('secret')
    .volatile()
    .description('Tavily API key (tvly-...). Free tier offers 1000 credits per month at https://www.tavily.com/. Leave blank to disable the direct search tool.'),
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
});

/**
 * Resolve the effective config with defaults applied. Volatile fields arrive
 * as live references, so this reads the last committed value rather than a
 * snapshot taken at mount time.
 *
 * @param {Record<string, { get?: () => unknown } | undefined> | undefined} config
 * @returns {{ tavilyApiKey: string, searchDepth: 'basic' | 'advanced', maxResults: number, timeoutMs: number }}
 */
export function effectiveConfig(config) {
  const read = (key, fallback) => {
    const value = config?.[key]?.get?.();
    return value === undefined || value === null || value === '' ? fallback : value;
  };
  return {
    tavilyApiKey: String(read('tavilyApiKey', '')).trim(),
    searchDepth: read('searchDepth', 'basic') === 'advanced' ? 'advanced' : 'basic',
    maxResults: Number(read('maxResults', 8)),
    timeoutMs: Number(read('timeoutMs', 45000)),
  };
}
