/**
 * The plugin search tool. Registers as `tech_daily_search` when a Tavily key
 * is configured, making the Tavily direct adapter available to agents without
 * relying on DSH's web_search. Refuses all calls when the key is blank.
 *
 * @module dsh-tech-daily-report/search-tool
 */
import { tavilySearch, tavilyExtract } from './tavily.js';

/** The registered tool name. */
export const TECH_DAILY_SEARCH_TOOL = 'tech_daily_search';

/**
 * Build the tool definition bound to one effectiveConfig function.
 *
 * @param {() => { tavilyApiKey: string, searchDepth: 'basic' | 'advanced', maxResults: number, timeoutMs: number }} getConfig
 * @returns {Object} tool definition ready for ctx.tools.register
 */
export function buildSearchTool(getConfig) {
  return {
    name: TECH_DAILY_SEARCH_TOOL,
    description: [
      'Search the web for technology news using Tavily.',
      'Supports natural language queries and returns AI-generated answers plus ranked results with URLs, titles, and snippets.',
      'Use this when the built-in web search is unavailable or when you need direct vendor page extraction.',
      'The extract action bypasses navigation-heavy pages and returns full text.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'extract'],
          description: "The operation to perform: 'search' for web search, 'extract' to pull full content from URLs.",
        },
        query: {
          type: 'string',
          description: 'search: natural language query describing what to find.',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'extract: 1 to 20 URLs to extract full content from.',
        },
        include_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'search: optional allowlist of domains to search within.',
        },
        exclude_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'search: optional blocklist of domains to exclude.',
        },
        include_raw_content: {
          type: 'boolean',
          description: 'search: whether to return full page HTML (costs more credits).',
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: 60_000,
    async execute(args, exec) {
      const input = typeof args === 'object' && args !== null ? args : {};
      const config = getConfig();

      if (!config.tavilyApiKey) {
        return {
          ok: false,
          error: 'tech_daily_search requires a Tavily API key. Set it in the plugin settings (https://www.tavily.com/ offers 1000 free credits/month).',
        };
      }

      switch (input.action) {
        case 'search': {
          if (typeof input.query !== 'string' || input.query.trim() === '') {
            return { ok: false, error: 'search requires a query string' };
          }

          const result = await tavilySearch(
            config.tavilyApiKey,
            {
              query: input.query.trim(),
              search_depth: config.searchDepth,
              max_results: config.maxResults,
              include_answer: true,
              include_raw_content: input.include_raw_content === true,
              include_domains: Array.isArray(input.include_domains) ? input.include_domains : undefined,
              exclude_domains: Array.isArray(input.exclude_domains) ? input.exclude_domains : undefined,
            },
            exec.signal,
            config.timeoutMs
          );

          if (!result.ok) {
            return { ok: false, error: result.error };
          }

          return {
            ok: true,
            answer: result.data.answer,
            results: result.data.results.map(r => ({
              url: r.url,
              title: r.title,
              content: r.content,
              score: r.score,
              published_date: r.published_date,
            })),
            query: result.data.query,
            response_time: result.data.response_time,
          };
        }

        case 'extract': {
          if (!Array.isArray(input.urls) || input.urls.length === 0 || input.urls.length > 20) {
            return { ok: false, error: 'extract requires 1 to 20 URLs in the urls array' };
          }

          const result = await tavilyExtract(
            config.tavilyApiKey,
            input.urls,
            exec.signal,
            config.timeoutMs
          );

          if (!result.ok) {
            return { ok: false, error: result.error };
          }

          return {
            ok: true,
            results: result.data.results.map(r => ({
              url: r.url,
              content: r.raw_content,
            })),
            failed_results: result.data.failed_results,
          };
        }

        default:
          return { ok: false, error: "action must be 'search' or 'extract'" };
      }
    },
  };
}
