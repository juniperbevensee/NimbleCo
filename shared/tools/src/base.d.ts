export interface ToolContext {
    user_id: string;
    platform: 'signal' | 'mattermost' | 'discord' | 'matrix' | 'telegram';
    credentials: Record<string, string>;
    conversation_id?: string;
    room_id?: string;
    agent_id?: string;
    invocation_id?: string;
    is_admin?: boolean;
}
export interface Tool {
    name: string;
    description: string;
    use_cases: string[];
    category: 'crm' | 'calendar' | 'docs' | 'meetings' | 'code' | 'sales' | 'storage' | 'filesystem' | 'web' | 'compute' | 'research' | 'communication' | 'analytics';
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    handler: (input: any, context: ToolContext) => Promise<any>;
    requiredEnv?: string[];
    permissions?: {
        requiresAdmin?: boolean;
        requiresContextRoom?: boolean;
        sensitiveReason?: string;
    };
}
/**
 * Check if a tool has its required environment variables set
 */
export declare function isToolConfigured(tool: Tool): boolean;
/**
 * Filter tools to only include those with required env vars configured
 */
export declare function filterConfiguredTools<T extends Tool>(tools: T[]): T[];
export interface ToolSelector {
    selectTools(task: string, allTools: Tool[]): Tool[];
    groupByCategory(tools: Tool[]): Map<string, Tool[]>;
}
export interface PromptCache {
    cacheToolDefinitions(tools: Tool[]): string;
    buildPrompt(cachedId: string, task: string): string;
}
export declare class ToolRegistry {
    private tools;
    register(tool: Tool): void;
    getByCategory(category: string): Tool[];
    findByUseCase(useCase: string): Tool[];
    getAllNames(): string[];
    getTool(name: string): Tool | undefined;
    getAllTools(): Tool[];
}
export declare class TieredToolLoader {
    private registry;
    constructor(registry: ToolRegistry);
    getCoreTools(): Tool[];
    getToolsForTask(task: string): Tool[];
    searchTools(query: string): Tool[];
}
//# sourceMappingURL=base.d.ts.map