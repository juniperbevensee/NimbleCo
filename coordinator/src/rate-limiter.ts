/**
 * Rate Limiter for Audrey Invocations
 *
 * Enforces rate limits on bot invocations:
 * - Per-user limit: 30/day (default, configurable)
 * - Global daily cap: 150/day across all users (default, configurable)
 * - Bot-to-bot limit: 20/day (default, configurable)
 * - Admins bypass daily limits BUT NOT circuit breaker (to prevent infinite loops)
 * - Circuit breaker: 20 requests/60 seconds (applies to everyone including admins)
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

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  remaining?: number;
  userCount?: number;
  userLimit?: number;
  globalCount?: number;
  globalLimit?: number;
  warningLevel?: 'low' | 'critical' | null;
}

export interface CircuitBreakerResult {
  allowed: boolean;
  reason?: string;
  recentCount?: number;
}

/**
 * Circuit breaker: Prevent rapid-fire invocations that could cause infinite loops
 *
 * Applies to ALL users including admins to prevent accidental recursion bombs.
 *
 * @param userId - User ID from the platform
 * @param platform - Platform name
 * @param threshold - Max invocations in the time window (default: 20)
 * @param windowSeconds - Time window in seconds (default: 60)
 * @returns CircuitBreakerResult with allowed status and reason if blocked
 */
export async function checkCircuitBreaker(
  userId: string,
  platform: string,
  threshold: number = 20,
  windowSeconds: number = 60
): Promise<CircuitBreakerResult> {
  const db = getPool();

  try {
    // Count invocations in the recent time window
    const result = await db.query(
      `
      SELECT COUNT(*) as recent_count
      FROM invocations
      WHERE trigger_user_id = $1
        AND started_at > NOW() - INTERVAL '${windowSeconds} seconds'
      `,
      [userId]
    );

    const recentCount = parseInt(result.rows[0]?.recent_count || '0', 10);

    if (recentCount >= threshold) {
      return {
        allowed: false,
        reason: `⚠️ Circuit breaker triggered! You've made ${recentCount} requests in the last ${windowSeconds} seconds. Please wait a moment before trying again. This protection applies to everyone (including admins) to prevent infinite loops.`,
        recentCount,
      };
    }

    return {
      allowed: true,
      recentCount,
    };
  } catch (error) {
    console.error('Error checking circuit breaker:', error);
    // Fail open (allow the request) if there's a database error
    return {
      allowed: true,
      recentCount: 0,
    };
  }
}

/**
 * Check if a user is allowed to invoke the bot
 *
 * @param userId - User ID from the platform (Mattermost user_id, Matrix user_id, etc.)
 * @param platform - Platform name ('mattermost', 'matrix', etc.)
 * @param isAdmin - Whether the user is an admin (admins bypass limits)
 * @param isBot - Whether the sender is a bot (subject to bot-to-bot limits)
 * @returns RateLimitResult with allowed status, reason if blocked, and remaining count
 */
export async function checkInvocationLimit(
  userId: string,
  platform: string,
  isAdmin: boolean,
  isBot: boolean
): Promise<RateLimitResult> {
  const db = getPool();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Get limits from environment or use defaults
  const perUserLimit = parseInt(process.env.INVOCATION_LIMIT_PER_USER_PER_DAY || '30', 10);
  const globalLimit = parseInt(process.env.INVOCATION_LIMIT_GLOBAL_PER_DAY || '150', 10);
  const botLimit = parseInt(process.env.BOT_INVOCATION_LIMIT_PER_DAY || '20', 10);

  try {
    // Get user's current counts for today
    const userResult = await db.query(
      `
      SELECT invocation_count, bot_invocation_count
      FROM invocation_rate_limits
      WHERE user_id = $1 AND platform = $2 AND date = $3
      `,
      [userId, platform, today]
    );

    const userCount = userResult.rows[0]?.invocation_count || 0;
    const botCount = userResult.rows[0]?.bot_invocation_count || 0;

    // Get global count for today
    const globalResult = await db.query(
      `
      SELECT total_invocations
      FROM global_invocation_limits
      WHERE platform = $1 AND date = $2
      `,
      [platform, today]
    );

    const globalCount = globalResult.rows[0]?.total_invocations || 0;

    // Admins bypass rate limits but we still track usage for monitoring
    if (isAdmin) {
      // Increment global counter for visibility (but don't block admins)
      await incrementGlobalCounter(db, platform, today);
      return {
        allowed: true,
        remaining: undefined, // Unlimited for admins
        userCount: 0,
        userLimit: perUserLimit,
        globalCount: globalCount + 1, // Reflect the increment
        globalLimit,
        warningLevel: null,
      };
    }

    // Check bot-to-bot limit first (most restrictive)
    if (isBot && botCount >= botLimit) {
      return {
        allowed: false,
        reason: `You've reached the bot-to-bot daily limit of ${botLimit} invocations. Please try again tomorrow.`,
        remaining: 0,
        userCount: botCount,
        userLimit: botLimit,
        globalCount,
        globalLimit,
        warningLevel: 'critical',
      };
    }

    // Check per-user limit
    if (userCount >= perUserLimit) {
      return {
        allowed: false,
        reason: `You've reached your daily limit of ${perUserLimit} invocations. Please try again tomorrow.`,
        remaining: 0,
        userCount,
        userLimit: perUserLimit,
        globalCount,
        globalLimit,
        warningLevel: 'critical',
      };
    }

    // Check global limit
    if (globalCount >= globalLimit) {
      return {
        allowed: false,
        reason: `The global daily limit of ${globalLimit} invocations has been reached. Please try again tomorrow.`,
        remaining: 0,
        userCount,
        userLimit: perUserLimit,
        globalCount,
        globalLimit,
        warningLevel: 'critical',
      };
    }

    // Allowed - increment counters
    await incrementCounters(db, userId, platform, today, isBot);

    // Calculate remaining
    let remaining: number;
    let limit: number;
    if (isBot) {
      remaining = botLimit - (botCount + 1);
      limit = botLimit;
    } else {
      remaining = perUserLimit - (userCount + 1);
      limit = perUserLimit;
    }

    // Determine warning level based on remaining percentage
    let warningLevel: 'low' | 'critical' | null = null;
    const userPercentRemaining = (remaining / limit) * 100;
    const globalPercentRemaining = ((globalLimit - globalCount - 1) / globalLimit) * 100;

    if (userPercentRemaining <= 10 || globalPercentRemaining <= 10) {
      warningLevel = 'critical'; // <= 10% remaining
    } else if (userPercentRemaining <= 20 || globalPercentRemaining <= 20) {
      warningLevel = 'low'; // <= 20% remaining
    }

    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      userCount: userCount + 1,
      userLimit: limit,
      globalCount: globalCount + 1,
      globalLimit,
      warningLevel,
    };
  } catch (error) {
    console.error('Error checking rate limit:', error);
    throw error;
  }
}

/**
 * Increment the invocation counters for user and global limits
 */
async function incrementCounters(
  db: Pool,
  userId: string,
  platform: string,
  date: string,
  isBot: boolean
): Promise<void> {
  // Increment user counter
  await db.query(
    `
    INSERT INTO invocation_rate_limits (user_id, platform, date, invocation_count, bot_invocation_count)
    VALUES ($1, $2, $3, 1, $4)
    ON CONFLICT (user_id, platform, date)
    DO UPDATE SET
      invocation_count = invocation_rate_limits.invocation_count + 1,
      bot_invocation_count = invocation_rate_limits.bot_invocation_count + $4,
      updated_at = NOW()
    `,
    [userId, platform, date, isBot ? 1 : 0]
  );

  // Increment global counter
  await db.query(
    `
    INSERT INTO global_invocation_limits (platform, date, total_invocations)
    VALUES ($1, $2, 1)
    ON CONFLICT (platform, date)
    DO UPDATE SET
      total_invocations = global_invocation_limits.total_invocations + 1,
      updated_at = NOW()
    `,
    [platform, date]
  );
}

/**
 * Increment only the global counter (for admin tracking without per-user limits)
 */
async function incrementGlobalCounter(
  db: Pool,
  platform: string,
  date: string
): Promise<void> {
  await db.query(
    `
    INSERT INTO global_invocation_limits (platform, date, total_invocations)
    VALUES ($1, $2, 1)
    ON CONFLICT (platform, date)
    DO UPDATE SET
      total_invocations = global_invocation_limits.total_invocations + 1,
      updated_at = NOW()
    `,
    [platform, date]
  );
}

/**
 * Clean up old rate limit records (optional maintenance function)
 * Call this periodically to keep the tables from growing indefinitely
 */
export async function cleanupOldRateLimits(daysToKeep: number = 30): Promise<void> {
  const db = getPool();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  await db.query('DELETE FROM invocation_rate_limits WHERE date < $1', [cutoff]);
  await db.query('DELETE FROM global_invocation_limits WHERE date < $1', [cutoff]);

  console.log(`Cleaned up rate limit records older than ${cutoff}`);
}
