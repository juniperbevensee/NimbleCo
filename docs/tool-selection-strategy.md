# Tool Selection & Prompt Caching Strategy

## The Real Problems

**Problem 1:** With 50+ tools, how does an agent know which to use?

**Problem 2:** How do we keep costs down with massive toolkits (prompt caching)?

## Our Solution: Tiered Loading + Smart Caching

### Tier 1: Core Tools (Always Available)

**10-15 most common tools** - these go in the system prompt and get cached:

```typescript
const coreTools = [
  'update_attio_person',      // CRM
  'add_attio_note',            // CRM
  'create_jitsi_meeting',      // Meetings
  'notion_create_page',        // Docs
  'notion_append_blocks',      // Docs
  'notion_search',             // Docs
  // ... 5-10 more
];
```

**Why:** These tools are used 80% of the time. By caching them in the system prompt, we:
- Pay once per conversation (not per message)
- Get instant tool availability
- ~90% cost reduction via prompt caching

### Tier 2: Category-Based Loading

When a task mentions specific categories, load those tools on-demand:

```typescript
const task = "Schedule a meeting and update the CRM";

// Auto-detect categories
const categories = detectCategories(task);
// → ['meetings', 'crm']

// Load category-specific tools
const tools = [
  ...getCoreTools(),           // Already cached
  ...getToolsForCategory('meetings'),  // 3-5 tools
  ...getToolsForCategory('crm'),       // 3-5 tools
];

// Total: ~20 tools instead of 50+
```

**Detection heuristics:**
- "meeting" / "schedule" / "call" → meetings
- "contact" / "crm" / "customer" → crm
- "doc" / "notion" / "write" → docs
- "code" / "pr" / "review" → code

### Tier 3: Semantic Search (Rare)

For unusual tasks, search tool use cases:

```typescript
const task = "Find all contacts at YC companies and send them calendar invites";

// Search use cases
const tools = searchToolsByUseCase([
  "searching contacts",
  "filtering by company",
  "sending calendar invites"
]);

// Results:
// - search_crm_contacts (from sales category)
// - filter_contacts (from crm category)
// - create_calendar_event (from calendar category)
```

## Prompt Caching Implementation

### System Prompt Structure

```
[CACHEABLE PART - 5000 tokens]
You are an AI assistant for NimbleCo.

Core Tools (always available):
1. update_attio_person - Update CRM contact...
2. add_attio_note - Add note to CRM...
3. create_jitsi_meeting - Create video meeting...
... (10-15 tools with full descriptions)

[END CACHEABLE]

[DYNAMIC PART - 500 tokens]
Additional categories available:
- crm: 5 tools (search_contacts, bulk_update, ...)
- meetings: 3 tools (schedule_zoom, schedule_gmeet, ...)
- docs: 8 tools (search_docs, update_doc, ...)
- sales: 4 tools (search_apollo, enrich_contact, ...)

Current task: "Schedule a code review meeting"
Loaded tools for this task: [meetings, code]

3 additional tools for this task:
4. schedule_zoom - Schedule Zoom meeting...
5. schedule_gmeet - Schedule Google Meet...
6. create_pr_review - Create PR review...
```

### Cost Comparison

**Without caching (naive approach):**
```
System prompt: 5000 tokens
User message: 200 tokens
Total input: 5200 tokens

Cost per message: 5200 tokens × $3/1M = $0.0156
Cost for 100 messages: $1.56
```

**With caching:**
```
Cached system prompt: 5000 tokens (cached)
Dynamic prompt: 500 tokens
User message: 200 tokens

First message: 5700 tokens × $3/1M = $0.0171 (cache write)
Subsequent: 700 tokens × $3/1M = $0.0021 (cache read is 90% cheaper)

Cost for 100 messages: $0.017 + (99 × $0.002) = $0.21
Savings: 87%
```

## Implementation

### Agent Setup

```typescript
import { getSystemPrompt, getToolsForTask, executeToolCall } from '@nimbleco/tools';

class Agent {
  private cachedSystemPrompt: string;

  async initialize() {
    // Build cacheable system prompt (once per agent instance)
    const { cacheable, dynamic } = getSystemPrompt();
    this.cachedSystemPrompt = cacheable;

    console.log('✅ System prompt cached');
  }

  async handleTask(task: string) {
    // Get task-specific tools (lightweight)
    const tools = getToolsForTask(task);

    // Build full prompt
    const { cacheable, dynamic } = getSystemPrompt();
    const systemPrompt = cacheable + dynamic;

    // Send to LLM with caching hints
    const response = await this.llm.chat([
      {
        role: 'system',
        content: systemPrompt,
        cache_control: { type: 'ephemeral' } // Cache hint for Claude
      },
      {
        role: 'user',
        content: task
      }
    ], {
      tools: tools.map(formatToolForLLM)
    });

    // Execute tool calls
    for (const toolCall of response.tool_calls) {
      const result = await executeToolCall(
        toolCall.name,
        toolCall.input,
        this.context
      );
    }
  }
}
```

### Tool Selection Algorithm

```typescript
export function getToolsForTask(taskDescription: string): Tool[] {
  const selector = new SmartToolSelector(registry);

  // Always include core tools (cached)
  const coreTools = selector.getCoreTools();

  // Detect categories from task description
  const categories = detectCategories(taskDescription);
  const categoryTools = selector.selectByCategory(categories);

  // If still under 20 tools, do semantic search
  const allTools = [...coreTools, ...categoryTools];
  if (allTools.length < 20) {
    const semanticTools = selector.selectByTask(taskDescription);
    allTools.push(...semanticTools.slice(0, 20 - allTools.length));
  }

  // Deduplicate and return
  return deduplicateTools(allTools);
}

function detectCategories(task: string): string[] {
  const lower = task.toLowerCase();
  const categories: string[] = [];

  if (lower.match(/meeting|schedule|calendar|call|zoom|jitsi/)) {
    categories.push('meetings', 'calendar');
  }
  if (lower.match(/contact|crm|customer|attio|hubspot/)) {
    categories.push('crm');
  }
  if (lower.match(/doc|notion|write|document|confluence/)) {
    categories.push('docs');
  }
  if (lower.match(/code|pr|review|github|test/)) {
    categories.push('code');
  }
  if (lower.match(/sales|lead|apollo|prospect/)) {
    categories.push('sales');
  }

  return categories;
}
```

## Why This Works

1. **Core tools are always available** (cached, zero marginal cost)
2. **Category detection is fast** (regex, no LLM call)
3. **Total tools stay under 20** (keeps latency low)
4. **90% cost reduction** via prompt caching
5. **No abstraction overhead** (direct API access)

## Comparison to Alternatives

### MCP Approach (What Claude Desktop Does)

```typescript
// MCP wraps everything in a protocol layer
const mcpServer = new MCPServer({
  tools: [attioTool, notionTool, jitsiTool, ...]
});

// Problem: All tools loaded upfront
// Problem: Abstraction layer adds latency
// Problem: MCP implementations often limited vs full API
```

**Our approach:** Direct API access, lazy loading, no protocol overhead

### LangChain Approach

```typescript
// LangChain uses an LLM to select tools
const agent = createToolCallingAgent({
  llm,
  tools: allTools,
  prompt: systemPrompt
});

// Problem: LLM call for every tool selection (~1-2s latency)
// Problem: All tools in prompt (expensive, slow)
// Problem: Unpredictable tool selection
```

**Our approach:** Deterministic category detection, no LLM needed

### AutoGPT / BabyAGI Approach

```typescript
// Give agent ALL tools, let it figure it out
const agent = new Agent({
  tools: loadAllTools(), // 100+ tools
  allowedIterations: 10
});

// Problem: Massive prompts (10k+ tokens)
// Problem: Tool confusion (agent picks wrong tool)
// Problem: Expensive ($0.05+ per task)
```

**Our approach:** Tiered loading keeps prompts small (<7k tokens)

## Cost Estimates

**Scenario:** 1000 agent tasks per day

| Approach | Tokens/Task | Cost/Task | Daily Cost |
|----------|-------------|-----------|------------|
| All tools, no cache | 12,000 | $0.036 | $36 |
| All tools, with cache | 12,000 | $0.010 | $10 |
| Tiered, no cache | 7,000 | $0.021 | $21 |
| **Tiered + cache (ours)** | **7,000** | **$0.003** | **$3** |

**12x cheaper than naive approach!**

## Adding New Tools

Adding a tool is simple:

```typescript
// 1. Define tool
export const myNewTool: Tool = {
  name: 'do_something',
  description: 'Does something useful',
  category: 'sales',
  use_cases: [
    'finding leads',
    'enriching contacts'
  ],
  parameters: { /* JSON schema */ },
  async handler(input, ctx) {
    // Direct API call, no abstraction
    const result = await myApi.doThing(input);
    return result;
  }
};

// 2. Register in index.ts
import { myNewTool } from './sales/my-tool';
registry.register(myNewTool);

// 3. Done! Automatically available to agents
```

**No MCP server setup. No protocol definitions. Just register and go.**

## Monitoring Tool Usage

Track which tools are actually used:

```typescript
export async function executeToolCall(
  toolName: string,
  input: any,
  context: ToolContext
): Promise<any> {
  const startTime = Date.now();

  // Execute tool
  const result = await tool.handler(input, context);

  // Log usage
  await db.tool_usage.create({
    tool_name: toolName,
    user_id: context.user_id,
    duration_ms: Date.now() - startTime,
    success: result.success,
    timestamp: new Date()
  });

  return result;
}

// Query most-used tools
SELECT tool_name, COUNT(*) as usage_count
FROM tool_usage
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY tool_name
ORDER BY usage_count DESC
LIMIT 15;

// These become your core tools!
```

## Next Steps

1. ✅ Implement tiered tool loading
2. ✅ Add prompt caching to LLM adapters
3. ⏭️ Add usage tracking
4. ⏭️ Auto-tune core tools based on usage
5. ⏭️ Build tool marketplace (community tools)
