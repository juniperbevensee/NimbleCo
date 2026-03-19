/**
 * Invocation and tool call analysis tools
 *
 * Permission model:
 * - Regular users: Can analyze any room they're in
 * - Admins: Can analyze any room, but ONLY from a DM (prevents leaking content into shared rooms)
 */

import { Tool } from '../base';
import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Get or create database connection pool
 */
function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export const invocationAnalyticsTools: Tool[] = [
  {
    name: 'view_recent_invocations',
    description: 'View recent agent invocation logs in a room with summary (tool calls, LLM calls, cost, execution history)',
    category: 'storage',
    use_cases: [
      'Analyze agent execution logs',
      'Review recent agent activity and tasks',
      'See what the agent has been working on',
      'Debug issues with recent invocations',
      'View agent logs and execution history',
    ],
    parameters: {
      type: 'object',
      properties: {
        room_id: {
          type: 'string',
          description: 'Room to analyze (optional - defaults to current room)',
        },
        bot_id: {
          type: 'string',
          description: 'Filter by bot ID (e.g., "personal", "osint", "cryptid") - optional',
        },
        limit: {
          type: 'number',
          description: 'Number of invocations to return (default: 10, max: 50)',
        },
        status: {
          type: 'string',
          description: 'Filter by status: running, completed, failed',
        },
      },
      required: [],
    },
    permissions: {
      requiresContextRoom: true,
      sensitiveReason: 'Accesses conversation history - users can analyze rooms they\'re in, admins can analyze any room from DM',
    },
    handler: async (input: any, context: any) => {
      try {
        const db = getPool();
        const limit = Math.min(input.limit || 10, 50);
        const targetRoomId = input.room_id || context.room_id;

        if (!targetRoomId) {
          return {
            success: false,
            error: 'room_id required (either in parameters or from current room context)',
          };
        }

        let query = `
          SELECT * FROM v_recent_invocations
          WHERE room_id = $1
        `;

        const params: any[] = [targetRoomId];
        let paramCount = 2;

        if (input.bot_id) {
          query += ` AND bot_id = $${paramCount}`;
          params.push(input.bot_id);
          paramCount++;
        }

        if (input.status) {
          query += ` AND status = $${paramCount}`;
          params.push(input.status);
          paramCount++;
        }

        query += ` ORDER BY started_at DESC LIMIT $${paramCount}`;
        params.push(limit);

        const result = await db.query(query, params);

        if (result.rows.length === 0) {
          return {
            success: true,
            message: 'No invocations found in this room',
            invocations: [],
          };
        }

        return {
          success: true,
          room_id: targetRoomId,
          bot_id: input.bot_id || 'all',
          total: result.rows.length,
          invocations: result.rows.map(row => ({
            id: row.id,
            bot_id: row.bot_id,
            trigger_user: row.trigger_user_id,
            input: row.input_message?.substring(0, 200),
            status: row.status,
            output: row.output_message?.substring(0, 200),
            error: row.error,
            started_at: row.started_at,
            completed_at: row.completed_at,
            duration_ms: row.duration_ms,
            tool_calls: row.tool_call_count,
            llm_calls: row.llm_call_count,
            tokens: {
              input: row.total_input_tokens,
              output: row.total_output_tokens,
              total: row.total_input_tokens + row.total_output_tokens,
            },
            cost_usd: parseFloat(row.total_cost_usd) || 0,
          })),
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
    name: 'view_invocation_details',
    description: 'Get detailed breakdown of a specific invocation (all tool calls, LLM calls, timing)',
    category: 'storage',
    use_cases: [
      'Debug a specific invocation',
      'See what tools were used',
      'Analyze LLM usage in a task',
      'Review execution timeline',
    ],
    parameters: {
      type: 'object',
      properties: {
        invocation_id: {
          type: 'string',
          description: 'Invocation ID to analyze',
        },
      },
      required: ['invocation_id'],
    },
    permissions: {
      requiresContextRoom: true,
      sensitiveReason: 'Accesses detailed execution logs',
    },
    handler: async (input: any, context: any) => {
      try {
        const db = getPool();
        const { invocation_id } = input;

        // Get invocation details
        const invResult = await db.query(
          `SELECT * FROM v_recent_invocations WHERE id = $1`,
          [invocation_id]
        );

        if (invResult.rows.length === 0) {
          return {
            success: false,
            error: 'Invocation not found',
          };
        }

        const invocation = invResult.rows[0];

        // Get tool calls
        const toolResult = await db.query(
          `
          SELECT
            id,
            tool_name,
            input,
            output,
            error,
            status,
            started_at,
            completed_at,
            duration_ms
          FROM tool_calls
          WHERE invocation_id = $1
          ORDER BY started_at ASC
          `,
          [invocation_id]
        );

        // Get LLM calls
        const llmResult = await db.query(
          `
          SELECT
            id,
            provider,
            model,
            input_messages,
            output_content,
            tool_use,
            input_tokens,
            output_tokens,
            cost_usd,
            started_at,
            completed_at,
            duration_ms
          FROM llm_calls
          WHERE invocation_id = $1
          ORDER BY started_at ASC
          `,
          [invocation_id]
        );

        return {
          success: true,
          invocation: {
            id: invocation.id,
            room_id: invocation.room_id,
            trigger_user: invocation.trigger_user_id,
            input: invocation.input_message,
            status: invocation.status,
            output: invocation.output_message,
            error: invocation.error,
            started_at: invocation.started_at,
            completed_at: invocation.completed_at,
            duration_ms: invocation.duration_ms,
            cost_usd: parseFloat(invocation.total_cost_usd) || 0,
          },
          tool_calls: toolResult.rows.map(row => ({
            id: row.id,
            tool_name: row.tool_name,
            input: row.input,
            output: row.output,
            error: row.error,
            status: row.status,
            duration_ms: row.duration_ms,
            started_at: row.started_at,
            completed_at: row.completed_at,
          })),
          llm_calls: llmResult.rows.map(row => ({
            id: row.id,
            provider: row.provider,
            model: row.model,
            input_messages: row.input_messages,
            output_content: row.output_content?.substring(0, 500),
            tool_use: row.tool_use,
            tokens: {
              input: row.input_tokens,
              output: row.output_tokens,
            },
            cost_usd: parseFloat(row.cost_usd) || 0,
            duration_ms: row.duration_ms,
            started_at: row.started_at,
            completed_at: row.completed_at,
          })),
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
    name: 'analyze_tool_usage',
    description: 'Analyze tool usage patterns in a room or globally (most used tools, success rates, timing)',
    category: 'storage',
    use_cases: [
      'See which tools are used most',
      'Identify failing tools',
      'Analyze tool performance',
      'Optimize agent workflows',
    ],
    parameters: {
      type: 'object',
      properties: {
        room_id: {
          type: 'string',
          description: 'Analyze specific room (optional - omit for global stats)',
        },
        bot_id: {
          type: 'string',
          description: 'Filter by bot ID (e.g., "personal", "osint", "cryptid") - optional',
        },
        days: {
          type: 'number',
          description: 'Number of days to analyze (default: 7, max: 30)',
        },
      },
      required: [],
    },
    permissions: {
      requiresContextRoom: true,
      sensitiveReason: 'Accesses tool usage statistics',
    },
    handler: async (input: any, context: any) => {
      try {
        const db = getPool();
        const days = Math.min(input.days || 7, 30);
        const targetRoomId = input.room_id;
        const targetBotId = input.bot_id;

        let query = `
          SELECT
            tc.tool_name,
            COUNT(*) as total_calls,
            COUNT(CASE WHEN tc.status = 'success' THEN 1 END) as successful_calls,
            COUNT(CASE WHEN tc.status = 'failed' THEN 1 END) as failed_calls,
            AVG(tc.duration_ms) as avg_duration_ms,
            MAX(tc.started_at) as last_used_at
          FROM tool_calls tc
        `;

        const params: any[] = [];
        let paramCount = 1;

        if (targetRoomId || targetBotId) {
          query += `
            JOIN invocations i ON tc.invocation_id = i.id
            JOIN conversations c ON i.conversation_id = c.id
            WHERE tc.started_at > NOW() - INTERVAL '${days} days'
          `;

          if (targetRoomId) {
            query += ` AND c.room_id = $${paramCount}`;
            params.push(targetRoomId);
            paramCount++;
          }

          if (targetBotId) {
            query += ` AND i.bot_id = $${paramCount}`;
            params.push(targetBotId);
            paramCount++;
          }
        } else {
          query += ` WHERE tc.started_at > NOW() - INTERVAL '${days} days'`;
        }

        query += `
          GROUP BY tc.tool_name
          ORDER BY total_calls DESC
        `;

        const result = await db.query(query, params);

        return {
          success: true,
          room_id: targetRoomId || 'all_rooms',
          bot_id: targetBotId || 'all_bots',
          days_analyzed: days,
          tools: result.rows.map(row => ({
            tool_name: row.tool_name,
            total_calls: parseInt(row.total_calls),
            successful_calls: parseInt(row.successful_calls),
            failed_calls: parseInt(row.failed_calls),
            success_rate: ((parseInt(row.successful_calls) / parseInt(row.total_calls)) * 100).toFixed(1) + '%',
            avg_duration_ms: parseFloat(row.avg_duration_ms)?.toFixed(0),
            last_used_at: row.last_used_at,
          })),
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
    name: 'analyze_llm_usage',
    description: 'Analyze LLM usage patterns (models used, token consumption, costs)',
    category: 'storage',
    use_cases: [
      'Track LLM costs per room',
      'See which models are used most',
      'Analyze token usage',
      'Optimize model selection',
    ],
    parameters: {
      type: 'object',
      properties: {
        room_id: {
          type: 'string',
          description: 'Analyze specific room (optional - omit for global stats)',
        },
        bot_id: {
          type: 'string',
          description: 'Filter by bot ID (e.g., "personal", "osint", "cryptid") - optional',
        },
        days: {
          type: 'number',
          description: 'Number of days to analyze (default: 7, max: 30)',
        },
      },
      required: [],
    },
    permissions: {
      requiresContextRoom: true,
      sensitiveReason: 'Accesses LLM usage and cost data',
    },
    handler: async (input: any, context: any) => {
      try {
        const db = getPool();
        const days = Math.min(input.days || 7, 30);
        const targetRoomId = input.room_id;
        const targetBotId = input.bot_id;

        let query = `
          SELECT
            lc.provider,
            lc.model,
            COUNT(*) as total_calls,
            SUM(lc.input_tokens) as total_input_tokens,
            SUM(lc.output_tokens) as total_output_tokens,
            SUM(lc.cost_usd) as total_cost_usd,
            AVG(lc.duration_ms) as avg_duration_ms
          FROM llm_calls lc
        `;

        const params: any[] = [];
        let paramCount = 1;

        if (targetRoomId || targetBotId) {
          query += `
            JOIN invocations i ON lc.invocation_id = i.id
            JOIN conversations c ON i.conversation_id = c.id
            WHERE lc.started_at > NOW() - INTERVAL '${days} days'
          `;

          if (targetRoomId) {
            query += ` AND c.room_id = $${paramCount}`;
            params.push(targetRoomId);
            paramCount++;
          }

          if (targetBotId) {
            query += ` AND i.bot_id = $${paramCount}`;
            params.push(targetBotId);
            paramCount++;
          }
        } else {
          query += ` WHERE lc.started_at > NOW() - INTERVAL '${days} days'`;
        }

        query += `
          GROUP BY lc.provider, lc.model
          ORDER BY total_calls DESC
        `;

        const result = await db.query(query, params);

        return {
          success: true,
          room_id: targetRoomId || 'all_rooms',
          bot_id: targetBotId || 'all_bots',
          days_analyzed: days,
          models: result.rows.map(row => ({
            provider: row.provider,
            model: row.model,
            total_calls: parseInt(row.total_calls),
            tokens: {
              input: parseInt(row.total_input_tokens),
              output: parseInt(row.total_output_tokens),
              total: parseInt(row.total_input_tokens) + parseInt(row.total_output_tokens),
            },
            total_cost_usd: parseFloat(row.total_cost_usd) || 0,
            avg_duration_ms: parseFloat(row.avg_duration_ms)?.toFixed(0),
          })),
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
