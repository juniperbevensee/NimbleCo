/**
 * Open Measures API tools for social media data research and analysis
 *
 * Large results (1000+ posts) are automatically saved to ephemeral workspace.
 */

import { Tool } from '../base';
import { OpenMeasuresClient } from 'open-measures';
import { handleLargeResult } from '../storage/workspace';

/**
 * Get or create Open Measures client
 */
function getClient(apiKey?: string): OpenMeasuresClient {
  return new OpenMeasuresClient({
    apiKey: apiKey || process.env.OPEN_MEASURES_API_KEY,
  });
}

export const openMeasuresTools: Tool[] = [
  {
    name: 'search_social_media',
    description: 'Search for content across social media platforms (Telegram, Twitter, Reddit, etc.) using the Open Measures API. Returns posts, messages, and content matching your query.',
    category: 'research',
    use_cases: [
      'Research social media trends and conversations',
      'Analyze public discourse on a topic',
      'Track mentions of keywords or phrases',
      'Gather data for social science research',
      'Monitor online communities',
    ],
    parameters: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'Search query term or keyword',
        },
        site: {
          type: 'string',
          description: 'Platform to search: telegram, twitter, reddit, vk, etc. (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 100, max: 1000)',
        },
        from: {
          type: 'string',
          description: 'Start date for search results (ISO 8601 format, e.g., 2024-01-01)',
        },
        to: {
          type: 'string',
          description: 'End date for search results (ISO 8601 format)',
        },
      },
      required: ['term'],
    },
    handler: async (input: any, context: any) => {
      const { term, site, limit, from, to } = input;

      if (!term) {
        return {
          success: false,
          error: 'Search term is required',
        };
      }

      try {
        const client = getClient(context.credentials?.open_measures_api_key);

        const params: any = {
          term,
          limit: limit || 100,
        };

        if (site) params.site = site;
        if (from) params.from = from;
        if (to) params.to = to;

        const response = await client.content(params);

        const result = {
          success: true,
          total: response.total_hits || 0,
          results: response.results || [],
          query: term,
          platform: site || 'all',
        };

        // Auto-save large results to ephemeral workspace
        return handleLargeResult(result, { filenamePrefix: 'openmeasures-search' });
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  },
  {
    name: 'get_social_media_timeseries',
    description: 'Get time-series data for social media content, showing activity over time. Useful for analyzing trends and patterns.',
    category: 'research',
    use_cases: [
      'Analyze activity trends over time',
      'Identify spikes in conversations',
      'Track topic growth or decline',
      'Generate time-based charts and reports',
    ],
    parameters: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'Search query term or keyword',
        },
        site: {
          type: 'string',
          description: 'Platform to analyze: telegram, twitter, reddit, vk, etc. (optional)',
        },
        interval: {
          type: 'string',
          description: 'Time interval: hour, day, week, month (default: day)',
        },
        from: {
          type: 'string',
          description: 'Start date (ISO 8601 format)',
        },
        to: {
          type: 'string',
          description: 'End date (ISO 8601 format)',
        },
      },
      required: ['term'],
    },
    handler: async (input: any, context: any) => {
      const { term, site, interval, from, to } = input;

      if (!term) {
        return {
          success: false,
          error: 'Search term is required',
        };
      }

      try {
        const client = getClient(context.credentials?.open_measures_api_key);

        const params: any = {
          term,
          interval: interval || 'day',
        };

        if (site) params.site = site;
        if (from) params.from = from;
        if (to) params.to = to;

        const response = await client.timeseries(params);

        return {
          success: true,
          buckets: response.aggregations?.over_time?.buckets || [],
          query: term,
          interval: interval || 'day',
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  },
  {
    name: 'get_social_media_actors',
    description: 'Find the most active or influential accounts/actors for a topic. Useful for identifying key voices and communities.',
    category: 'research',
    use_cases: [
      'Identify influential accounts on a topic',
      'Find active participants in discussions',
      'Analyze community structure',
      'Discover key opinion leaders',
    ],
    parameters: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'Search query term or keyword',
        },
        site: {
          type: 'string',
          description: 'Platform to analyze: telegram, twitter, reddit, vk, etc. (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of actors to return (default: 50)',
        },
      },
      required: ['term'],
    },
    handler: async (input: any, context: any) => {
      const { term, site, limit } = input;

      if (!term) {
        return {
          success: false,
          error: 'Search term is required',
        };
      }

      try {
        const client = getClient(context.credentials?.open_measures_api_key);

        const params: any = {
          term,
          limit: limit || 50,
        };

        if (site) params.site = site;

        const response = await client.actors(params);

        return {
          success: true,
          actors: response.results || [],
          total: response.total_hits || 0,
          query: term,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  },
];
