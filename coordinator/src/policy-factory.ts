/**
 * Policy Client Factory
 *
 * Creates the appropriate PolicyClient based on environment variables.
 * This centralizes policy client configuration and ensures consistent
 * initialization across the application.
 */

import {
  PolicyClient,
  AllowAllPolicyClient,
} from '../../shared/tools/src/policy/client';
import {
  HttpPolicyClient,
  createHttpPolicyClientFromEnv,
} from '../../shared/tools/src/policy/http-client';

/**
 * Create PolicyClient based on environment configuration
 *
 * Environment variables:
 * - POLICY_CHECK_URL: Base URL of policy service (e.g., http://localhost:3001)
 * - POLICY_CHECK_TIMEOUT: Timeout in milliseconds (optional, default: 5000)
 * - POLICY_CHECK_DEBUG: Enable debug logging (optional, default: false)
 *
 * If POLICY_CHECK_URL is not set or empty, returns AllowAllPolicyClient
 * (standalone mode with no policy enforcement).
 *
 * @returns PolicyClient instance (HttpPolicyClient or AllowAllPolicyClient)
 */
export function createPolicyClient(): PolicyClient {
  const baseUrl = process.env.POLICY_CHECK_URL;

  // If no URL configured, use allow-all mode (standalone)
  if (!baseUrl || baseUrl.trim() === '') {
    console.log('🔓 Policy enforcement disabled (standalone mode)');
    return new AllowAllPolicyClient();
  }

  // Create HTTP policy client
  const httpClient = createHttpPolicyClientFromEnv();
  if (!httpClient) {
    // This shouldn't happen since we check baseUrl above,
    // but provide fallback just in case
    console.warn('⚠️  Failed to create HTTP policy client, falling back to allow-all');
    return new AllowAllPolicyClient();
  }

  console.log(`🔐 Policy enforcement enabled: ${baseUrl}`);
  return httpClient;
}
