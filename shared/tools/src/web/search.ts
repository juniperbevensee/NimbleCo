/**
 * Web Search Tool using Brave Search API
 *
 * Security measures:
 * - Results wrapped in <untrusted_web_content> to mitigate prompt injection
 * - GET-only requests (no POST/PUT/DELETE) to prevent data exfiltration
 * - No cookies or auth headers sent to search results
 * - Content length limits to prevent token exhaustion attacks
 */

import { Tool } from '../base';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const MAX_RESULTS = 10;
const MAX_SNIPPET_LENGTH = 500;

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  extra_snippets?: string[];
}

interface BraveSearchResponse {
  query: {
    original: string;
  };
  web?: {
    results: BraveSearchResult[];
  };
  news?: {
    results: BraveSearchResult[];
  };
}

/**
 * Wrap content in untrusted markers to mitigate prompt injection
 * The LLM should be instructed to treat this content as data, not instructions
 */
function wrapUntrustedContent(content: string, source: string): string {
  return `<untrusted_web_content source="${source}">
${content}
</untrusted_web_content>`;
}

/**
 * Sanitize and truncate text to prevent token exhaustion
 */
function sanitizeSnippet(text: string | undefined, maxLength: number = MAX_SNIPPET_LENGTH): string {
  if (!text) return '';
  // Remove potential injection attempts (HTML tags, control chars)
  const cleaned = text
    .replace(/<[^>]*>/g, '')  // Strip HTML
    .replace(/[\x00-\x1f]/g, ' ')  // Remove control characters
    .trim();

  if (cleaned.length > maxLength) {
    return cleaned.substring(0, maxLength) + '...';
  }
  return cleaned;
}

/**
 * Perform web search via Brave Search API
 */
async function braveSearch(
  query: string,
  options: { count?: number; freshness?: string } = {}
): Promise<{ results: BraveSearchResult[]; query: string }> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY not configured. Get a free key at https://brave.com/search/api/');
  }

  const count = Math.min(options.count || 5, MAX_RESULTS);

  const params = new URLSearchParams({
    q: query,
    count: count.toString(),
    text_decorations: 'false',  // No HTML in results
    safesearch: 'moderate',
  });

  // Add freshness filter if specified
  if (options.freshness) {
    params.append('freshness', options.freshness);
  }

  // GET-only request - no ability to POST data out
  const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
    method: 'GET',  // Explicitly GET only
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
    // No body allowed on GET
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brave Search API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as BraveSearchResponse;

  // Combine web and news results
  const webResults = data.web?.results || [];
  const newsResults = data.news?.results || [];
  const allResults = [...webResults, ...newsResults].slice(0, count);

  return {
    query: data.query.original,
    results: allResults,
  };
}

export const webSearchTools: Tool[] = [
  {
    name: 'web_search',
    description: 'Search the web using Brave Search. Returns titles, URLs, and snippets from search results. Use this for general web searches, finding current information, researching topics, or discovering relevant websites. Results are from the open web, not specialized databases.',
    category: 'web',
    use_cases: [
      'Search the web for information',
      'Find current news and articles',
      'Research topics and questions',
      'Discover websites and resources',
      'Get general information from the internet',
      'Find answers to factual questions',
    ],
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query (what to search for)',
        },
        count: {
          type: 'number',
          description: 'Number of results to return (1-10, default: 5)',
        },
        freshness: {
          type: 'string',
          enum: ['pd', 'pw', 'pm', 'py'],
          description: 'Filter by freshness: pd=past day, pw=past week, pm=past month, py=past year',
        },
      },
      required: ['query'],
    },
    requiredEnv: ['BRAVE_SEARCH_API_KEY'],
    handler: async (input: { query: string; count?: number; freshness?: string }) => {
      try {
        const { query, count, freshness } = input;

        if (!query || query.trim().length === 0) {
          return {
            success: false,
            error: 'Search query cannot be empty',
          };
        }

        const searchResults = await braveSearch(query, { count, freshness });

        // Format results with sanitization
        const formattedResults = searchResults.results.map((result, i) => {
          const title = sanitizeSnippet(result.title, 200);
          const description = sanitizeSnippet(result.description);
          const url = result.url;  // URLs are safe
          const age = result.age || '';

          return `[${i + 1}] ${title}
    URL: ${url}
    ${age ? `Age: ${age}\n    ` : ''}${description}`;
        }).join('\n\n');

        // Wrap in untrusted content markers
        const wrappedResults = wrapUntrustedContent(
          formattedResults || 'No results found.',
          `brave_search:${query}`
        );

        return {
          success: true,
          query: searchResults.query,
          result_count: searchResults.results.length,
          results: wrappedResults,
          // Also provide structured data for programmatic use
          structured_results: searchResults.results.map(r => ({
            title: sanitizeSnippet(r.title, 200),
            url: r.url,
            snippet: sanitizeSnippet(r.description),
          })),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  },
];
