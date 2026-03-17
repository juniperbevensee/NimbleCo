/**
 * Rate Limiter Tests
 * TDD approach - tests written first (RED phase)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkInvocationLimit, RateLimitResult } from './rate-limiter';
import { Pool } from 'pg';

// Mock pg Pool
vi.mock('pg', () => {
  const mockPool = {
    query: vi.fn(),
    end: vi.fn(),
  };
  return {
    Pool: vi.fn(() => mockPool),
  };
});

describe('Rate Limiter', () => {
  let mockPool: any;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockPool = new Pool();

    // Mock environment variables
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.INVOCATION_LIMIT_PER_USER_PER_DAY = '30';
    process.env.INVOCATION_LIMIT_GLOBAL_PER_DAY = '150';
    process.env.BOT_INVOCATION_LIMIT_PER_DAY = '20';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Per-user limits', () => {
    it('should allow invocation when under per-user limit', async () => {
      // Mock database response: user has made 10 invocations today
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ invocation_count: 10, bot_invocation_count: 0 }] }) // User count
        .mockResolvedValueOnce({ rows: [{ total_invocations: 50 }] }) // Global count
        .mockResolvedValueOnce({ rows: [] }) // Insert/update user
        .mockResolvedValueOnce({ rows: [] }); // Insert/update global

      const result = await checkInvocationLimit('user123', 'mattermost', false, false);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(19); // 30 - 10 - 1
      expect(result.reason).toBeUndefined();
    });

    it('should block invocation when at per-user limit', async () => {
      // Mock database response: user has made 30 invocations today
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ invocation_count: 30, bot_invocation_count: 0 }] }) // User count
        .mockResolvedValueOnce({ rows: [{ total_invocations: 50 }] }); // Global count

      const result = await checkInvocationLimit('user123', 'mattermost', false, false);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('daily limit');
      expect(result.remaining).toBe(0);
    });
  });

  describe('Bot-to-bot limits', () => {
    it('should allow bot invocation when under bot limit', async () => {
      // Mock database response: bot has made 10 invocations today
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ invocation_count: 10, bot_invocation_count: 10 }] }) // User count with bot count
        .mockResolvedValueOnce({ rows: [{ total_invocations: 50 }] }) // Global count
        .mockResolvedValueOnce({ rows: [] }) // Insert/update user
        .mockResolvedValueOnce({ rows: [] }); // Insert/update global

      const result = await checkInvocationLimit('user123', 'mattermost', false, true);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 20 - 10 - 1
    });

    it('should block bot invocation when at bot limit', async () => {
      // Mock database response: bot has made 20 invocations today
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ invocation_count: 20, bot_invocation_count: 20 }] }) // User count with bot count
        .mockResolvedValueOnce({ rows: [{ total_invocations: 50 }] }); // Global count

      const result = await checkInvocationLimit('user123', 'mattermost', false, true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('bot');
      expect(result.reason).toContain('daily limit');
      expect(result.remaining).toBe(0);
    });
  });

  describe('Admin bypass', () => {
    it('should allow admin to bypass per-user limit', async () => {
      // Mock database response: admin has made 100 invocations today
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ invocation_count: 100, bot_invocation_count: 0 }] }) // User count
        .mockResolvedValueOnce({ rows: [{ total_invocations: 50 }] }) // Global count
        .mockResolvedValueOnce({ rows: [] }) // Insert/update user
        .mockResolvedValueOnce({ rows: [] }); // Insert/update global

      const result = await checkInvocationLimit('admin123', 'mattermost', true, false);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
});
