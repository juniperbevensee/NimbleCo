/**
 * Test Policy Integration: Schema Filtering and Execution Guard
 *
 * These tests verify that:
 * 1. Schema Filtering: Tools are filtered based on policy BEFORE LLM call
 * 2. Execution Guard: Tool execution is blocked based on policy BEFORE actual execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Tool,
  ToolContext,
  PolicyClient,
  PolicyCheckRequest,
  PolicyCheckResult,
  filterToolsByPolicy,
  guardToolExecution
} from '@nimbleco/tools';

describe('Policy Integration: Schema Filtering', () => {
  let mockPolicyClient: PolicyClient;
  let mockContext: ToolContext;
  let sampleTools: Tool[];

  beforeEach(() => {
    // Setup mock context
    mockContext = {
      user_id: 'user123',
      platform: 'mattermost',
      room_id: 'team456',
      invocation_id: 'inv789',
    };

    // Setup sample tools
    sampleTools = [
      {
        name: 'read_file',
        description: 'Read file contents',
        category: 'filesystem',
        input_schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      },
      {
        name: 'write_file',
        description: 'Write to file',
        category: 'filesystem',
        input_schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      },
      {
        name: 'execute_bash',
        description: 'Execute bash command',
        category: 'system',
        input_schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      },
    ];

    // Setup mock policy client (default: deny all)
    mockPolicyClient = {
      checkAccess: vi.fn().mockResolvedValue({ allowed: false }),
      checkBatchAccess: vi.fn().mockResolvedValue(new Map()),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
  });

  it('should filter out tools that are denied by policy', async () => {
    // Arrange: Policy denies 'write_file' and 'execute_bash'
    const allowedTools = new Map<string, PolicyCheckResult>([
      ['read_file', { allowed: true }],
      ['write_file', { allowed: false, reason: 'User lacks write permission' }],
      ['execute_bash', { allowed: false, reason: 'User lacks execute permission' }],
    ]);

    (mockPolicyClient.checkBatchAccess as any).mockResolvedValue(allowedTools);

    // Act: Filter tools
    const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, mockPolicyClient);

    // Assert: Only 'read_file' should remain
    expect(filteredTools).toHaveLength(1);
    expect(filteredTools[0].name).toBe('read_file');
    expect(mockPolicyClient.checkBatchAccess).toHaveBeenCalledTimes(1);
  });

  it('should include all tools when policy allows all', async () => {
    // Arrange: Policy allows all tools
    const allowedTools = new Map<string, PolicyCheckResult>([
      ['read_file', { allowed: true }],
      ['write_file', { allowed: true }],
      ['execute_bash', { allowed: true }],
    ]);

    (mockPolicyClient.checkBatchAccess as any).mockResolvedValue(allowedTools);

    // Act: Filter tools
    const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, mockPolicyClient);

    // Assert: All tools should remain
    expect(filteredTools).toHaveLength(3);
    expect(filteredTools.map(t => t.name)).toEqual(['read_file', 'write_file', 'execute_bash']);
  });

  it('should return all tools when policy client is unavailable', async () => {
    // Arrange: Policy client is unavailable (fallback mode)
    (mockPolicyClient.isAvailable as any).mockResolvedValue(false);

    // Act: Filter tools
    const filteredTools = await filterToolsByPolicy(sampleTools, mockContext, mockPolicyClient);

    // Assert: All tools should remain (fail-safe)
    expect(filteredTools).toHaveLength(3);
    expect(mockPolicyClient.checkBatchAccess).not.toHaveBeenCalled();
  });

  it('should pass correct context to policy client', async () => {
    // Arrange
    const allowedTools = new Map<string, PolicyCheckResult>([
      ['read_file', { allowed: true }],
      ['write_file', { allowed: true }],
      ['execute_bash', { allowed: true }],
    ]);
    (mockPolicyClient.checkBatchAccess as any).mockResolvedValue(allowedTools);

    // Act
    await filterToolsByPolicy(sampleTools, mockContext, mockPolicyClient);

    // Assert: Verify policy client received correct context
    expect(mockPolicyClient.checkBatchAccess).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user123',
          toolName: 'read_file',
          platform: 'mattermost',
          teamId: 'team456',
        }),
      ])
    );
  });

  it('should handle empty tool list gracefully', async () => {
    // Arrange: No tools
    const emptyTools: Tool[] = [];
    (mockPolicyClient.checkBatchAccess as any).mockResolvedValue(new Map());

    // Act
    const filteredTools = await filterToolsByPolicy(emptyTools, mockContext, mockPolicyClient);

    // Assert
    expect(filteredTools).toHaveLength(0);
  });
});

describe('Policy Integration: Execution Guard', () => {
  let mockPolicyClient: PolicyClient;
  let mockContext: ToolContext;

  beforeEach(() => {
    mockContext = {
      user_id: 'user123',
      platform: 'mattermost',
      room_id: 'team456',
      invocation_id: 'inv789',
    };

    mockPolicyClient = {
      checkAccess: vi.fn().mockResolvedValue({ allowed: true }),
      checkBatchAccess: vi.fn().mockResolvedValue(new Map()),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
  });

  it('should allow tool execution when policy permits', async () => {
    // Arrange
    (mockPolicyClient.checkAccess as any).mockResolvedValue({ allowed: true });

    // Act & Assert: Should not throw
    await expect(
      guardToolExecution('read_file', mockContext, mockPolicyClient)
    ).resolves.toBeUndefined();

    expect(mockPolicyClient.checkAccess).toHaveBeenCalledTimes(1);
  });

  it('should block tool execution when policy denies', async () => {
    // Arrange
    (mockPolicyClient.checkAccess as any).mockResolvedValue({
      allowed: false,
      reason: 'User lacks permission to execute bash commands',
    });

    // Act & Assert: Should throw error
    await expect(
      guardToolExecution('execute_bash', mockContext, mockPolicyClient)
    ).rejects.toThrow('User lacks permission to execute bash commands');

    expect(mockPolicyClient.checkAccess).toHaveBeenCalledTimes(1);
  });

  it('should provide default error message when policy denies without reason', async () => {
    // Arrange
    (mockPolicyClient.checkAccess as any).mockResolvedValue({ allowed: false });

    // Act & Assert: Should throw default error
    await expect(
      guardToolExecution('write_file', mockContext, mockPolicyClient)
    ).rejects.toThrow('Access denied to tool: write_file');
  });

  it('should allow execution when policy client is unavailable', async () => {
    // Arrange: Policy client unavailable (fallback mode)
    (mockPolicyClient.isAvailable as any).mockResolvedValue(false);

    // Act & Assert: Should not throw (fail-safe)
    await expect(
      guardToolExecution('execute_bash', mockContext, mockPolicyClient)
    ).resolves.toBeUndefined();

    expect(mockPolicyClient.checkAccess).not.toHaveBeenCalled();
  });

  it('should pass correct tool name and context to policy client', async () => {
    // Arrange
    (mockPolicyClient.checkAccess as any).mockResolvedValue({ allowed: true });

    // Act
    await guardToolExecution('read_file', mockContext, mockPolicyClient);

    // Assert
    expect(mockPolicyClient.checkAccess).toHaveBeenCalledWith({
      userId: 'user123',
      toolName: 'read_file',
      platform: 'mattermost',
      teamId: 'team456',
    });
  });
});
