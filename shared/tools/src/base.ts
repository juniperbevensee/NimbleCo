// Base interfaces for tools - simple, direct API access
// No MCP abstraction - just practical tool definitions

export interface ToolContext {
  user_id: string;
  platform: 'signal' | 'mattermost' | 'discord' | 'matrix';
  credentials: Record<string, string>;
  // Conversation history for context-aware caching
  conversation_id?: string;
  // Room/channel context for permission checks
  room_id?: string;
  // Agent ID for inter-agent communication
  agent_id?: string;
  // Unique invocation ID for tracking tool calls
  invocation_id?: string;
}

export interface Tool {
  name: string;
  description: string;
  // When to use this tool (for agent selection)
  use_cases: string[];
  // Category for grouping (reduces prompt size)
  category: 'crm' | 'calendar' | 'docs' | 'meetings' | 'code' | 'sales' | 'storage' | 'filesystem' | 'web' | 'compute' | 'research' | 'communication' | 'analytics';
  // Input schema (simple JSON schema)
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  // Direct handler - no abstraction
  handler: (input: any, context: ToolContext) => Promise<any>;

  // Required environment variables - tool won't be offered if these aren't set
  // e.g., ['ATTIO_API_KEY'] or ['GITHUB_TOKEN']
  requiredEnv?: string[];

  // Permission controls (inspired by cantrip-integrations-signal)
  // Sensitive tools (logs, analytics, monitoring) require admin OR context room
  permissions?: {
    requiresAdmin?: boolean; // Only admins can use this tool
    requiresContextRoom?: boolean; // Non-admins can only use for their current room
    sensitiveReason?: string; // Why this tool is sensitive (for error messages)
  };
}

/**
 * Check if a tool has its required environment variables set
 */
export function isToolConfigured(tool: Tool): boolean {
  if (!tool.requiredEnv || tool.requiredEnv.length === 0) {
    return true; // No requirements
  }
  return tool.requiredEnv.every(envVar => {
    const value = process.env[envVar];
    return value && value.trim().length > 0;
  });
}

/**
 * Filter tools to only include those with required env vars configured
 */
export function filterConfiguredTools<T extends Tool>(tools: T[]): T[] {
  return tools.filter(isToolConfigured);
}

// Tool selection strategy - this is the KEY problem
export interface ToolSelector {
  // Select relevant tools based on task
  selectTools(task: string, allTools: Tool[]): Tool[];

  // Group tools by category for staged prompting
  groupByCategory(tools: Tool[]): Map<string, Tool[]>;
}

// Prompt caching strategy
export interface PromptCache {
  // Cache tool definitions for reuse
  cacheToolDefinitions(tools: Tool[]): string;

  // Get cached prompt + new task
  buildPrompt(cachedId: string, task: string): string;
}

// Tool registry - simple discovery
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  // Get tools by category (reduces prompt bloat)
  getByCategory(category: string): Tool[] {
    return Array.from(this.tools.values())
      .filter(t => t.category === category);
  }

  // Search tools by use case
  findByUseCase(useCase: string): Tool[] {
    return Array.from(this.tools.values())
      .filter(t => t.use_cases.some(uc =>
        uc.toLowerCase().includes(useCase.toLowerCase())
      ));
  }

  // Get all tool names (for lightweight agent awareness)
  getAllNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  // Get all registered tools (useful for export/introspection)
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }
}

// Tiered tool loading strategy
export class TieredToolLoader {
  constructor(private registry: ToolRegistry) {}

  // Tier 1: Always available (10-15 core tools)
  getCoreTools(): Tool[] {
    return [
      ...this.registry.getByCategory('crm'),
      ...this.registry.getByCategory('calendar'),
    ].slice(0, 15);
  }

  // Tier 2: Load on-demand by category
  getToolsForTask(task: string): Tool[] {
    // Simple heuristics - can be made smarter
    const categories: string[] = [];

    if (task.match(/meeting|schedule|calendar/i)) categories.push('calendar', 'meetings');
    if (task.match(/contact|crm|customer/i)) categories.push('crm');
    if (task.match(/doc|notion|write/i)) categories.push('docs');
    if (task.match(/code|pr|review/i)) categories.push('code');

    return categories.flatMap(cat => this.registry.getByCategory(cat));
  }

  // Tier 3: Search-based loading
  searchTools(query: string): Tool[] {
    return this.registry.findByUseCase(query);
  }
}
