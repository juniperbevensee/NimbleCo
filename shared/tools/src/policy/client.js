"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllowAllPolicyClient = void 0;
exports.filterToolsByPolicy = filterToolsByPolicy;
exports.guardToolExecution = guardToolExecution;
/**
 * No-op policy client that allows all access
 * Used when policy enforcement is disabled or unavailable
 */
class AllowAllPolicyClient {
    async checkAccess(_request) {
        return { allowed: true };
    }
    async checkBatchAccess(requests) {
        const results = new Map();
        for (const req of requests) {
            results.set(req.toolName, { allowed: true });
        }
        return results;
    }
    async isAvailable() {
        return true;
    }
}
exports.AllowAllPolicyClient = AllowAllPolicyClient;
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
async function filterToolsByPolicy(tools, context, policyClient) {
    // If policy client is unavailable, return all tools
    const available = await policyClient.isAvailable();
    if (!available) {
        return tools;
    }
    // Build batch request
    const requests = tools.map(tool => ({
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
async function guardToolExecution(toolName, context, policyClient) {
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
