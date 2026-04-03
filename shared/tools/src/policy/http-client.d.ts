/**
 * HTTP Policy Client Implementation
 *
 * Calls external policy service (e.g., Swarm-Map) for tool access control.
 * Implements fail-open behavior - if service is unavailable, allows all access.
 *
 * Configuration:
 * - POLICY_CHECK_URL: Base URL of policy service (e.g., http://localhost:3000)
 */
import { PolicyClient, PolicyCheckRequest, PolicyCheckResult } from './client';
export interface HttpPolicyClientConfig {
    /** Base URL of policy service (e.g., http://localhost:3000) */
    baseUrl: string;
    /** Timeout in milliseconds (default: 5000) */
    timeout?: number;
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * HTTP implementation of PolicyClient
 * Calls Swarm-Map (or compatible) policy API
 */
export declare class HttpPolicyClient implements PolicyClient {
    private baseUrl;
    private timeout;
    private debug;
    private isServiceAvailable;
    private lastHealthCheck;
    private healthCheckInterval;
    constructor(config: HttpPolicyClientConfig);
    /**
     * Check if policy service is available
     * Caches result for healthCheckInterval to avoid hammering the service
     */
    isAvailable(): Promise<boolean>;
    /**
     * Check access for a single tool
     */
    checkAccess(request: PolicyCheckRequest): Promise<PolicyCheckResult>;
    /**
     * Check access for multiple tools (batch)
     */
    checkBatchAccess(requests: PolicyCheckRequest[]): Promise<Map<string, PolicyCheckResult>>;
    private log;
}
/**
 * Create HTTP PolicyClient from environment variables
 *
 * Environment:
 * - POLICY_CHECK_URL: Base URL of policy service
 * - POLICY_CHECK_TIMEOUT: Timeout in milliseconds (optional, default: 5000)
 * - POLICY_CHECK_DEBUG: Enable debug logging (optional)
 *
 * @returns HttpPolicyClient if configured, null otherwise
 */
export declare function createHttpPolicyClientFromEnv(): HttpPolicyClient | null;
