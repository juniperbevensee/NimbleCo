/**
 * E2E Tests for Policy Integration
 *
 * Tests the full flow: NimbleCo → HttpPolicyClient → Swarm-Map API → Response
 *
 * Uses a mock HTTP server to simulate Swarm-Map policy API responses.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import {
  Tool,
  ToolContext,
  HttpPolicyClient,
  filterToolsByPolicy,
  guardToolExecution,
  AllowAllPolicyClient,
} from '@nimbleco/tools';

// Mock Swarm-Map server
let mockServer: http.Server;
let serverPort: number;
let mockResponses: {
  health?: { status: number; body: any };
  check?: { status: number; body: any };
  filterTools?: { status: number; body: any };
} = {};

// Sample tools for testing
const sampleTools: Tool[] = [
  {
    name: 'read_file',
    description: 'Read file contents',
    category: 'filesystem',
    use_cases: ['read files'],
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true }),
  },
  {
    name: 'write_file',
    description: 'Write to file',
    category: 'filesystem',
    use_cases: ['write files'],
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true }),
  },
  {
    name: 'execute_code',
    description: 'Execute code',
    category: 'compute',
    use_cases: ['execute code'],
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true }),
  },
  {
    name: 'delete_database',
    description: 'Delete database',
    category: 'storage',
    use_cases: ['delete database'],
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true }),
  },
];

const mockContext: ToolContext = {
  user_id: 'mattermost-user-123',
  platform: 'mattermost',
  room_id: 'team-abc',
  credentials: {},
  invocation_id: 'inv-xyz',
};

describe('E2E: Policy Integration with HTTP Client', () => {
  beforeAll(async () => {
    // Create mock Swarm-Map server
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });

      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');

        // Route handling
        if (req.url === '/api/policy/health' && req.method === 'GET') {
          const response = mockResponses.health || { status: 200, body: { status: 'ok' } };
          res.statusCode = response.status;
          res.end(JSON.stringify(response.body));
        } else if (req.url === '/api/policy/check' && req.method === 'POST') {
          const response = mockResponses.check || { status: 200, body: { allowed: true } };
          res.statusCode = response.status;
          res.end(JSON.stringify(response.body));
        } else if (req.url === '/api/policy/filter-tools' && req.method === 'POST') {
          const response = mockResponses.filterTools || { status: 200, body: { results: [] } };
          res.statusCode = response.status;
          res.end(JSON.stringify(response.body));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });
    });

    // Start server on random port
    await new Promise<void>(resolve => {
      mockServer.listen(0, () => {
        const addr = mockServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      mockServer.close(() => resolve());
    });
  });

  beforeEach(() => {
    // Reset mock responses
    mockResponses = {};
  });

  describe('Health Check', () => {
    it('should report available when Swarm-Map is healthy', async () => {
      mockResponses.health = { status: 200, body: { status: 'ok' } };

      const client = new HttpPolicyClient({
        baseUrl: `http://localhost:${serverPort}`,
        timeout: 5000,
      });

      const available = await client.isAvailable();
      expect(available).toBe(true);
    });

    it('should report unavailable when Swarm-Map is down', async () => {
      // Use a port that's not listening
      const client = new HttpPolicyClient({
        baseUrl: 'http://localhost:59999',
        timeout: 1000,
      });

      const available = await client.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('Schema Filtering E2E', () => {
    it('should filter tools based on Swarm-Map policy response', async () => {
      // Simulate Swarm-Map allowing only low-tier tools
      mockResponses.health = { status: 200, body: { status: 'ok' } };
      mockResponses.filterTools = {
        status: 200,
        body: {
          results: [
            { name: 'read_file', allowed: true, tier: 'low' },
            { name: 'write_file', allowed: true, tier: 'low' },
            { name: 'execute_code', allowed: false, tier: 'high', reason: 'User does not have access to tier: high' },
            { name: 'delete_database', allowed: false, tier: 'critical', reason: 'User does not have access to tier: critical' },
          ],
        },
      };

      const client = new HttpPolicyClient({
        baseUrl: `http://localhost:${serverPort}`,
      });

      const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, client);

      // Only low-tier tools should pass through
      expect(filteredTools).toHaveLength(2);
      expect(filteredTools.map(t => t.name)).toEqual(['read_file', 'write_file']);
    });

    it('should allow all tools when user has full access', async () => {
      mockResponses.health = { status: 200, body: { status: 'ok' } };
      mockResponses.filterTools = {
        status: 200,
        body: {
          results: [
            { name: 'read_file', allowed: true, tier: 'low' },
            { name: 'write_file', allowed: true, tier: 'low' },
            { name: 'execute_code', allowed: true, tier: 'high' },
            { name: 'delete_database', allowed: true, tier: 'critical' },
          ],
        },
      };

      const client = new HttpPolicyClient({
        baseUrl: `http://localhost:${serverPort}`,
      });

      const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, client);

      expect(filteredTools).toHaveLength(4);
    });

    it('should fail-open and allow all tools when Swarm-Map is down', async () => {
      // Use a port that's not listening
      const client = new HttpPolicyClient({
        baseUrl: 'http://localhost:59999',
        timeout: 500,
      });

      const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, client);

      // Fail-open: all tools should be allowed
      expect(filteredTools).toHaveLength(4);
    });
  });

  describe('Execution Guard E2E', () => {
    it('should allow execution when Swarm-Map permits', async () => {
      mockResponses.health = { status: 200, body: { status: 'ok' } };
      mockResponses.check = {
        status: 200,
        body: { allowed: true, tier: 'low' },
      };

      const client = new HttpPolicyClient({
        baseUrl: `http://localhost:${serverPort}`,
      });

      // Should not throw
      await expect(
        guardToolExecution('read_file', mockContext, client)
      ).resolves.toBeUndefined();
    });

    it('should block execution when Swarm-Map denies', async () => {
      mockResponses.health = { status: 200, body: { status: 'ok' } };
      mockResponses.check = {
        status: 200,
        body: {
          allowed: false,
          tier: 'critical',
          reason: 'User groups do not have access to tier: critical',
        },
      };

      const client = new HttpPolicyClient({
        baseUrl: `http://localhost:${serverPort}`,
      });

      await expect(
        guardToolExecution('delete_database', mockContext, client)
      ).rejects.toThrow('do not have access to tier');
    });

    it('should fail-open when Swarm-Map is down', async () => {
      const client = new HttpPolicyClient({
        baseUrl: 'http://localhost:59999',
        timeout: 500,
      });

      // Should not throw (fail-open)
      await expect(
        guardToolExecution('delete_database', mockContext, client)
      ).resolves.toBeUndefined();
    });
  });

  describe('Full Integration Flow', () => {
    it('should handle complete request cycle: filter → execute', async () => {
      // Setup: User has access to low and medium tiers only
      mockResponses.health = { status: 200, body: { status: 'ok' } };
      mockResponses.filterTools = {
        status: 200,
        body: {
          results: [
            { name: 'read_file', allowed: true, tier: 'low' },
            { name: 'write_file', allowed: true, tier: 'medium' },
            { name: 'execute_code', allowed: false, tier: 'high' },
            { name: 'delete_database', allowed: false, tier: 'critical' },
          ],
        },
      };
      mockResponses.check = {
        status: 200,
        body: { allowed: true, tier: 'low' },
      };

      const client = new HttpPolicyClient({
        baseUrl: `http://localhost:${serverPort}`,
      });

      // Step 1: Filter tools for LLM context
      const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, client);
      expect(filteredTools).toHaveLength(2);
      expect(filteredTools.map(t => t.name)).toContain('read_file');
      expect(filteredTools.map(t => t.name)).toContain('write_file');
      expect(filteredTools.map(t => t.name)).not.toContain('execute_code');

      // Step 2: Guard execution (simulate LLM chose read_file)
      await expect(
        guardToolExecution('read_file', mockContext, client)
      ).resolves.toBeUndefined();
    });

    it('should prevent execution of tools filtered out by schema filtering', async () => {
      // A malicious or buggy LLM might try to call a tool that was filtered out
      mockResponses.health = { status: 200, body: { status: 'ok' } };
      mockResponses.filterTools = {
        status: 200,
        body: {
          results: [
            { name: 'read_file', allowed: true, tier: 'low' },
            { name: 'execute_code', allowed: false, tier: 'high' },
          ],
        },
      };

      const client = new HttpPolicyClient({
        baseUrl: `http://localhost:${serverPort}`,
      });

      // Step 1: Schema filtering removes execute_code
      const filteredTools = await filterToolsByPolicy(
        [sampleTools[0], sampleTools[2]], // read_file, execute_code
        mockContext,
        client
      );
      expect(filteredTools.map(t => t.name)).not.toContain('execute_code');

      // Step 2: LLM tries to call execute_code anyway (shouldn't happen but defense-in-depth)
      mockResponses.check = {
        status: 200,
        body: {
          allowed: false,
          tier: 'high',
          reason: 'User groups do not have access to tier: high',
        },
      };

      await expect(
        guardToolExecution('execute_code', mockContext, client)
      ).rejects.toThrow();
    });
  });

  describe('AllowAllPolicyClient Fallback', () => {
    it('should work standalone without Swarm-Map', async () => {
      // This simulates NimbleCo running without Swarm-Map configured
      const client = new AllowAllPolicyClient();

      // All tools should be allowed
      const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, client);
      expect(filteredTools).toHaveLength(4);

      // All executions should be allowed
      await expect(
        guardToolExecution('delete_database', mockContext, client)
      ).resolves.toBeUndefined();
    });
  });
});
