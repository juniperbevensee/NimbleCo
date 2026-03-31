# Tool System Overview

## What We Built

A practical tool integration system that solves the REAL problems:
1. **Tool selection at scale** (how to choose from 50+ tools)
2. **Prompt caching** (keeping costs down with large toolkits)
3. **Direct API access** (no unnecessary abstraction layers)

## Architecture

```
shared/tools/
├── src/
│   ├── base.ts                 # Tool interface, registry, selection strategy
│   ├── index.ts                # Central export, smart selector, cached prompt builder
│   ├── crm/
│   │   └── attio.ts           # Direct Attio API integration (3 tools)
│   ├── meetings/
│   │   └── jitsi.ts           # Jitsi meeting tools (3 tools)
│   └── docs/
│       └── notion.ts          # Notion integration (5 tools)
├── package.json
└── tsconfig.json
```

## Key Design Decisions

### 1. No MCP Abstraction

**Why?** You said your direct Notion API integration is better than Claude's MCP version. We agree.

**Instead:** Direct API clients with simple Tool interface:

```typescript
export const updateAttioPerson: Tool = {
  name: 'update_attio_person',
  description: '...',
  category: 'crm',
  use_cases: ['recording contact info', 'updating details'],
  parameters: { /* JSON schema */ },
  async handler(input, ctx) {
    // Direct API call - no abstraction
    const client = new AttioClient({ apiKey: ctx.credentials.ATTIO_API_KEY });
    return await client.updatePerson(input);
  }
};
```

### 2. Tiered Tool Loading

**Problem:** 50+ tools in prompt = slow + expensive

**Solution:** Load tools in tiers

- **Tier 1:** Core tools (10-15) - always loaded, cached in system prompt
- **Tier 2:** Category-based (5-10) - loaded based on task keywords
- **Tier 3:** Semantic search - fallback for unusual tasks

**Result:** Typically 15-25 tools per task instead of 50+

### 3. Smart Caching Strategy

**System prompt structure:**

```
[CACHEABLE - 5000 tokens]
You are an AI assistant.

Core tools (always available):
1. update_attio_person - ...
2. create_jitsi_meeting - ...
... (10-15 tools)

[DYNAMIC - 500 tokens]
Additional categories: crm (5 tools), docs (8 tools), ...
Current task: "Schedule meeting and update CRM"
Loaded tools: [3 additional tools for this task]
```

**Savings:** 87% cost reduction vs naive approach (see tool-selection-strategy.md)

### 4. Category-Based Organization

Tools organized by what they DO:

- `crm/` - Customer relationship management (Attio, HubSpot, Salesforce)
- `meetings/` - Video calls (Jitsi, Zoom, Google Meet)
- `docs/` - Documentation (Notion, Confluence, Google Docs)
- `calendar/` - Scheduling (Google Calendar, CalDAV)
- `sales/` - Sales intelligence (Apollo, Clearbit)
- `code/` - Code operations (GitHub, GitLab, Radicale)

Each category = 3-8 tools max (keeps prompts manageable)

## Implemented Integrations

### CRM: Attio (3 tools)

```typescript
import { attioTools } from '@nimbleco/tools';

// 1. update_attio_person - Update contact info
// 2. add_attio_note - Add note to contact
// 3. link_attio_person_company - Link person to company
```

**Why Attio first?** You mentioned it explicitly: "say attio for starters"

### Meetings: Jitsi (3 tools)

```typescript
import { jitsiTools } from '@nimbleco/tools';

// 1. create_jitsi_meeting - Full meeting with calendar invite
// 2. generate_jitsi_link - Instant meeting link
// 3. create_secure_jitsi_meeting - Self-hosted with JWT
```

**Why Jitsi?** You wanted "open source hackable things like jitsi" as the default

**Note:** Zero API calls needed! Jitsi just generates URLs. We create ICS calendar files locally.

### Docs: Notion (14 tools)

```typescript
import { notionTools } from '@nimbleco/tools';

// Search & Discovery
// 1. notion_search - Search pages and databases
// Database Operations
// 2. notion_get_database - Get database schema
// 3. notion_query_database - Query with filters/sorts
// 4. notion_create_database - Create database/table
// Page Operations
// 5. notion_get_page - Get page properties
// 6. notion_get_blocks - Get page content blocks
// 7. notion_create_page - Create page with content
// 8. notion_update_page - Update page properties
// 9. notion_append_blocks - Append content to page
// 10. notion_delete_block - Delete/archive block or page
// User & Workspace
// 11. notion_get_me - Get bot user info
// 12. notion_list_users - List workspace users
// Comments
// 13. notion_list_comments - List page comments
// 14. notion_create_comment - Create comment/reply
```

**Direct API access** - uses full Notion SDK, converts markdown to blocks, handles all page types

## Usage Example: Cross-Platform Workflow

Your example: "Message in Signal → update Attio → report in Mattermost"

```typescript
// Signal message received
const signalMessage = {
  from: '+1234567890',
  message: 'Met with Jane Doe from Acme Corp. She loved the demo!'
};

// Agent extracts entities
const context: ToolContext = {
  user_id: signalMessage.from,
  platform: 'signal',
  credentials: process.env // All API keys
};

// Tool 1: Update CRM
await executeToolCall('update_attio_person', {
  email: 'jane@acme.com',
  attributes: {
    last_contact: new Date().toISOString(),
    status: 'hot_lead',
    notes: 'Loved the demo'
  }
}, context);

// Tool 2: Add note
await executeToolCall('add_attio_note', {
  email: 'jane@acme.com',
  note: 'Signal message from sales rep: Loved the demo, hot lead'
}, context);

// Post to Mattermost
await mattermostClient.postMessage({
  channel: '#sales',
  message: '🔥 Hot lead! Jane Doe (Acme Corp) loved the demo. Updated in Attio.'
});
```

**Platform-agnostic:** Same tools work from Signal, Mattermost, Discord, API, etc.

## Adding New Integrations

### Pattern 1: Add a CRM (e.g., HubSpot)

```typescript
// shared/tools/src/crm/hubspot.ts

import { Client } from '@hubspot/api-client';
import { Tool } from '../base';

export const updateHubSpotContact: Tool = {
  name: 'update_hubspot_contact',
  description: 'Update contact in HubSpot CRM',
  category: 'crm',
  use_cases: ['updating contact', 'logging interaction'],
  parameters: { /* schema */ },
  async handler(input, ctx) {
    const hubspot = new Client({ accessToken: ctx.credentials.HUBSPOT_API_KEY });
    return await hubspot.crm.contacts.basicApi.update(input.id, input.properties);
  }
};

// Register in index.ts
import { updateHubSpotContact } from './crm/hubspot';
registry.register(updateHubSpotContact);
```

**That's it.** No MCP server, no protocol definitions, just register the tool.

### Pattern 2: Add a Meeting Provider (e.g., Zoom)

```typescript
// shared/tools/src/meetings/zoom.ts

import { ZoomClient } from 'zoom-api';
import { Tool } from '../base';

export const scheduleZoomMeeting: Tool = {
  name: 'schedule_zoom_meeting',
  description: 'Schedule Zoom meeting',
  category: 'meetings',
  use_cases: ['scheduling video call', 'creating zoom link'],
  parameters: { /* schema */ },
  async handler(input, ctx) {
    const zoom = new ZoomClient({ apiKey: ctx.credentials.ZOOM_API_KEY });
    const meeting = await zoom.meetings.create({
      topic: input.title,
      start_time: input.start_time,
      duration: input.duration_minutes
    });
    return { meeting_url: meeting.join_url, meeting_id: meeting.id };
  }
};

registry.register(scheduleZoomMeeting);
```

## Tool Selection in Action

```typescript
import { getToolsForTask } from '@nimbleco/tools';

// Example 1: Meeting task
const tools1 = getToolsForTask("Schedule a code review with the team");
// Returns: [core tools] + [jitsi tools] + [calendar tools]

// Example 2: CRM task
const tools2 = getToolsForTask("Update John's contact info and add note about call");
// Returns: [core tools] + [attio tools] + [search tools]

// Example 3: Multi-category task
const tools3 = getToolsForTask("Create meeting, update CRM, and document in Notion");
// Returns: [core tools] + [meetings] + [crm] + [docs]
// Total: ~20 tools (manageable prompt size)
```

## Comparison to MCP

| Aspect | MCP Approach | Our Approach |
|--------|-------------|--------------|
| **Abstraction** | Protocol layer (JSON-RPC) | Direct API calls |
| **Tool Definition** | MCP schema format | Simple TypeScript interface |
| **API Coverage** | Limited to what MCP exposes | Full API access |
| **Setup Complexity** | MCP server + config | Import + register |
| **Performance** | Protocol overhead | Direct calls |
| **Caching** | MCP-level caching | LLM prompt caching |
| **Extensibility** | Implement MCP protocol | Write a function |

**When MCP wins:** Interop with Claude Desktop, VS Code extensions

**When we win:** Performance, flexibility, full API access, simplicity

**Our take:** Use direct APIs. If MCP interop needed later, add an MCP adapter layer on top.

## What's Next

### Immediate Additions (from your requirements)

1. **HubSpot CRM** (`shared/tools/src/crm/hubspot.ts`)
2. **Apollo Sales** (`shared/tools/src/sales/apollo.ts`)
3. **Zoom Meetings** (`shared/tools/src/meetings/zoom.ts`)
4. **Google Meet** (`shared/tools/src/meetings/gmeet.ts`)

### Platform Adapters (cross-platform routing)

Your Signal → Attio → Mattermost workflow requires:

```typescript
// shared/platforms/src/signal.ts - Port from cantrip-integrations
// shared/platforms/src/mattermost.ts - WebSocket client
// coordinator/src/platform-router.ts - Route messages between platforms
```

### Tool Usage Tracking

Track which tools are actually used to auto-optimize core tool list:

```sql
CREATE TABLE tool_usage (
  id SERIAL PRIMARY KEY,
  tool_name VARCHAR(255),
  user_id VARCHAR(255),
  success BOOLEAN,
  duration_ms INTEGER,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Query most-used tools
SELECT tool_name, COUNT(*) FROM tool_usage
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY tool_name ORDER BY COUNT DESC LIMIT 15;
```

Use this data to automatically tune which tools are in Tier 1 (core).

## Philosophy

**Direct API access > abstraction layers**

You were right to push back on MCP framing. The real problems are:
1. Tool selection (solved with tiered loading)
2. Prompt caching (solved with cacheable system prompts)
3. API coverage (solved by not using abstractions)

**Start simple, add complexity only when needed.**

MCP might make sense later for interop, but for now, direct API access gives us maximum power and minimum overhead.
