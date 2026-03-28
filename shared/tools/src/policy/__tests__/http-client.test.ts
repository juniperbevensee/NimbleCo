/**
 * Tests for HTTP PolicyClient
 */

import { HttpPolicyClient, createHttpPolicyClientFromEnv } from '../http-client';
import { PolicyCheckRequest } from '../client';

// Mock fetch globally
global.fetch = jest.fn();

describe('HttpPolicyClient', () => {
  let client: HttpPolicyClient;
  const baseUrl = 'http://localhost:3000';

  beforeEach(() => {
    client = new HttpPolicyClient({ baseUrl, debug: false });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when health check succeeds', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      } as Response);

      const available = await client.isAvailable();

      expect(available).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/policy/health',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should return false when health check fails', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });

    it('should cache health check result', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      } as Response);

      // First call
      await client.isAvailable();
      expect(fetch).toHaveBeenCalledTimes(1);

      // Second call (should use cached result)
      await client.isAvailable();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAccess', () => {
    const request: PolicyCheckRequest = {
      userId: 'user123',
      toolName: 'read_file',
      platform: 'mattermost',
      teamId: 'team-abc',
    };

    it('should allow when policy service allows', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          allowed: true,
          tier: 'low',
        }),
      } as Response);

      const result = await client.checkAccess(request);

      expect(result.allowed).toBe(true);
      expect(result.metadata?.tier).toBe('low');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/policy/check',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: 'user123',
            toolName: 'read_file',
            metadata: {
              platform: 'mattermost',
              teamId: 'team-abc',
              channelId: undefined,
            },
          }),
        })
      );
    });

    it('should deny when policy service denies', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          allowed: false,
          reason: 'User does not have access to tier: high',
          tier: 'high',
        }),
      } as Response);

      const result = await client.checkAccess(request);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have access');
      expect(result.metadata?.tier).toBe('high');
    });

    it('should fail open when policy service is unavailable', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.checkAccess(request);

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('unavailable');
    });

    it('should timeout after configured duration', async () => {
      const shortTimeoutClient = new HttpPolicyClient({
        baseUrl,
        timeout: 100,
      });

      (fetch as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true } as Response), 200)
          )
      );

      const result = await shortTimeoutClient.checkAccess(request);

      // Should fail open due to timeout
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkBatchAccess', () => {
    const requests: PolicyCheckRequest[] = [
      { userId: 'user123', toolName: 'read_file', platform: 'mattermost' },
      { userId: 'user123', toolName: 'write_file', platform: 'mattermost' },
      { userId: 'user123', toolName: 'execute_code', platform: 'mattermost' },
    ];

    it('should batch check multiple tools', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { name: 'read_file', allowed: true, tier: 'low' },
            { name: 'write_file', allowed: true, tier: 'low' },
            { name: 'execute_code', allowed: false, reason: 'High tier required', tier: 'high' },
          ],
        }),
      } as Response);

      const results = await client.checkBatchAccess(requests);

      expect(results.size).toBe(3);
      expect(results.get('read_file')?.allowed).toBe(true);
      expect(results.get('write_file')?.allowed).toBe(true);
      expect(results.get('execute_code')?.allowed).toBe(false);
      expect(results.get('execute_code')?.reason).toContain('High tier');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/policy/filter-tools',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            userId: 'user123',
            tools: [
              { name: 'read_file', category: undefined },
              { name: 'write_file', category: undefined },
              { name: 'execute_code', category: undefined },
            ],
            metadata: {
              platform: 'mattermost',
              teamId: undefined,
            },
          }),
        })
      );
    });

    it('should handle empty request array', async () => {
      const results = await client.checkBatchAccess([]);

      expect(results.size).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should fail open when batch check fails', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const results = await client.checkBatchAccess(requests);

      // All should be allowed (fail open)
      expect(results.size).toBe(3);
      expect(results.get('read_file')?.allowed).toBe(true);
      expect(results.get('write_file')?.allowed).toBe(true);
      expect(results.get('execute_code')?.allowed).toBe(true);
    });
  });
});

describe('createHttpPolicyClientFromEnv', () => {
  beforeEach(() => {
    delete process.env.POLICY_CHECK_URL;
    delete process.env.POLICY_CHECK_TIMEOUT;
    delete process.env.POLICY_CHECK_DEBUG;
  });

  it('should return null when POLICY_CHECK_URL is not set', () => {
    const client = createHttpPolicyClientFromEnv();

    expect(client).toBeNull();
  });

  it('should create client from environment variables', () => {
    process.env.POLICY_CHECK_URL = 'http://localhost:3000';
    process.env.POLICY_CHECK_TIMEOUT = '10000';
    process.env.POLICY_CHECK_DEBUG = 'true';

    const client = createHttpPolicyClientFromEnv();

    expect(client).toBeInstanceOf(HttpPolicyClient);
  });

  it('should use default timeout when not specified', () => {
    process.env.POLICY_CHECK_URL = 'http://localhost:3000';

    const client = createHttpPolicyClientFromEnv();

    expect(client).toBeInstanceOf(HttpPolicyClient);
  });
});
