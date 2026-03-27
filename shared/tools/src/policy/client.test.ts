/**
 * Tests for Policy Client Interface
 *
 * RED phase: Write failing tests first
 * These tests define the expected behavior of policy integration
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  PolicyClient,
  PolicyCheckRequest,
  PolicyCheckResult,
  AllowAllPolicyClient,
  filterToolsByPolicy,
  guardToolExecution,
} from './client';
import { Tool, ToolContext } from '../base';

describe('PolicyClient Interface', () => {
  describe('AllowAllPolicyClient', () => {
    let client: AllowAllPolicyClient;

    beforeEach(() => {
      client = new AllowAllPolicyClient();
    });

    it('should allow all access requests', async () => {
      const request: PolicyCheckRequest = {
        userId: 'user-123',
        toolName: 'read_file',
      };

      const result = await client.checkAccess(request);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow batch access for multiple tools', async () => {
      const requests: PolicyCheckRequest[] = [
        { userId: 'user-123', toolName: 'read_file' },
        { userId: 'user-123', toolName: 'write_file' },
        { userId: 'user-123', toolName: 'execute_code' },
      ];

      const results = await client.checkBatchAccess(requests);

      expect(results.size).toBe(3);
      expect(results.get('read_file')?.allowed).toBe(true);
      expect(results.get('write_file')?.allowed).toBe(true);
      expect(results.get('execute_code')?.allowed).toBe(true);
    });

    it('should always report as available', async () => {
      const available = await client.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('Custom PolicyClient Implementation', () => {
    let mockClient: PolicyClient;

    beforeEach(() => {
      mockClient = {
        checkAccess: jest.fn() as any,
        checkBatchAccess: jest.fn() as any,
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };
    });

    it('should call checkAccess with correct request', async () => {
      const request: PolicyCheckRequest = {
        userId: 'user-123',
        toolName: 'read_file',
        platform: 'mattermost',
        teamId: 'team-456',
      };

      (mockClient.checkAccess as any).mockResolvedValue({ allowed: true });

      await mockClient.checkAccess(request);

      expect(mockClient.checkAccess).toHaveBeenCalledWith(request);
      expect(mockClient.checkAccess).toHaveBeenCalledTimes(1);
    });

    it('should handle denied access', async () => {
      const request: PolicyCheckRequest = {
        userId: 'user-123',
        toolName: 'delete_database',
      };

      const deniedResult: PolicyCheckResult = {
        allowed: false,
        reason: 'User lacks permission for high-risk tools',
      };

      (mockClient.checkAccess as any).mockResolvedValue(deniedResult);

      const result = await mockClient.checkAccess(request);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('User lacks permission for high-risk tools');
    });

    it('should batch check multiple tools efficiently', async () => {
      const requests: PolicyCheckRequest[] = [
        { userId: 'user-123', toolName: 'read_file' },
        { userId: 'user-123', toolName: 'write_file' },
        { userId: 'user-123', toolName: 'execute_code' },
      ];

      const batchResults = new Map<string, PolicyCheckResult>([
        ['read_file', { allowed: true }],
        ['write_file', { allowed: true }],
        ['execute_code', { allowed: false, reason: 'Restricted tool' }],
      ]);

      (mockClient.checkBatchAccess as any).mockResolvedValue(batchResults);

      const results = await mockClient.checkBatchAccess(requests);

      expect(results.size).toBe(3);
      expect(results.get('read_file')?.allowed).toBe(true);
      expect(results.get('write_file')?.allowed).toBe(true);
      expect(results.get('execute_code')?.allowed).toBe(false);
      expect(mockClient.checkBatchAccess).toHaveBeenCalledTimes(1);
    });

    it('should handle unavailable policy service', async () => {
      (mockClient.isAvailable as any).mockResolvedValue(false);

      const available = await mockClient.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe('filterToolsByPolicy', () => {
    const createMockTool = (name: string, category: string = 'filesystem'): Tool => ({
      name,
      description: `Mock tool: ${name}`,
      use_cases: ['test'],
      category: category as any,
      parameters: { type: 'object', properties: {} },
      handler: async () => ({}),
    });

    const mockContext: ToolContext = {
      user_id: 'user-123',
      platform: 'mattermost',
      room_id: 'team-456',
      credentials: {},
    };

    it('should filter out disallowed tools', async () => {
      const tools = [
        createMockTool('read_file'),
        createMockTool('write_file'),
        createMockTool('execute_code'),
      ];

      const mockClient: PolicyClient = {
        checkAccess: jest.fn() as any,
        checkBatchAccess: (jest.fn() as any).mockResolvedValue(
          new Map([
            ['read_file', { allowed: true }],
            ['write_file', { allowed: true }],
            ['execute_code', { allowed: false, reason: 'High risk tool' }],
          ])
        ),
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };

      const filtered = await filterToolsByPolicy(tools, mockContext, mockClient);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.name)).toEqual(['read_file', 'write_file']);
      expect(mockClient.checkBatchAccess).toHaveBeenCalledTimes(1);
    });

    it('should return all tools when policy service is unavailable', async () => {
      const tools = [
        createMockTool('read_file'),
        createMockTool('write_file'),
        createMockTool('execute_code'),
      ];

      const mockClient: PolicyClient = {
        checkAccess: jest.fn() as any,
        checkBatchAccess: jest.fn() as any, // Should not be called
        isAvailable: (jest.fn() as any).mockResolvedValue(false),
      };

      const filtered = await filterToolsByPolicy(tools, mockContext, mockClient);

      expect(filtered).toHaveLength(3);
      expect(filtered).toEqual(tools);
      expect(mockClient.checkBatchAccess).not.toHaveBeenCalled();
    });

    it('should default to allowing tools with missing results', async () => {
      const tools = [
        createMockTool('read_file'),
        createMockTool('write_file'),
        createMockTool('unknown_tool'),
      ];

      const mockClient: PolicyClient = {
        checkAccess: jest.fn() as any,
        checkBatchAccess: (jest.fn() as any).mockResolvedValue(
          new Map([
            ['read_file', { allowed: true }],
            ['write_file', { allowed: false }],
            // unknown_tool deliberately missing from results
          ])
        ),
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };

      const filtered = await filterToolsByPolicy(tools, mockContext, mockClient);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.name)).toContain('read_file');
      expect(filtered.map(t => t.name)).toContain('unknown_tool');
      expect(filtered.map(t => t.name)).not.toContain('write_file');
    });

    it('should pass correct context to batch check', async () => {
      const tools = [
        createMockTool('read_file', 'filesystem'),
        createMockTool('search_web', 'web'),
      ];

      const mockClient: PolicyClient = {
        checkAccess: jest.fn() as any,
        checkBatchAccess: (jest.fn() as any).mockResolvedValue(new Map()),
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };

      await filterToolsByPolicy(tools, mockContext, mockClient);

      expect(mockClient.checkBatchAccess).toHaveBeenCalledWith([
        {
          userId: 'user-123',
          toolName: 'read_file',
          platform: 'mattermost',
          teamId: 'team-456',
          context: { category: 'filesystem' },
        },
        {
          userId: 'user-123',
          toolName: 'search_web',
          platform: 'mattermost',
          teamId: 'team-456',
          context: { category: 'web' },
        },
      ]);
    });
  });

  describe('guardToolExecution', () => {
    const mockContext: ToolContext = {
      user_id: 'user-123',
      platform: 'mattermost',
      room_id: 'team-456',
      credentials: {},
    };

    it('should allow execution when policy allows', async () => {
      const mockClient: PolicyClient = {
        checkAccess: (jest.fn() as any).mockResolvedValue({ allowed: true }),
        checkBatchAccess: jest.fn() as any,
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };

      await expect(
        guardToolExecution('read_file', mockContext, mockClient)
      ).resolves.toBeUndefined();

      expect(mockClient.checkAccess).toHaveBeenCalledWith({
        userId: 'user-123',
        toolName: 'read_file',
        platform: 'mattermost',
        teamId: 'team-456',
      });
    });

    it('should throw error when policy denies', async () => {
      const mockClient: PolicyClient = {
        checkAccess: (jest.fn() as any).mockResolvedValue({
          allowed: false,
          reason: 'User lacks permission for this tool',
        }),
        checkBatchAccess: jest.fn() as any,
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };

      await expect(
        guardToolExecution('execute_code', mockContext, mockClient)
      ).rejects.toThrow('User lacks permission for this tool');
    });

    it('should throw generic error when no reason provided', async () => {
      const mockClient: PolicyClient = {
        checkAccess: (jest.fn() as any).mockResolvedValue({ allowed: false }),
        checkBatchAccess: jest.fn() as any,
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };

      await expect(
        guardToolExecution('delete_file', mockContext, mockClient)
      ).rejects.toThrow('Access denied to tool: delete_file');
    });

    it('should allow execution when policy service is unavailable', async () => {
      const mockClient: PolicyClient = {
        checkAccess: jest.fn() as any, // Should not be called
        checkBatchAccess: jest.fn() as any,
        isAvailable: (jest.fn() as any).mockResolvedValue(false),
      };

      await expect(
        guardToolExecution('any_tool', mockContext, mockClient)
      ).resolves.toBeUndefined();

      expect(mockClient.checkAccess).not.toHaveBeenCalled();
    });
  });

  describe('Policy Integration Patterns', () => {
    it('should support two-stage filtering pattern', async () => {
      // Stage 1: Schema filtering before LLM
      const allTools = [
        {
          name: 'read_file',
          description: 'Read file',
          use_cases: ['read'],
          category: 'filesystem' as const,
          parameters: { type: 'object' as const, properties: {} },
          handler: async () => ({}),
        },
        {
          name: 'execute_code',
          description: 'Execute code',
          use_cases: ['execute'],
          category: 'compute' as const,
          parameters: { type: 'object' as const, properties: {} },
          handler: async () => ({}),
        },
      ];

      const mockContext: ToolContext = {
        user_id: 'user-123',
        platform: 'mattermost',
        credentials: {},
      };

      const mockClient: PolicyClient = {
        checkAccess: (jest.fn() as any).mockImplementation((req: PolicyCheckRequest) => {
          if (req.toolName === 'read_file') {
            return Promise.resolve({ allowed: true });
          }
          return Promise.resolve({ allowed: false, reason: 'Tool not allowed' });
        }),
        checkBatchAccess: (jest.fn() as any).mockResolvedValue(
          new Map([
            ['read_file', { allowed: true }],
            ['execute_code', { allowed: false }],
          ])
        ),
        isAvailable: (jest.fn() as any).mockResolvedValue(true),
      };

      // Stage 1: Filter before LLM
      const filteredTools = await filterToolsByPolicy(allTools, mockContext, mockClient);
      expect(filteredTools).toHaveLength(1);
      expect(filteredTools[0].name).toBe('read_file');

      // Stage 2: Guard before execution
      await expect(
        guardToolExecution('read_file', mockContext, mockClient)
      ).resolves.toBeUndefined();

      await expect(
        guardToolExecution('execute_code', mockContext, mockClient)
      ).rejects.toThrow();
    });

    it('should work with optional policy client', async () => {
      // No policy client = allow all
      const allowAll = new AllowAllPolicyClient();

      const tools = [
        {
          name: 'any_tool',
          description: 'Any tool',
          use_cases: ['any'],
          category: 'filesystem' as const,
          parameters: { type: 'object' as const, properties: {} },
          handler: async () => ({}),
        },
      ];

      const mockContext: ToolContext = {
        user_id: 'user-123',
        platform: 'mattermost',
        credentials: {},
      };

      const filtered = await filterToolsByPolicy(tools, mockContext, allowAll);
      expect(filtered).toEqual(tools);

      await expect(
        guardToolExecution('any_tool', mockContext, allowAll)
      ).resolves.toBeUndefined();
    });
  });
});
