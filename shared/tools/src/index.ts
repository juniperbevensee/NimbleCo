// Central tool registry and selection system
// Solves the REAL problems: tool selection at scale + prompt caching

import { Tool, ToolRegistry, TieredToolLoader, ToolContext } from './base';
import { checkToolPermission, extractTargetRoom, ToolPermissionContext } from './permissions';
import { filterToolsByAccessTier, getLlmModelForUser, isProviderAllowed, getAccessTierConfig } from './access-tiers';
import { attioTools } from './crm/attio';
import { jitsiTools } from './meetings/jitsi';
import { notionTools } from './docs/notion';
import { icsCalendarTools } from './calendar/ics';
import { fileStorageTools } from './storage/files';
import { workspaceTools } from './storage/workspace';
import { batchProcessorTools } from './storage/batch-processor';
import { filesystemTools } from './filesystem/tools';
import { githubTools } from './code/github';
import { webTools } from './web/fetch';
import { computeTools } from './compute/javascript';
import { dataScienceTools } from './compute/data-science';
import { advancedDataScienceTools } from './compute/data-science-advanced';
import { textAnalysisBatchTools } from './compute/text-analysis-batch';
import { openMeasuresTools } from './research/openmeasures';
import { analyticsTools } from './analytics/database';
import { invocationAnalyticsTools } from './analytics/invocations';
import { messageBusTools } from './analytics/message-bus';
import { memoryTools } from './memory/agent-memory';
import { mattermostTools } from './mattermost/tools';
import { interAgentTools } from './messaging/inter-agent';

// Global registry
export const registry = new ToolRegistry();

// Register all tools
[
  ...attioTools,
  ...jitsiTools,
  ...notionTools,
  ...icsCalendarTools,
  ...fileStorageTools,
  ...workspaceTools,
  ...batchProcessorTools,
  ...filesystemTools,
  ...githubTools,
  ...webTools,
  ...computeTools,
  ...dataScienceTools,
  ...advancedDataScienceTools,
  ...textAnalysisBatchTools,
  ...openMeasuresTools,
  ...analyticsTools,
  ...invocationAnalyticsTools,
  ...messageBusTools,
  ...memoryTools,
  ...mattermostTools,
  ...interAgentTools,
].forEach(tool => {
  registry.register(tool);
});

// Tool selection strategies
export class SmartToolSelector {
  constructor(private registry: ToolRegistry) {}

  // Strategy 1: Category-based (fast, deterministic)
  selectByCategory(categories: string[]): Tool[] {
    return categories.flatMap(cat => this.registry.getByCategory(cat));
  }

  // Strategy 2: Use case matching (semantic)
  selectByTask(taskDescription: string): Tool[] {
    // Extract keywords
    const keywords = taskDescription.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3);

    // Score each tool
    const scored = Array.from(this.registry['tools'].values()).map(tool => {
      let score = 0;

      // Match against tool name
      if (keywords.some(kw => tool.name.toLowerCase().includes(kw))) {
        score += 3;
      }

      // Match against description
      keywords.forEach(kw => {
        if (tool.description.toLowerCase().includes(kw)) {
          score += 2;
        }
      });

      // Match against use cases
      tool.use_cases.forEach(useCase => {
        keywords.forEach(kw => {
          if (useCase.toLowerCase().includes(kw)) {
            score += 5; // Use cases are highest signal
          }
        });
      });

      return { tool, score };
    });

    // Return top 10 tools
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(s => s.tool);
  }

  // Strategy 3: Always-available core tools (for caching)
  getCoreTools(): Tool[] {
    return [
      // Most commonly used tools - these get cached in system prompt
      ...this.registry.getByCategory('crm').slice(0, 3),
      ...this.registry.getByCategory('meetings').slice(0, 2),
      ...this.registry.getByCategory('docs').slice(0, 3),
      // Memory and workspace tools should ALWAYS be available since system prompt references them
      ...this.registry.getByCategory('storage').filter(t =>
        t.name === 'read_agent_memory' ||
        t.name === 'append_agent_memory' ||
        t.name === 'list_workspace' ||
        t.name === 'read_workspace_file'
      ),
    ];
  }
}

// Prompt builder with caching strategy
export class CachedPromptBuilder {
  private coreToolsCache: string | null = null;

  constructor(
    private selector: SmartToolSelector,
    private registry: ToolRegistry
  ) {}

  // Build system prompt with cacheable tool definitions
  buildSystemPrompt(): { cacheable: string; dynamic: string } {
    // Cacheable part: Core tools (rarely changes)
    if (!this.coreToolsCache) {
      const coreTools = this.selector.getCoreTools();
      this.coreToolsCache = this.formatToolDefinitions(coreTools);
    }

    // Dynamic part: Tool categories available
    const categories = ['crm', 'calendar', 'docs', 'meetings', 'code', 'sales', 'storage', 'filesystem', 'web', 'compute', 'research', 'communication', 'analytics'];
    const categorySummary = categories.map(cat => {
      const tools = this.registry.getByCategory(cat);
      return `- ${cat}: ${tools.length} tools (${tools.map(t => t.name).join(', ')})`;
    }).join('\n');

    return {
      cacheable: `You are an AI assistant with access to these tools:\n\n${this.coreToolsCache}`,
      dynamic: `\nAdditional tool categories available:\n${categorySummary}\n\nWhen you need a tool from a category, it will be loaded on-demand.`
    };
  }

  // Format tools for LLM consumption
  private formatToolDefinitions(tools: Tool[]): string {
    return tools.map(tool => {
      const params = JSON.stringify(tool.parameters, null, 2);
      return `### ${tool.name}\n${tool.description}\n\nParameters:\n${params}\n\nUse cases: ${tool.use_cases.join(', ')}`;
    }).join('\n\n');
  }

  // Build task-specific tool list
  buildTaskTools(taskDescription: string): Tool[] {
    // Get core tools (always available)
    const coreTools = this.selector.getCoreTools();

    // Get task-specific tools
    const taskTools = this.selector.selectByTask(taskDescription);

    // Combine and deduplicate
    const allTools = [...coreTools];
    const coreNames = new Set(coreTools.map(t => t.name));

    taskTools.forEach(tool => {
      if (!coreNames.has(tool.name)) {
        allTools.push(tool);
      }
    });

    return allTools;
  }
}

// Usage example for agents
export async function executeToolCall(
  toolName: string,
  input: any,
  context: ToolContext,
  taskPayload?: any // Optional: admin/room info from chat platforms
): Promise<any> {
  const tool = registry.getTool(toolName);

  if (!tool) {
    return {
      success: false,
      error: `Tool '${toolName}' not found. Available tools: ${registry.getAllNames().join(', ')}`
    };
  }

  // Check permissions if tool requires them and we have user context
  if (tool.permissions && taskPayload) {
    const targetRoom = extractTargetRoom(input);
    let targetRoomIsPublic: boolean | undefined = undefined;

    // Fetch channel type from database if we have a target room
    if (targetRoom) {
      try {
        const { Pool } = await import('pg');
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
        });

        const result = await pool.query(
          'SELECT channel_type FROM conversations WHERE room_id = $1 LIMIT 1',
          [targetRoom]
        );

        if (result.rows.length > 0) {
          const channelType = result.rows[0].channel_type;
          // 'O' = Open/Public, 'P' = Private, 'D' = DM, 'G' = Group
          targetRoomIsPublic = channelType === 'O';
        }

        await pool.end();
      } catch (error) {
        console.warn('⚠️  Could not fetch channel type for permission check:', error);
      }
    }

    const permissionContext: ToolPermissionContext = {
      userId: taskPayload.matrix_user || taskPayload.mattermost_user || context.user_id,
      isAdmin: taskPayload.is_admin || false,
      contextRoom: taskPayload.context_room || taskPayload.matrix_room || taskPayload.mattermost_channel,
      targetRoom,
      isContextRoomDM: taskPayload.is_dm || false,
      targetRoomIsPublic,
    };

    const permissionCheck = checkToolPermission(tool, permissionContext);

    if (!permissionCheck.allowed) {
      return {
        success: false,
        error: permissionCheck.reason
      };
    }
  }

  try {
    const result = await tool.handler(input, context);
    return result;
  } catch (error: any) {
    return {
      success: false,
      error: `Tool execution failed: ${error.message}`
    };
  }
}

// Export everything
export * from './base';
export * from './permissions';
export * from './access-tiers';
export * from './crm/attio';
export * from './meetings/jitsi';
export * from './docs/notion';
export * from './calendar/ics';
export * from './storage/files';
export * from './storage/workspace';
export * from './code/github';
// Export filesystem tools with explicit names to avoid conflicts
export { filesystemTools } from './filesystem/tools';
export * from './filesystem/sandbox';
export * from './web/fetch';
export * from './compute/javascript';
export * from './research/openmeasures';
export * from './analytics/database';
export * from './analytics/invocations';
export * from './analytics/message-bus';
export * from './memory/agent-memory';
export * from './mattermost/tools';
export * from './messaging/inter-agent';

// Convenience exports
export const toolSelector = new SmartToolSelector(registry);
export const promptBuilder = new CachedPromptBuilder(toolSelector, registry);

// Get tools for a specific task (main API)
export function getToolsForTask(taskDescription: string): Tool[] {
  return promptBuilder.buildTaskTools(taskDescription);
}

/**
 * Get tools for a task, filtered by user access tier
 * Non-admin users won't see admin-only tools
 */
export function getToolsForTaskWithAccessTier(
  taskDescription: string,
  isAdmin: boolean
): Tool[] {
  const allTools = promptBuilder.buildTaskTools(taskDescription);
  return filterToolsByAccessTier(allTools, isAdmin);
}

/**
 * Get the appropriate LLM model for a user
 * Admins may get a more powerful model (e.g., Opus vs Sonnet)
 */
export function getModelForUser(isAdmin: boolean, requestedModel?: string): string | null {
  return getLlmModelForUser(isAdmin, requestedModel);
}

/**
 * Check if a user can use a specific LLM provider
 */
export function canUseProvider(provider: string, isAdmin: boolean): boolean {
  return isProviderAllowed(provider, isAdmin);
}

// Get system prompt (for agent initialization)
export function getSystemPrompt(): { cacheable: string; dynamic: string } {
  return promptBuilder.buildSystemPrompt();
}
