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
export declare class AllowAllPolicyClient implements PolicyClient {
    checkAccess(_request: PolicyCheckRequest): Promise<PolicyCheckResult>;
    checkBatchAccess(requests: PolicyCheckRequest[]): Promise<Map<string, PolicyCheckResult>>;
    isAvailable(): Promise<boolean>;
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
export declare function filterToolsByPolicy(tools: Tool[], context: ToolContext, policyClient: PolicyClient): Promise<Tool[]>;
/**
 * Guard a tool execution with policy check
 * This is the second stage of enforcement - before actually running the tool.
 *
 * @param toolName Tool being executed
 * @param context User context
 * @param policyClient Policy client to check access
 * @throws Error if access is denied
 */
export declare function guardToolExecution(toolName: string, context: ToolContext, policyClient: PolicyClient): Promise<void>;
