/**
 * Access Tiers Configuration
 *
 * Controls which tools and LLM models are available to different user tiers.
 * Configured via environment variables, designed to be dashboard-configurable later.
 *
 * Environment variables:
 * - ADMIN_ONLY_TOOLS: Comma-separated tool names restricted to admins
 * - ADMIN_ONLY_CATEGORIES: Comma-separated categories restricted to admins
 * - ADMIN_LLM_MODEL: Default model for admin users (e.g., claude-opus-4-5-20251101)
 * - USER_LLM_MODEL: Default model for non-admin users (e.g., claude-sonnet-4-5-20250929)
 * - ADMIN_LLM_PROVIDERS: Comma-separated providers admins can use (e.g., bedrock,anthropic)
 * - USER_LLM_PROVIDERS: Comma-separated providers non-admins can use (e.g., ollama,vertex)
 */

export interface AccessTierConfig {
  // Tool access
  adminOnlyTools: Set<string>;
  adminOnlyCategories: Set<string>;

  // LLM access
  adminLlmModel: string | null;
  userLlmModel: string | null;
  adminLlmProviders: Set<string>;
  userLlmProviders: Set<string>;
}

// Default admin-only tools (can be overridden by env)
const DEFAULT_ADMIN_ONLY_TOOLS = [
  // CRM tools - access to customer data
  'update_attio_person',
  'add_attio_note',
  'link_attio_person_company',
  // Docs tools - access to internal docs
  'create_notion_page',
  'update_notion_page',
  'search_notion',
  // Code tools - repo access
  'create_github_issue',
  'create_pull_request',
  'merge_pull_request',
  'github_search',
];

// Default admin-only categories
const DEFAULT_ADMIN_ONLY_CATEGORIES: string[] = [
  // No categories by default - let individual tools be gated
];

/**
 * Parse comma-separated env var into a Set
 */
function parseEnvList(envVar: string | undefined, defaults: string[] = []): Set<string> {
  if (!envVar) {
    return new Set(defaults);
  }

  const items = envVar.split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return new Set(items);
}

/**
 * Load access tier configuration from environment
 */
export function loadAccessTierConfig(): AccessTierConfig {
  return {
    // Tool access
    adminOnlyTools: parseEnvList(process.env.ADMIN_ONLY_TOOLS, DEFAULT_ADMIN_ONLY_TOOLS),
    adminOnlyCategories: parseEnvList(process.env.ADMIN_ONLY_CATEGORIES, DEFAULT_ADMIN_ONLY_CATEGORIES),

    // LLM access
    adminLlmModel: process.env.ADMIN_LLM_MODEL || null,
    userLlmModel: process.env.USER_LLM_MODEL || null,
    adminLlmProviders: parseEnvList(process.env.ADMIN_LLM_PROVIDERS),
    userLlmProviders: parseEnvList(process.env.USER_LLM_PROVIDERS),
  };
}

// Cached config (reloads on process restart)
let _config: AccessTierConfig | null = null;

export function getAccessTierConfig(): AccessTierConfig {
  if (!_config) {
    _config = loadAccessTierConfig();

    // Log configuration on first load
    console.log('🔐 Access Tiers Configuration:');
    console.log(`   Admin-only tools: ${_config.adminOnlyTools.size > 0 ? Array.from(_config.adminOnlyTools).join(', ') : '(none)'}`);
    console.log(`   Admin-only categories: ${_config.adminOnlyCategories.size > 0 ? Array.from(_config.adminOnlyCategories).join(', ') : '(none)'}`);
    if (_config.adminLlmModel) console.log(`   Admin LLM model: ${_config.adminLlmModel}`);
    if (_config.userLlmModel) console.log(`   User LLM model: ${_config.userLlmModel}`);
    if (_config.adminLlmProviders.size > 0) console.log(`   Admin LLM providers: ${Array.from(_config.adminLlmProviders).join(', ')}`);
    if (_config.userLlmProviders.size > 0) console.log(`   User LLM providers: ${Array.from(_config.userLlmProviders).join(', ')}`);
  }
  return _config;
}

/**
 * Force reload config (useful for testing or hot-reload from dashboard)
 */
export function reloadAccessTierConfig(): AccessTierConfig {
  _config = null;
  return getAccessTierConfig();
}

/**
 * Check if a tool is restricted to admins
 */
export function isToolAdminOnly(toolName: string, toolCategory?: string): boolean {
  const config = getAccessTierConfig();

  // Check if tool is explicitly admin-only
  if (config.adminOnlyTools.has(toolName)) {
    return true;
  }

  // Check if tool's category is admin-only
  if (toolCategory && config.adminOnlyCategories.has(toolCategory)) {
    return true;
  }

  return false;
}

/**
 * Get the appropriate LLM model for a user tier
 */
export function getLlmModelForUser(isAdmin: boolean, requestedModel?: string): string | null {
  const config = getAccessTierConfig();

  // If a specific model is requested, check if user can use it
  if (requestedModel) {
    // Admins can use any model
    if (isAdmin) {
      return requestedModel;
    }

    // Non-admins: check if requested model is the admin model (blocked)
    if (config.adminLlmModel && requestedModel === config.adminLlmModel) {
      console.log(`⚠️ Non-admin requested admin-only model ${requestedModel}, downgrading to ${config.userLlmModel || 'default'}`);
      return config.userLlmModel;
    }

    return requestedModel;
  }

  // No specific model requested, use tier default
  if (isAdmin && config.adminLlmModel) {
    return config.adminLlmModel;
  }

  if (!isAdmin && config.userLlmModel) {
    return config.userLlmModel;
  }

  return null; // Let system decide
}

/**
 * Get allowed LLM providers for a user tier
 */
export function getAllowedLlmProviders(isAdmin: boolean): Set<string> | null {
  const config = getAccessTierConfig();

  if (isAdmin && config.adminLlmProviders.size > 0) {
    return config.adminLlmProviders;
  }

  if (!isAdmin && config.userLlmProviders.size > 0) {
    return config.userLlmProviders;
  }

  return null; // All providers allowed
}

/**
 * Check if a provider is allowed for a user tier
 */
export function isProviderAllowed(provider: string, isAdmin: boolean): boolean {
  const allowedProviders = getAllowedLlmProviders(isAdmin);

  // If no restrictions, allow all
  if (!allowedProviders) {
    return true;
  }

  return allowedProviders.has(provider);
}

/**
 * Filter tools based on user access tier
 * Used to remove admin-only tools from non-admin users' available tools
 */
export function filterToolsByAccessTier<T extends { name: string; category?: string }>(
  tools: T[],
  isAdmin: boolean
): T[] {
  if (isAdmin) {
    return tools; // Admins get all tools
  }

  return tools.filter(tool => !isToolAdminOnly(tool.name, tool.category));
}
