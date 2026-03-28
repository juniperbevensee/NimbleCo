/**
 * Generic Policy Client Interface
 *
 * This interface provides optional policy enforcement for tool access control.
 * It's designed to be:
 * - Generic (no specific vendor/product references)
 * - Optional (works with or without a policy service)
 * - Two-stage filtering:
 *   1. Schema filtering BEFORE LLM (reduce context window)
 *   2. Execution guard BEFORE tool runs (prevent unauthorized calls)
 */

import { Tool, ToolContext } from '../base';

/**
 * Result of a policy check
 */
export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  /** Metadata from policy service (logging, audit, etc.) */
  metadata?: Record<string, any>;
}

/**
 * Request to check tool access policy
 */
export interface PolicyCheckRequest {
  /** User identifier */
  userId: string;
  /** Tool name being accessed */
  toolName: string;
  /** Platform context (mattermost, discord, etc.) */
  platform?: string;
  /** Team/channel context */
  teamId?: string;
  channelId?: string;
  /** Additional context for policy decision */
  context?: Record<string, any>;
}

/**
 * Policy client interface for tool access control
 *
 * Implementations can provide:
 * - Remote policy service checks
 * - Local config-based policies
 * - No-op (allow all) for standalone mode
 */
export interface PolicyClient {
  /**
   * Check if a user can access a tool
   * Used for both schema filtering and execution guards
   */
  checkAccess(request: PolicyCheckRequest): Promise<PolicyCheckResult>;

  /**
   * Check access for multiple tools (batch operation)
   * Useful for schema filtering before LLM
   */
  checkBatchAccess(requests: PolicyCheckRequest[]): Promise<Map<string, PolicyCheckResult>>;

  /**
   * Health check for policy service
   * Returns false if service is unavailable (fall back to allow-all mode)
   */
  isAvailable(): Promise<boolean>;
}

/**
 * No-op policy client that allows all access
 * Used when policy enforcement is disabled or unavailable
 */
export class AllowAllPolicyClient implements PolicyClient {
  async checkAccess(_request: PolicyCheckRequest): Promise<PolicyCheckResult> {
    return { allowed: true };
  }

  async checkBatchAccess(requests: PolicyCheckRequest[]): Promise<Map<string, PolicyCheckResult>> {
    const results = new Map<string, PolicyCheckResult>();
    for (const req of requests) {
      results.set(req.toolName, { allowed: true });
    }
    return results;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

/**
 * Filter tools based on policy before sending to LLM
 * This reduces the context window and prevents the LLM from trying to use
 * tools that the user doesn't have access to.
 *
 * @param tools All available tools
 * @param context User context
 * @param policyClient Policy client to check access
 * @returns Filtered tools that user has access to
 */
export async function filterToolsByPolicy(
  tools: Tool[],
  context: ToolContext,
  policyClient: PolicyClient
): Promise<Tool[]> {
  // If policy client is unavailable, return all tools
  const available = await policyClient.isAvailable();
  if (!available) {
    return tools;
  }

  // Build batch request
  const requests: PolicyCheckRequest[] = tools.map(tool => ({
    userId: context.user_id,
    toolName: tool.name,
    platform: context.platform,
    teamId: context.room_id, // room_id often maps to team
    context: { category: tool.category },
  }));

  // Check access for all tools
  const results = await policyClient.checkBatchAccess(requests);

  // Filter to only allowed tools
  return tools.filter(tool => {
    const result = results.get(tool.name);
    return result?.allowed ?? true; // Default to allow if no result
  });
}

/**
 * Guard a tool execution with policy check
 * This is the second stage of enforcement - before actually running the tool.
 *
 * @param toolName Tool being executed
 * @param context User context
 * @param policyClient Policy client to check access
 * @throws Error if access is denied
 */
export async function guardToolExecution(
  toolName: string,
  context: ToolContext,
  policyClient: PolicyClient
): Promise<void> {
  // If policy client is unavailable, allow execution
  const available = await policyClient.isAvailable();
  if (!available) {
    return;
  }

  // Check access
  const result = await policyClient.checkAccess({
    userId: context.user_id,
    toolName,
    platform: context.platform,
    teamId: context.room_id,
  });

  if (!result.allowed) {
    throw new Error(result.reason || `Access denied to tool: ${toolName}`);
  }
}
