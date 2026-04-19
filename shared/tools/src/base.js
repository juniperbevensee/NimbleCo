"use strict";
// Base interfaces for tools - simple, direct API access
// No MCP abstraction - just practical tool definitions
Object.defineProperty(exports, "__esModule", { value: true });
exports.TieredToolLoader = exports.ToolRegistry = void 0;
exports.isToolConfigured = isToolConfigured;
exports.filterConfiguredTools = filterConfiguredTools;
/**
 * Check if a tool has its required environment variables set
 */
function isToolConfigured(tool) {
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
function filterConfiguredTools(tools) {
    return tools.filter(isToolConfigured);
}
// Tool registry - simple discovery
class ToolRegistry {
    constructor() {
        this.tools = new Map();
    }
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    // Get tools by category (reduces prompt bloat)
    getByCategory(category) {
        return Array.from(this.tools.values())
            .filter(t => t.category === category);
    }
    // Search tools by use case
    findByUseCase(useCase) {
        return Array.from(this.tools.values())
            .filter(t => t.use_cases.some(uc => uc.toLowerCase().includes(useCase.toLowerCase())));
    }
    // Get all tool names (for lightweight agent awareness)
    getAllNames() {
        return Array.from(this.tools.keys());
    }
    getTool(name) {
        return this.tools.get(name);
    }
    // Get all registered tools (useful for export/introspection)
    getAllTools() {
        return Array.from(this.tools.values());
    }
}
exports.ToolRegistry = ToolRegistry;
// Tiered tool loading strategy
class TieredToolLoader {
    constructor(registry) {
        this.registry = registry;
    }
    // Tier 1: Always available (10-15 core tools)
    getCoreTools() {
        return [
            ...this.registry.getByCategory('crm'),
            ...this.registry.getByCategory('calendar'),
        ].slice(0, 15);
    }
    // Tier 2: Load on-demand by category
    getToolsForTask(task) {
        // Simple heuristics - can be made smarter
        const categories = [];
        if (task.match(/meeting|schedule|calendar/i))
            categories.push('calendar', 'meetings');
        if (task.match(/contact|crm|customer/i))
            categories.push('crm');
        if (task.match(/doc|notion|write/i))
            categories.push('docs');
        if (task.match(/code|pr|review/i))
            categories.push('code');
        return categories.flatMap(cat => this.registry.getByCategory(cat));
    }
    // Tier 3: Search-based loading
    searchTools(query) {
        return this.registry.findByUseCase(query);
    }
}
exports.TieredToolLoader = TieredToolLoader;
//# sourceMappingURL=base.js.map