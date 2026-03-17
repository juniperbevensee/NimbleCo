# Integration & Tool Architecture

## Philosophy

**Agents should be platform-agnostic.** The same agent should work with:
- Any chat platform (Signal, Mattermost, Discord, Slack)
- Any CRM (Attio, HubSpot, Salesforce)
- Any meeting tool (Jitsi, Zoom, Google Meet)
- Any documentation system (Notion, Confluence, Google Docs)

## Architecture Pattern: MCP (Model Context Protocol)

We adopt Anthropic's MCP standard for tool definitions. This makes our tools compatible with Claude Code, Claude Desktop, and the broader MCP ecosystem.

### Tool Definition Standard

```typescript
// shared/tools/src/base.ts

export interface MCPTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (input: any, context: ToolContext) => Promise<any>;
}

export interface ToolContext {
  user_id: string;
  platform: 'signal' | 'mattermost' | 'discord';
  credentials: Record<string, string>;
}
```

### Example: CRM Tool (Works with Attio, HubSpot, Salesforce)

```typescript
// shared/tools/src/crm/update-contact.ts

import { MCPTool } from '../base';

export const updateContactTool: MCPTool = {
  name: 'update_contact',
  description: 'Update a contact in the CRM (supports Attio, HubSpot, Salesforce)',
  input_schema: {
    type: 'object',
    properties: {
      contact_id: {
        type: 'string',
        description: 'Contact ID or email address'
      },
      fields: {
        type: 'object',
        description: 'Fields to update (name, email, company, notes, etc)',
        additionalProperties: true
      },
      provider: {
        type: 'string',
        enum: ['attio', 'hubspot', 'salesforce'],
        description: 'CRM provider (defaults to configured provider)'
      }
    },
    required: ['contact_id', 'fields']
  },

  async handler(input, context) {
    const provider = input.provider || process.env.CRM_PROVIDER || 'attio';

    // Route to appropriate adapter
    switch (provider) {
      case 'attio':
        return await updateAttioContact(input, context);
      case 'hubspot':
        return await updateHubSpotContact(input, context);
      case 'salesforce':
        return await updateSalesforceContact(input, context);
      default:
        throw new Error(`Unsupported CRM provider: ${provider}`);
    }
  }
};

// Adapter implementations
async function updateAttioContact(input: any, ctx: ToolContext) {
  const attio = new AttioClient(ctx.credentials.ATTIO_API_KEY);

  const contact = await attio.contacts.update({
    id: input.contact_id,
    data: input.fields
  });

  return {
    success: true,
    contact_id: contact.id,
    updated_fields: Object.keys(input.fields)
  };
}

async function updateHubSpotContact(input: any, ctx: ToolContext) {
  const hubspot = new HubSpotClient(ctx.credentials.HUBSPOT_API_KEY);

  const contact = await hubspot.crm.contacts.basicApi.update(
    input.contact_id,
    { properties: input.fields }
  );

  return {
    success: true,
    contact_id: contact.id,
    updated_fields: Object.keys(input.fields)
  };
}
```

### Example: Meeting Scheduler Tool

```typescript
// shared/tools/src/meetings/schedule-meeting.ts

export const scheduleMeetingTool: MCPTool = {
  name: 'schedule_meeting',
  description: 'Schedule a meeting (supports Jitsi, Zoom, Google Meet)',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      start_time: { type: 'string', format: 'date-time' },
      duration_minutes: { type: 'number', default: 30 },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Email addresses of attendees'
      },
      provider: {
        type: 'string',
        enum: ['jitsi', 'zoom', 'google-meet'],
        description: 'Meeting provider (defaults to Jitsi for open-source)'
      }
    },
    required: ['title', 'start_time', 'attendees']
  },

  async handler(input, context) {
    const provider = input.provider || 'jitsi'; // Default to open source

    switch (provider) {
      case 'jitsi':
        return await scheduleJitsi(input, context);
      case 'zoom':
        return await scheduleZoom(input, context);
      case 'google-meet':
        return await scheduleGoogleMeet(input, context);
    }
  }
};

async function scheduleJitsi(input: any, ctx: ToolContext) {
  // Jitsi is instant - just create a room URL
  const roomName = `meeting-${Date.now()}-${randomId()}`;
  const meetingUrl = `https://meet.jit.si/${roomName}`;

  // Create calendar event with Jitsi link
  await createCalendarEvent({
    title: input.title,
    start: input.start_time,
    duration: input.duration_minutes,
    attendees: input.attendees,
    location: meetingUrl,
    description: `Join via Jitsi: ${meetingUrl}`
  });

  return {
    success: true,
    meeting_url: meetingUrl,
    provider: 'jitsi',
    calendar_event_created: true
  };
}

async function scheduleZoom(input: any, ctx: ToolContext) {
  const zoom = new ZoomClient(ctx.credentials.ZOOM_API_KEY);

  const meeting = await zoom.meetings.create({
    topic: input.title,
    start_time: input.start_time,
    duration: input.duration_minutes,
    settings: {
      join_before_host: true,
      waiting_room: false
    }
  });

  // Also add to calendar
  await createCalendarEvent({
    title: input.title,
    start: input.start_time,
    duration: input.duration_minutes,
    attendees: input.attendees,
    location: meeting.join_url,
    description: `Join Zoom: ${meeting.join_url}\nMeeting ID: ${meeting.id}`
  });

  return {
    success: true,
    meeting_url: meeting.join_url,
    meeting_id: meeting.id,
    provider: 'zoom',
    calendar_event_created: true
  };
}
```

## Cross-Platform Message Routing

**Use Case:** User sends message in Signal → Agent responds in Mattermost

```typescript
// coordinator/src/platform-router.ts

export class PlatformRouter {
  private platforms = new Map<string, PlatformAdapter>();

  constructor() {
    // Register all platform adapters
    this.platforms.set('signal', new SignalAdapter());
    this.platforms.set('mattermost', new MattermostAdapter());
    this.platforms.set('discord', new DiscordAdapter());
  }

  async routeMessage(message: UniversalMessage) {
    // Normalize incoming message
    const normalized = {
      id: message.id,
      user_id: message.user_id,
      content: message.content,
      platform: message.platform,
      timestamp: message.timestamp,
      context: {
        channel_id: message.channel_id,
        thread_id: message.thread_id,
        reply_to: message.reply_to
      }
    };

    // Send to coordinator for agent processing
    const result = await this.processWithAgent(normalized);

    // Route response back
    const targetPlatform = result.respond_to || normalized.platform;
    const adapter = this.platforms.get(targetPlatform);

    await adapter.send({
      channel_id: result.channel_id || normalized.context.channel_id,
      content: result.content,
      reply_to: normalized.id
    });
  }
}
```

### Platform Adapters

```typescript
// shared/platforms/src/base.ts

export interface PlatformAdapter {
  name: string;

  // Listen for incoming messages
  listen(handler: (message: UniversalMessage) => Promise<void>): void;

  // Send outgoing messages
  send(message: OutgoingMessage): Promise<void>;

  // Platform-specific features
  getCapabilities(): PlatformCapabilities;
}

export interface PlatformCapabilities {
  supports_threads: boolean;
  supports_reactions: boolean;
  supports_buttons: boolean;
  supports_file_upload: boolean;
  supports_voice: boolean;
  supports_video: boolean;
}
```

**Signal Adapter (use your cantrip-integrations code):**

```typescript
// shared/platforms/src/signal.ts

import { SignalContext } from '@cantrip-integrations/signal';

export class SignalAdapter implements PlatformAdapter {
  name = 'signal';
  private ctx: SignalContext;

  constructor() {
    // Use signal-cli-rest-api (from your cantrip setup)
    this.ctx = new SignalContext({
      apiUrl: process.env.SIGNAL_API_URL,
      number: process.env.SIGNAL_BOT_NUMBER
    });
  }

  listen(handler: (msg: UniversalMessage) => Promise<void>) {
    // Poll signal-cli-rest-api every 5 seconds
    setInterval(async () => {
      const messages = await this.ctx.receive();

      for (const msg of messages) {
        await handler({
          id: msg.timestamp.toString(),
          user_id: msg.source,
          content: msg.message,
          platform: 'signal',
          timestamp: msg.timestamp,
          context: {
            channel_id: msg.groupId || msg.source,
            is_group: !!msg.groupId
          }
        });
      }
    }, 5000);
  }

  async send(message: OutgoingMessage) {
    if (message.context?.is_group) {
      await this.ctx.sendGroupMessage(
        message.channel_id,
        message.content
      );
    } else {
      await this.ctx.sendMessage(
        message.channel_id,
        message.content
      );
    }
  }

  getCapabilities() {
    return {
      supports_threads: false,
      supports_reactions: true,
      supports_buttons: false,
      supports_file_upload: true,
      supports_voice: true,
      supports_video: true
    };
  }
}
```

**Mattermost Adapter:**

```typescript
// shared/platforms/src/mattermost.ts

import { Client4 } from '@mattermost/client';

export class MattermostAdapter implements PlatformAdapter {
  name = 'mattermost';
  private client: Client4;

  constructor() {
    this.client = new Client4();
    this.client.setUrl(process.env.MATTERMOST_URL);
    this.client.setToken(process.env.MATTERMOST_BOT_TOKEN);
  }

  listen(handler: (msg: UniversalMessage) => Promise<void>) {
    // WebSocket for real-time
    const ws = this.client.createWebSocketClient();

    ws.addMessageListener((msg) => {
      if (msg.event === 'posted') {
        const post = JSON.parse(msg.data.post);

        handler({
          id: post.id,
          user_id: post.user_id,
          content: post.message,
          platform: 'mattermost',
          timestamp: post.create_at,
          context: {
            channel_id: post.channel_id,
            thread_id: post.root_id,
            reply_to: post.root_id
          }
        });
      }
    });
  }

  async send(message: OutgoingMessage) {
    await this.client.createPost({
      channel_id: message.channel_id,
      message: message.content,
      root_id: message.context?.thread_id,
      props: message.props || {}
    });
  }

  getCapabilities() {
    return {
      supports_threads: true,
      supports_reactions: true,
      supports_buttons: true,
      supports_file_upload: true,
      supports_voice: false,
      supports_video: false
    };
  }
}
```

## Adding New Integrations: Cookbook

### 1. Add a CRM (Attio Example)

**Step 1: Install SDK**
```bash
npm install attio --save
```

**Step 2: Create adapter**
```typescript
// shared/tools/src/crm/attio.ts

import Attio from 'attio';

export async function updateAttioContact(input: any, ctx: ToolContext) {
  const client = new Attio({
    apiKey: ctx.credentials.ATTIO_API_KEY
  });

  const contact = await client.contacts.update({
    id: input.contact_id,
    data: input.fields
  });

  return {
    success: true,
    contact_id: contact.id,
    updated_fields: Object.keys(input.fields)
  };
}

export async function createAttioNote(contactId: string, note: string, ctx: ToolContext) {
  const client = new Attio({ apiKey: ctx.credentials.ATTIO_API_KEY });

  await client.notes.create({
    parent: { contact_id: contactId },
    content: note
  });

  return { success: true };
}
```

**Step 3: Register tool**
```typescript
// shared/tools/src/index.ts

export const tools = [
  updateContactTool,  // Already supports Attio via adapter
  createNoteTool,
  // ... more tools
];
```

**Step 4: Configure credentials**
```bash
# .env
ATTIO_API_KEY=your-api-key
CRM_PROVIDER=attio  # Default CRM
```

**Done!** Agent can now use `update_contact` tool with Attio.

### 2. Add Notion Integration

```typescript
// shared/tools/src/docs/notion.ts

import { Client } from '@notionhq/client';

export const createNotionPageTool: MCPTool = {
  name: 'create_notion_page',
  description: 'Create a new page in Notion',
  input_schema: {
    type: 'object',
    properties: {
      parent_page_id: { type: 'string', description: 'Parent page or database ID' },
      title: { type: 'string' },
      content: { type: 'string', description: 'Markdown content' }
    },
    required: ['parent_page_id', 'title', 'content']
  },

  async handler(input, ctx) {
    const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

    // Convert markdown to Notion blocks (simplified)
    const blocks = markdownToNotionBlocks(input.content);

    const page = await notion.pages.create({
      parent: { page_id: input.parent_page_id },
      properties: {
        title: {
          title: [{ text: { content: input.title } }]
        }
      },
      children: blocks
    });

    return {
      success: true,
      page_id: page.id,
      url: page.url
    };
  }
};
```

### 3. Add Apollo (Sales Intelligence)

```typescript
// shared/tools/src/sales/apollo.ts

export const searchApolloTool: MCPTool = {
  name: 'search_apollo_contacts',
  description: 'Search for contacts in Apollo.io',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (name, company, title)' },
      limit: { type: 'number', default: 10 }
    },
    required: ['query']
  },

  async handler(input, ctx) {
    const response = await fetch('https://api.apollo.io/v1/people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': ctx.credentials.APOLLO_API_KEY
      },
      body: JSON.stringify({
        q_keywords: input.query,
        per_page: input.limit
      })
    });

    const data = await response.json();

    return {
      contacts: data.people.map(p => ({
        name: p.name,
        title: p.title,
        company: p.organization?.name,
        email: p.email,
        linkedin: p.linkedin_url
      }))
    };
  }
};
```

## Tool Discovery

Agents can discover available tools at runtime:

```typescript
// Agent queries available tools
const tools = await toolRegistry.getTools({
  category: 'crm',  // Filter by category
  capabilities: ['update_contact']  // Filter by capability
});

// Returns:
[
  {
    name: 'update_contact',
    providers: ['attio', 'hubspot', 'salesforce'],
    configured: ['attio']  // Only Attio has API key configured
  }
]
```

## Cross-Platform Workflow Example

**Scenario:** User sends message in Signal → Agent updates Attio → Responds in Mattermost

```yaml
# workflows/signal-to-crm.yml

name: Signal Message to CRM
on:
  message:
    platform: signal
    contains: "add to CRM"

jobs:
  extract-info:
    agent: nlp-extractor
    tools: [extract_entities]

  update-crm:
    needs: [extract-info]
    agent: crm-updater
    tools: [update_contact, create_note]
    provider: attio

  notify-team:
    needs: [update-crm]
    platform: mattermost
    channel: "#sales"
    message: |
      📝 New contact added from Signal:
      Name: {{ extract-info.name }}
      Company: {{ extract-info.company }}
      CRM Link: {{ update-crm.contact_url }}
```

## Tool Registry Structure

```
shared/tools/
├── src/
│   ├── base.ts                  # MCPTool interface
│   ├── registry.ts              # Tool registration
│   ├── crm/
│   │   ├── update-contact.ts    # Universal CRM tool
│   │   ├── attio.ts            # Attio adapter
│   │   ├── hubspot.ts          # HubSpot adapter
│   │   └── salesforce.ts       # Salesforce adapter
│   ├── docs/
│   │   ├── notion.ts           # Notion tools
│   │   ├── confluence.ts       # Confluence tools
│   │   └── google-docs.ts      # Google Docs tools
│   ├── meetings/
│   │   ├── schedule.ts         # Universal meeting scheduler
│   │   ├── jitsi.ts            # Jitsi adapter
│   │   ├── zoom.ts             # Zoom adapter
│   │   └── google-meet.ts      # Google Meet adapter
│   ├── sales/
│   │   ├── apollo.ts           # Apollo.io tools
│   │   └── clearbit.ts         # Clearbit tools
│   └── calendar/
│       ├── google-calendar.ts  # Reuse from cantrip-integrations
│       └── caldav.ts           # CalDAV (Radicale, etc)
└── package.json
```

## Integration Marketplace (Future)

Users can install community integrations:

```bash
# Install community integration
agile integrations install @agile-community/salesforce-crm

# List installed integrations
agile integrations list

# Publish your own
agile integrations publish ./my-custom-integration
```

## Testing Integrations

```typescript
// shared/tools/test/crm.test.ts

describe('CRM Tools', () => {
  it('should update Attio contact', async () => {
    const result = await updateContactTool.handler(
      {
        contact_id: 'test@example.com',
        fields: { company: 'Acme Corp' },
        provider: 'attio'
      },
      {
        user_id: 'test-user',
        platform: 'mattermost',
        credentials: {
          ATTIO_API_KEY: process.env.ATTIO_API_KEY
        }
      }
    );

    expect(result.success).toBe(true);
    expect(result.updated_fields).toContain('company');
  });
});
```

## Next Steps

1. ✅ Implement MCPTool base interface
2. ✅ Create CRM tools (Attio, HubSpot)
3. ✅ Create meeting scheduler (Jitsi, Zoom, Google Meet)
4. ✅ Add Notion integration
5. ✅ Port Signal integration from cantrip-integrations
6. ✅ Create tool registry and discovery system
7. ⏭️ Build integration marketplace (Phase 3)
