/**
 * Open Measures API tools for social media data research and analysis
 *
 * Large results (1000+ posts) are automatically saved to ephemeral workspace.
 */

import { Tool } from '../base';
import { OpenMeasuresClient } from 'open-measures';
import { handleLargeResult } from '../storage/workspace';
import { initializeTokenManager, getValidAccessToken, isInitialized } from './openmeasures-token-manager';
import { InputSanitizer } from '../sanitization';

/**
 * Get or create Open Measures client with automatic token refresh
 */
async function getClient(apiKey?: string, timeout?: number): Promise<OpenMeasuresClient> {
  // Filter out empty strings - treat them as undefined
  const providedKey = (apiKey && apiKey.trim()) || process.env.OPEN_MEASURES_API_KEY;
  const refreshToken = process.env.OPEN_MEASURES_REFRESH_TOKEN;

  if (!providedKey) {
    console.log('⚠️  OPEN_MEASURES_API_KEY not found in context.credentials or process.env');
    throw new Error('OPEN_MEASURES_API_KEY required');
  }

  // Initialize token manager if not already done
  if (!isInitialized() && refreshToken) {
    console.log('🔧 Initializing Open Measures token manager with refresh support');
    initializeTokenManager(providedKey, refreshToken);
  }

  // Get a valid token (will auto-refresh if needed)
  let validToken: string;
  if (isInitialized()) {
    validToken = await getValidAccessToken();
  } else {
    // No refresh token available, use provided token directly
    console.log('⚠️  No OPEN_MEASURES_REFRESH_TOKEN found - token will not auto-refresh');
    validToken = providedKey;
  }

  return new OpenMeasuresClient({
    apiKey: validToken,
    timeout: timeout || 30000, // Default 30s, can be overridden
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
        const client = await getClient(context.credentials?.open_measures_api_key);

        const params: any = {
          term,
          limit: limit || 100,
        };

        if (site) params.site = site;
        if (from) params.from = from;
        if (to) params.to = to;

        const response = await client.content(params);

        // Sanitize social media content for prompt injection protection
        const sanitizedResults = (response.results || []).map((post: any) => {
          const sanitized = InputSanitizer.sanitize(post.text || '', {
            stripHtml: true,
            removeControlChars: true,
            removeZeroWidth: true,
            normalizeUnicode: true,
            detectSuspiciousPatterns: true,
            maxLength: 5000, // Social posts are shorter
          });

          // Log high-risk social media content
          if (sanitized.flagged) {
            const injectionScore = InputSanitizer.detectInjection(post.text || '');
            if (injectionScore.score > 0.6) {
              console.warn(
                '🚨 HIGH RISK social media content detected:',
                `Platform: ${post.site || 'unknown'}`,
                `Score: ${injectionScore.score.toFixed(2)}`,
                `Flags: ${sanitized.flags.join(', ')}`,
                `Preview: ${(post.text || '').substring(0, 100)}...`
              );
            }
          }

          return {
            ...post,
            text: sanitized.sanitized,
            _injection_risk: sanitized.flagged ? InputSanitizer.detectInjection(post.text || '').score : 0,
          };
        });

        const result = {
          success: true,
          total: response.total_hits || 0,
          results: sanitizedResults,
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
        const client = await getClient(context.credentials?.open_measures_api_key);

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
    description: 'Count and rank the most active users/actors for a topic across social media. Returns aggregated counts of who is posting most. Perfect for creating bar charts of top users, analyzing who shares content most, and identifying influential accounts. Native API aggregation - much faster than processing JSON files locally.',
    category: 'research',
    use_cases: [
      'Create bar chart of users most sharing about a topic',
      'Count posts per user/actor and rank them',
      'Identify influential accounts on a topic',
      'Find active participants in discussions',
      'Analyze community structure and top contributors',
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
        const client = await getClient(context.credentials?.open_measures_api_key);

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
  {
    name: 'get_user_activity_for_topic',
    description: '⚠️ USE THIS for "users posting most about X" queries! Aggregates which users posted the MOST about a search term. Returns counts of posts per user. Perfect for bar charts showing top posters/sharers for a topic. This is NOT searching for usernames - it searches post content and counts by user.',
    category: 'research',
    use_cases: [
      'Create bar chart of users posting most about a topic',
      'Count which users share content most about a term',
      'Find most active posters discussing a keyword',
      'Rank users by activity on a topic',
      'Aggregate user activity for a search query',
    ],
    parameters: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'Search term to find in post content (e.g., "openclaw")',
        },
        site: {
          type: 'string',
          description: 'Platform: telegram, twitter, reddit, etc.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of users to return (default: 50, max: 50 for performance)',
        },
        from: {
          type: 'string',
          description: 'Start date (ISO 8601)',
        },
        to: {
          type: 'string',
          description: 'End date (ISO 8601)',
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
        // Use longer timeout (120s) for aggregation queries
        const client = await getClient(context.credentials?.open_measures_api_key, 120000);

        console.log(`🔍 OpenMeasures activity query: term="${term}", site="${site || 'all'}", agg_size=${limit || 50}`);
        console.log(`   Client tier: ${client.tier}`);

        const params: any = {
          term,
          standard_fields: true,
          agg_by: 'actor.username', // Aggregate by user
          aggregation_size: Math.min(limit || 50, 50), // Cap at 50 for performance
        };

        if (site) params.site = site;
        if (from) params.since = from;
        if (to) params.until = to;

        console.log(`   API params:`, JSON.stringify(params));

        const response = await client.activity(params);

        // Extract buckets from aggregations
        // The aggregation key is the field name we aggregated by, not 'agg'
        const aggKey = Object.keys(response.aggregations || {})[0];
        const buckets = aggKey ? ((response.aggregations[aggKey] as any)?.buckets || []) : [];

        console.log(`   Response: ${Object.keys(response.aggregations || {}).length} aggregation keys`);
        console.log(`   Buckets in '${aggKey || 'none'}': ${buckets.length}`);

        return {
          success: true,
          users: buckets.map((bucket: any) => ({
            username: bucket.key,
            post_count: bucket.doc_count,
          })),
          total: buckets.length,
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
  {
    name: 'get_channel_activity_for_topic',
    description: 'Aggregate which channels/groups posted the MOST about a search term. Returns counts of posts per channel. Perfect for finding most active channels discussing a topic.',
    category: 'research',
    use_cases: [
      'Find channels posting most about a topic',
      'Count channel activity for a keyword',
      'Identify most active channels for a discussion',
      'Rank channels by posts about a term',
    ],
    parameters: {
      type: 'object',
      properties: {
        term: {
          type: 'string',
          description: 'Search term to find in post content',
        },
        site: {
          type: 'string',
          description: 'Platform: telegram, twitter, reddit, etc.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of channels to return (default: 50, max: 50 for performance)',
        },
        from: {
          type: 'string',
          description: 'Start date (ISO 8601)',
        },
        to: {
          type: 'string',
          description: 'End date (ISO 8601)',
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
        // Use longer timeout (120s) for aggregation queries
        const client = await getClient(context.credentials?.open_measures_api_key, 120000);

        console.log(`🔍 OpenMeasures activity query: term="${term}", site="${site || 'all'}", agg_size=${limit || 50}`);
        console.log(`   Client tier: ${client.tier}`);

        const params: any = {
          term,
          standard_fields: true,
          agg_by: 'context.username', // Aggregate by channel/group
          aggregation_size: Math.min(limit || 50, 50), // Cap at 50 for performance
        };

        if (site) params.site = site;
        if (from) params.since = from;
        if (to) params.until = to;

        console.log(`   API params:`, JSON.stringify(params));

        const response = await client.activity(params);

        // Extract buckets from aggregations
        // The aggregation key is the field name we aggregated by, not 'agg'
        const aggKey = Object.keys(response.aggregations || {})[0];
        const buckets = aggKey ? ((response.aggregations[aggKey] as any)?.buckets || []) : [];

        console.log(`   Response: ${Object.keys(response.aggregations || {}).length} aggregation keys`);
        console.log(`   Buckets in '${aggKey || 'none'}': ${buckets.length}`);

        return {
          success: true,
          channels: buckets.map((bucket: any) => ({
            channel: bucket.key,
            post_count: bucket.doc_count,
          })),
          total: buckets.length,
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
