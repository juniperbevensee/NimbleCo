/**
 * HTTP Policy Client Implementation
 *
 * Calls external policy service (e.g., Swarm-Map) for tool access control.
 * Implements fail-open behavior - if service is unavailable, allows all access.
 *
 * Configuration:
 * - POLICY_CHECK_URL: Base URL of policy service (e.g., http://localhost:3000)
 */

import {
  PolicyClient,
  PolicyCheckRequest,
  PolicyCheckResult,
} from './client';

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
export class HttpPolicyClient implements PolicyClient {
  private baseUrl: string;
  private timeout: number;
  private debug: boolean;
  private isServiceAvailable: boolean = true;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 30000; // 30 seconds

  constructor(config: HttpPolicyClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = config.timeout || 5000;
    this.debug = config.debug || false;

    this.log(`Initialized HTTP PolicyClient: ${this.baseUrl}`);
  }

  /**
   * Check if policy service is available
   * Caches result for healthCheckInterval to avoid hammering the service
   */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();

    // Use cached result if recent
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isServiceAvailable;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/policy/health`, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });

      clearTimeout(timeoutId);

      this.isServiceAvailable = response.ok;
      this.lastHealthCheck = now;

      this.log(`Health check: ${this.isServiceAvailable ? 'OK' : 'FAILED'}`);

      return this.isServiceAvailable;
    } catch (error) {
      this.log(`Health check failed: ${error}`);
      this.isServiceAvailable = false;
      this.lastHealthCheck = now;
      return false;
    }
  }

  /**
   * Check access for a single tool
   */
  async checkAccess(request: PolicyCheckRequest): Promise<PolicyCheckResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/policy/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: request.userId,
          toolName: request.toolName,
          metadata: {
            platform: request.platform,
            teamId: request.teamId,
            channelId: request.channelId,
            ...request.context,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const result = await response.json() as {
        allowed: boolean;
        reason?: string;
        tier?: string;
        groups?: string[];
      };

      this.log(
        `checkAccess(${request.userId}, ${request.toolName}): ${result.allowed ? 'ALLOWED' : 'DENIED'}${result.reason ? ` - ${result.reason}` : ''}`
      );

      return {
        allowed: result.allowed,
        reason: result.reason,
        metadata: {
          tier: result.tier,
          groups: result.groups,
        },
      };
    } catch (error) {
      this.log(`checkAccess error: ${error} - FAIL OPEN (allowing)`);

      // Fail open - if policy service is down, allow access
      return {
        allowed: true,
        reason: 'Policy service unavailable (fail-open)',
      };
    }
  }

  /**
   * Check access for multiple tools (batch)
   */
  async checkBatchAccess(
    requests: PolicyCheckRequest[]
  ): Promise<Map<string, PolicyCheckResult>> {
    const results = new Map<string, PolicyCheckResult>();

    // If no requests, return empty map
    if (requests.length === 0) {
      return results;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // Convert requests to Swarm-Map format
      const tools = requests.map(req => ({
        name: req.toolName,
        category: req.context?.category,
      }));

      // Use first request's userId (batch assumes same user)
      const userId = requests[0].userId;

      const response = await fetch(`${this.baseUrl}/api/policy/filter-tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          tools,
          metadata: {
            platform: requests[0].platform,
            teamId: requests[0].teamId,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json() as {
        results?: Array<{
          name: string;
          allowed: boolean;
          reason?: string;
          tier?: string;
        }>;
      };

      // Map results back to tool names
      if (data.results && Array.isArray(data.results)) {
        for (const result of data.results) {
          results.set(result.name, {
            allowed: result.allowed,
            reason: result.reason,
            metadata: { tier: result.tier },
          });
        }
      }

      this.log(
        `checkBatchAccess(${requests.length} tools): ${results.size} results, ${Array.from(results.values()).filter(r => r.allowed).length} allowed`
      );

      return results;
    } catch (error) {
      this.log(`checkBatchAccess error: ${error} - FAIL OPEN (allowing all)`);

      // Fail open - if policy service is down, allow all
      for (const req of requests) {
        results.set(req.toolName, {
          allowed: true,
          reason: 'Policy service unavailable (fail-open)',
        });
      }

      return results;
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[HttpPolicyClient] ${message}`);
    }
  }
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
export function createHttpPolicyClientFromEnv(): HttpPolicyClient | null {
  const baseUrl = process.env.POLICY_CHECK_URL;

  if (!baseUrl) {
    return null;
  }

  return new HttpPolicyClient({
    baseUrl,
    timeout: process.env.POLICY_CHECK_TIMEOUT
      ? parseInt(process.env.POLICY_CHECK_TIMEOUT)
      : 5000,
    debug: process.env.POLICY_CHECK_DEBUG === 'true',
  });
}
