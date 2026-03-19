/**
 * Invocation Logger
 * Logs all agent invocations, tool calls, and LLM calls to PostgreSQL
 * Provides a comprehensive audit trail for analysis
 */

import { Pool } from 'pg';

let pool: Pool | null = null;

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

export interface InvocationContext {
  conversationId: string;
  triggerUserId: string;
  triggerEventId?: string;
  inputMessage: string;
  taskType: string;
  botId?: string;  // Which bot is handling this invocation
}

export class InvocationLogger {
  private invocationId: string | null = null;
  private startTime: number = 0;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalCost: number = 0;

  /**
   * Start a new invocation
   */
  async startInvocation(context: InvocationContext): Promise<string | null> {
    const db = getPool();
    this.startTime = Date.now();

    // Get or create conversation
    const convResult = await db.query(
      `
      INSERT INTO conversations (room_id, platform, user_id, title, bot_id)
      VALUES ($1, 'matrix', $2, $3, $4)
      ON CONFLICT (room_id, platform)
      DO UPDATE SET updated_at = NOW(), bot_id = EXCLUDED.bot_id
      RETURNING id
      `,
      [context.conversationId, context.triggerUserId, `Conversation in ${context.conversationId.substring(0, 20)}`, context.botId]
    );

    const conversationId = convResult.rows[0]?.id || (
      await db.query('SELECT id FROM conversations WHERE room_id = $1 AND platform = \'matrix\' LIMIT 1', [context.conversationId])
    ).rows[0]?.id;

    if (!conversationId) {
      throw new Error('Failed to get or create conversation');
    }

    // Create invocation
    const result = await db.query(
      `
      INSERT INTO invocations (
        conversation_id,
        trigger_user_id,
        trigger_event_id,
        input_message,
        task_type,
        bot_id,
        status,
        started_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'running', NOW())
      RETURNING id
      `,
      [conversationId, context.triggerUserId, context.triggerEventId, context.inputMessage, context.taskType, context.botId]
    );

    this.invocationId = result.rows[0].id;
    console.log(`📊 Started invocation ${this.invocationId}`);
    return this.invocationId;
  }

  /**
   * Log a tool call
   */
  async logToolCall(toolName: string, input: any, output: any, error: string | null, durationMs: number) {
    if (!this.invocationId) {
      console.warn('⚠️  Cannot log tool call: No active invocation');
      return;
    }

    const db = getPool();
    const status = error ? 'failed' : 'success';

    await db.query(
      `
      INSERT INTO tool_calls (
        invocation_id,
        tool_name,
        input,
        output,
        error,
        status,
        duration_ms,
        started_at,
        completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - ($8 || ' milliseconds')::INTERVAL, NOW())
      `,
      [
        this.invocationId,
        toolName,
        JSON.stringify(input),  // Convert to JSON string for JSONB
        JSON.stringify(output),  // Convert to JSON string for JSONB
        error || null,
        status,
        durationMs,
        durationMs  // Pass again for the interval calculation
      ]
    );

    console.log(`  🔧 Logged tool call: ${toolName} (${status}, ${durationMs}ms)`);
  }

  /**
   * Log an LLM call
   */
  async logLLMCall(
    provider: string,
    model: string,
    inputMessages: any[],
    outputContent: string,
    toolUse: any | null,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    durationMs: number
  ) {
    if (!this.invocationId) {
      console.warn('⚠️  Cannot log LLM call: No active invocation');
      return;
    }

    const db = getPool();

    await db.query(
      `
      INSERT INTO llm_calls (
        invocation_id,
        provider,
        model,
        input_messages,
        output_content,
        tool_use,
        input_tokens,
        output_tokens,
        cost_usd,
        duration_ms,
        started_at,
        completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - ($11 || ' milliseconds')::INTERVAL, NOW())
      `,
      [
        this.invocationId,
        provider,
        model,
        JSON.stringify(inputMessages),  // Convert to JSON string for JSONB
        outputContent,
        toolUse ? JSON.stringify(toolUse) : null,  // Convert to JSON string for JSONB
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
        durationMs  // Pass again for the interval calculation
      ]
    );

    // Track totals for invocation summary
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCost += costUsd;

    console.log(`  🤖 Logged LLM call: ${provider}/${model} (${inputTokens}+${outputTokens} tokens, $${costUsd.toFixed(4)}, ${durationMs}ms)`);
  }

  /**
   * Complete the invocation
   */
  async completeInvocation(outputMessage: string, error: string | null) {
    if (!this.invocationId) {
      console.warn('⚠️  Cannot complete invocation: No active invocation');
      return;
    }

    const db = getPool();
    const durationMs = Date.now() - this.startTime;
    const status = error ? 'failed' : 'completed';

    await db.query(
      `
      UPDATE invocations SET
        status = $1,
        output_message = $2,
        error = $3,
        completed_at = NOW(),
        duration_ms = $4,
        total_input_tokens = $5,
        total_output_tokens = $6,
        total_cost_usd = $7
      WHERE id = $8
      `,
      [
        status,
        outputMessage,
        error || null,
        durationMs,
        this.totalInputTokens,
        this.totalOutputTokens,
        this.totalCost,
        this.invocationId
      ]
    );

    console.log(`📊 Completed invocation ${this.invocationId} (${status}, ${durationMs}ms, $${this.totalCost.toFixed(4)})`);
    this.invocationId = null;
  }
}
