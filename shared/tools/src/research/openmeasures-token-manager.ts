/**
 * Manages Open Measures API tokens with automatic refresh
 */

import { OpenMeasuresClient } from 'open-measures';

interface TokenState {
  accessToken: string;
  expiresAt: Date;
}

class OpenMeasuresTokenManager {
  private tokenState: TokenState | null = null;
  private refreshToken: string;
  private refreshPromise: Promise<string> | null = null;

  constructor(initialAccessToken: string, refreshToken: string) {
    this.refreshToken = refreshToken;
    this.setAccessToken(initialAccessToken);
  }

  private setAccessToken(token: string) {
    try {
      // Decode JWT to get expiration
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 3600000); // Default 1 hour

      this.tokenState = {
        accessToken: token,
        expiresAt,
      };

      console.log(`✓ Open Measures token set (expires: ${expiresAt.toISOString()})`);
    } catch (e) {
      console.warn('⚠️  Could not decode JWT expiration, assuming valid for 1 hour');
      this.tokenState = {
        accessToken: token,
        expiresAt: new Date(Date.now() + 3600000),
      };
    }
  }

  private isTokenExpired(): boolean {
    if (!this.tokenState) return true;
    // Refresh 5 minutes before actual expiration
    const bufferMs = 5 * 60 * 1000;
    return new Date().getTime() + bufferMs >= this.tokenState.expiresAt.getTime();
  }

  async getValidAccessToken(): Promise<string> {
    // If token is still valid, return it
    if (this.tokenState && !this.isTokenExpired()) {
      return this.tokenState.accessToken;
    }

    // If refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start refresh
    this.refreshPromise = this.refreshAccessToken();

    try {
      const newToken = await this.refreshPromise;
      return newToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshAccessToken(): Promise<string> {
    console.log('🔄 Refreshing Open Measures access token...');

    try {
      // Create a client with no API key to access the public refresh endpoint
      const client = new OpenMeasuresClient();
      const response = await client.getAccessToken({
        refresh_token: this.refreshToken,
      });

      if (!response.access_token) {
        throw new Error('No access token in refresh response');
      }

      this.setAccessToken(response.access_token);
      console.log('✅ Access token refreshed successfully');

      return response.access_token;
    } catch (error: any) {
      console.error('❌ Failed to refresh Open Measures token:', error.message);
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }
}

// Global token manager instance
let tokenManager: OpenMeasuresTokenManager | null = null;

/**
 * Initialize the token manager (call once at startup)
 */
export function initializeTokenManager(accessToken: string, refreshToken: string) {
  tokenManager = new OpenMeasuresTokenManager(accessToken, refreshToken);
}

/**
 * Get a valid access token (refreshes if needed)
 */
export async function getValidAccessToken(): Promise<string> {
  if (!tokenManager) {
    throw new Error('OpenMeasuresTokenManager not initialized. Call initializeTokenManager() first.');
  }
  return tokenManager.getValidAccessToken();
}

/**
 * Check if token manager is initialized
 */
export function isInitialized(): boolean {
  return tokenManager !== null;
}
