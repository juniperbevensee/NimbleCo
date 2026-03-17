/**
 * Rate Limiter
 *
 * Simple in-memory rate limiting for tool operations
 * Prevents abuse/spam of filesystem and compute operations
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private records = new Map<string, RequestRecord>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup expired records every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.records.entries()) {
        if (now > record.resetTime) {
          this.records.delete(key);
        }
      }
    }, 60000);
  }

  /**
   * Check if a request should be allowed
   * Returns true if allowed, false if rate limited
   */
  checkLimit(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    let record = this.records.get(key);

    // Initialize or reset if window expired
    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + config.windowMs,
      };
      this.records.set(key, record);
    }

    // Check limit
    if (record.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: record.resetTime - now,
      };
    }

    // Increment and allow
    record.count++;
    return {
      allowed: true,
      remaining: config.maxRequests - record.count,
      resetMs: record.resetTime - now,
    };
  }

  stop() {
    clearInterval(this.cleanupInterval);
  }
}

// Global rate limiter instance
const limiter = new RateLimiter();

// Pre-configured rate limits
export const RateLimits = {
  // Filesystem operations: 100 per minute per user
  FILESYSTEM: {
    maxRequests: 100,
    windowMs: 60000,
  },
  // Code execution: 20 per minute per user
  COMPUTE: {
    maxRequests: 20,
    windowMs: 60000,
  },
  // Web fetching: 30 per minute per user
  WEB_FETCH: {
    maxRequests: 30,
    windowMs: 60000,
  },
  // Analytics queries: 50 per minute per user
  ANALYTICS: {
    maxRequests: 50,
    windowMs: 60000,
  },
};

/**
 * Check rate limit for an operation
 */
export function checkRateLimit(
  userId: string,
  operation: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetMs: number } {
  const key = `${userId}:${operation}`;
  return limiter.checkLimit(key, config);
}

/**
 * Format rate limit error message
 */
export function rateLimitError(remaining: number, resetMs: number): string {
  const resetSec = Math.ceil(resetMs / 1000);
  return `⚠️ Rate limit exceeded. Try again in ${resetSec} seconds. (${remaining} requests remaining in window)`;
}
