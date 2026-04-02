/**
 * Tests for PolicyClient configuration
 *
 * Verifies that:
 * 1. HttpPolicyClient is used when POLICY_CHECK_URL is set
 * 2. AllowAllPolicyClient is used when POLICY_CHECK_URL is not set
 * 3. Configuration is initialized once at startup
 */

import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { AllowAllPolicyClient } from '../../../shared/tools/src/policy/client';
import { HttpPolicyClient } from '../../../shared/tools/src/policy/http-client';
import { createPolicyClient } from '../policy-factory';

// Mock the coordinator - we'll test it in isolation
describe('PolicyClient Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Reset module cache to ensure fresh imports
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('Environment-based initialization', () => {
    it('should create HttpPolicyClient when POLICY_CHECK_URL is set', () => {
      // RED: This will fail because we haven't implemented the factory yet
      process.env.POLICY_CHECK_URL = 'http://localhost:3001';
      process.env.POLICY_CHECK_TIMEOUT = '3000';
      process.env.POLICY_CHECK_DEBUG = 'true';

      // Import the factory function we'll create
      const client = createPolicyClient();

      expect(client).toBeInstanceOf(HttpPolicyClient);
    });

    it('should create AllowAllPolicyClient when POLICY_CHECK_URL is not set', () => {
      // RED: This will fail because we haven't implemented the factory yet
      delete process.env.POLICY_CHECK_URL;

      const client = createPolicyClient();

      expect(client).toBeInstanceOf(AllowAllPolicyClient);
    });

    it('should create AllowAllPolicyClient when POLICY_CHECK_URL is empty string', () => {
      process.env.POLICY_CHECK_URL = '';

      const client = createPolicyClient();

      expect(client).toBeInstanceOf(AllowAllPolicyClient);
    });
  });

  describe('Configuration validation', () => {
    it('should handle invalid timeout gracefully', () => {
      process.env.POLICY_CHECK_URL = 'http://localhost:3001';
      process.env.POLICY_CHECK_TIMEOUT = 'not-a-number';

      const client = createPolicyClient();

      // Should still create client with default timeout
      expect(client).toBeInstanceOf(HttpPolicyClient);
    });

    it('should normalize baseUrl by removing trailing slash', () => {
      process.env.POLICY_CHECK_URL = 'http://localhost:3001/';

      const client = createPolicyClient() as HttpPolicyClient;

      // Access private field for testing (not ideal, but validates behavior)
      expect((client as any).baseUrl).toBe('http://localhost:3001');
    });
  });

  describe('Logging', () => {
    it('should log initialization when HttpPolicyClient is created', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      process.env.POLICY_CHECK_URL = 'http://localhost:3001';
      process.env.POLICY_CHECK_DEBUG = 'true';

      createPolicyClient();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[HttpPolicyClient]')
      );

      consoleSpy.mockRestore();
    });

    it('should log policy enabled when HttpPolicyClient is created', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      process.env.POLICY_CHECK_URL = 'http://localhost:3001';

      createPolicyClient();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Policy enforcement enabled')
      );

      consoleSpy.mockRestore();
    });

    it('should log standalone mode when using AllowAllPolicyClient', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      delete process.env.POLICY_CHECK_URL;

      createPolicyClient();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('standalone mode')
      );

      consoleSpy.mockRestore();
    });
  });
});
