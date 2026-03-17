/**
 * Message Bus Analytics Tools
 *
 * Allows analysis of inter-agent communication patterns,
 * study of emergent behaviors, and meta-cognitive awareness.
 *
 * Uses database pagination - call multiple times with offset/limit
 * to iterate through large result sets.
 */

import { Tool, ToolContext } from '../base';
import { Pool } from 'pg';

interface AnalyzeMessageBusParams {
  time_range_minutes?: number;
  subject_pattern?: string;
  sender?: string;
  recipient?: string;
  message_type?: string;
  limit?: number;
  offset?: number;              // Pagination offset
}

const getPool = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
  });
};

const analyzeMessageBus: Tool = {
  name: 'analyze_message_bus',
  description: `Analyze inter-agent communication patterns from the message bus logs. Use this to study how agents communicate and coordinate, identify emergent communication patterns, analyze message frequency and timing, understand information flow in the system, and develop meta-cognitive awareness of the agent ecosystem. Returns statistics and sample messages matching the query.`,
  category: 'analytics',
  use_cases: [
    'Study agent communication patterns',
    'Identify emergent behaviors',
    'Analyze coordination between agents',
    'Meta-cognitive analysis of the system',
    'Debug message flow issues',
    'Understand system information architecture',
  ],
  parameters: {
    type: 'object',
    properties: {
      time_range_minutes: {
        type: 'number',
        description: 'Look back this many minutes (default: 60)',
      },
      subject_pattern: {
        type: 'string',
        description: 'Filter by NATS subject pattern (e.g., "tasks%", "messages%", "agent%")',
      },
      sender: {
        type: 'string',
        description: 'Filter by sender ID',
      },
      recipient: {
        type: 'string',
        description: 'Filter by recipient',
      },
      message_type: {
        type: 'string',
        description: 'Filter by message type (e.g., "task", "message:update", "agent:response")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 100). Large results are automatically saved to workspace for chunked reading.',
      },
      offset: {
        type: 'number',
        description: 'Skip this many messages (for pagination)',
      },
    },
  },

  async handler(params: AnalyzeMessageBusParams, context: ToolContext) {
    const db = getPool();

    const timeRangeMinutes = params.time_range_minutes || 60;
    const offset = params.offset || 0;
    // Cap limit to prevent context overflow - use pagination for more
    const MAX_LIMIT = 50;
    const requestedLimit = params.limit || 50;
    const limit = Math.min(requestedLimit, MAX_LIMIT);

    // Build WHERE clause
    const conditions: string[] = [
      `timestamp > NOW() - INTERVAL '${timeRangeMinutes} minutes'`
    ];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.subject_pattern) {
      conditions.push(`subject LIKE $${paramIndex}`);
      values.push(params.subject_pattern.replace(/%/g, '%%')); // SQL LIKE pattern
      paramIndex++;
    }

    if (params.sender) {
      conditions.push(`sender = $${paramIndex}`);
      values.push(params.sender);
      paramIndex++;
    }

    if (params.recipient) {
      conditions.push(`recipient = $${paramIndex}`);
      values.push(params.recipient);
      paramIndex++;
    }

    if (params.message_type) {
      conditions.push(`message_type = $${paramIndex}`);
      values.push(params.message_type);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    try {
      // Get statistics
      const statsResult = await db.query(
        `SELECT
          COUNT(*) as total_messages,
          COUNT(DISTINCT sender) as unique_senders,
          COUNT(DISTINCT recipient) as unique_recipients,
          COUNT(DISTINCT subject) as unique_subjects,
          COUNT(DISTINCT message_type) as unique_types,
          MIN(timestamp) as earliest,
          MAX(timestamp) as latest
        FROM message_bus_log
        WHERE ${whereClause}`,
        values
      );

      // Get top subjects
      const topSubjectsResult = await db.query(
        `SELECT
          subject,
          COUNT(*) as count,
          COUNT(DISTINCT sender) as unique_senders
        FROM message_bus_log
        WHERE ${whereClause}
        GROUP BY subject
        ORDER BY count DESC
        LIMIT 10`,
        values
      );

      // Get sender-recipient pairs
      const pairsResult = await db.query(
        `SELECT
          sender,
          recipient,
          COUNT(*) as message_count,
          array_agg(DISTINCT message_type) as message_types
        FROM message_bus_log
        WHERE ${whereClause} AND sender IS NOT NULL AND recipient IS NOT NULL
        GROUP BY sender, recipient
        ORDER BY message_count DESC
        LIMIT 10`,
        values
      );

      // Get sample messages with pagination
      const samplesResult = await db.query(
        `SELECT
          timestamp,
          subject,
          sender,
          recipient,
          message_type,
          data
        FROM message_bus_log
        WHERE ${whereClause}
        ORDER BY timestamp DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset]
      );

      await db.end();

      const stats = statsResult.rows[0];
      const topSubjects = topSubjectsResult.rows;
      const communicationPairs = pairsResult.rows;
      const samples = samplesResult.rows;

      const result = {
        success: true,
        time_range_minutes: timeRangeMinutes,
        statistics: {
          total_messages: parseInt(stats.total_messages),
          unique_senders: parseInt(stats.unique_senders),
          unique_recipients: parseInt(stats.unique_recipients),
          unique_subjects: parseInt(stats.unique_subjects),
          unique_types: parseInt(stats.unique_types),
          time_range: {
            earliest: stats.earliest,
            latest: stats.latest,
          },
          messages_per_minute: stats.total_messages > 0 ? (stats.total_messages / timeRangeMinutes).toFixed(2) : '0',
        },
        top_subjects: topSubjects.map(row => ({
          subject: row.subject,
          count: parseInt(row.count),
          unique_senders: parseInt(row.unique_senders),
        })),
        communication_pairs: communicationPairs.map(row => ({
          sender: row.sender,
          recipient: row.recipient,
          message_count: parseInt(row.message_count),
          message_types: row.message_types,
        })),
        sample_messages: samples.map(row => ({
          timestamp: row.timestamp,
          subject: row.subject,
          sender: row.sender,
          recipient: row.recipient,
          message_type: row.message_type,
          data: row.data,
        })),
        pagination: {
          offset,
          limit,
          returned: samples.length,
          has_more: samples.length === limit,
        },
      };

      // Add pagination guidance if there's more data
      if (result.pagination.has_more) {
        (result as any).next_page_hint = `Use offset: ${offset + limit} to get next page`;
      }
      if (requestedLimit > MAX_LIMIT) {
        (result as any).limit_notice = `Limit capped at ${MAX_LIMIT} per request. Use offset/limit pagination to iterate through all ${result.statistics.total_messages} messages.`;
      }

      return result;
    } catch (error) {
      await db.end().catch(() => {});
      console.error('Error analyzing message bus:', error);
      return {
        success: false,
        error: `Failed to analyze message bus: ${error}`,
      };
    }
  },
};

export const messageBusTools: Tool[] = [analyzeMessageBus];
