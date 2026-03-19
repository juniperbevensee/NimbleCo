# Additional Tools (Gitignored)

This directory is for **custom/private tools** that you don't want to commit to git.

Perfect for:
- 🔒 Private API integrations (internal company tools)
- 🕵️ OSINT tools with sensitive sources
- 🤖 Bot-specific capabilities
- 🧪 Experimental tools

## Quick Start

### 1. Create a category folder

```bash
mkdir -p additional-tools/osint
mkdir -p additional-tools/cryptids
mkdir -p additional-tools/personal
```

### 2. Write your tools in TypeScript

Create `additional-tools/osint/index.ts`:

```typescript
import { Tool } from '../../shared/tools/src/base';

export const osintTools: Tool[] = [
  {
    name: 'search_telegram_channels',
    description: 'Search Telegram channels for specific keywords',
    category: 'osint',
    use_cases: [
      'Monitor Telegram for mentions',
      'Track hashtags across channels',
      'Find discussions about topics',
    ],
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        channels: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of channel IDs to search',
        },
      },
      required: ['query'],
    },
    handler: async (input, context) => {
      // Your implementation here
      const { query, channels } = input;

      // Example: Call your private Telegram API
      const results = await searchTelegram(query, channels);

      return {
        success: true,
        results,
      };
    },
  },
];
```

### 3. Build the TypeScript

```bash
# From the additional-tools directory
cd additional-tools
npx tsc

# Or from repo root
npx tsc -p additional-tools/tsconfig.json
```

This compiles `additional-tools/osint/index.ts` → `additional-tools/osint/index.js`

**Tip:** The main `npm run build` command compiles core tools but not additional-tools (since it's gitignored). You need to manually compile after making changes.

### 4. Enable in bot config

Add to your `.env.osint`:

```bash
ADDITIONAL_TOOLS=osint
```

Or for multiple categories:

```bash
ADDITIONAL_TOOLS=osint,cryptids,shared-utils
```

### 5. Restart your bot

```bash
npm restart
```

You'll see in the logs:

```
📦 Loading additional tools: osint
   ✅ Loaded 3 tool(s) from osint
```

## Folder Structure

```
additional-tools/
├── README.md           # This file
├── osint/
│   ├── index.ts        # Your OSINT tools
│   ├── telegram.ts     # Helper functions
│   └── package.json    # Optional: dependencies
├── cryptids/
│   └── index.ts        # Cryptid-hunting tools
├── personal/
│   └── index.ts        # Personal automation tools
└── shared-utils/
    └── index.ts        # Shared helpers across bots
```

## Export Patterns

The loader looks for these export patterns (in order):

### Pattern 1: Named export with category suffix (recommended)

```typescript
export const osintTools: Tool[] = [...];
```

### Pattern 2: Named export as "tools"

```typescript
export const tools: Tool[] = [...];
```

### Pattern 3: Default export

```typescript
export default [
  { name: 'my_tool', ... },
];
```

## Per-Bot Tool Loading

Each bot loads ONLY the tools specified in its `.env` file:

```bash
# .env.osint
ADDITIONAL_TOOLS=osint,shared-utils

# .env.cryptids
ADDITIONAL_TOOLS=cryptids,shared-utils

# .env.personal
ADDITIONAL_TOOLS=personal

# .env.cyborg
# (no ADDITIONAL_TOOLS = only core tools)
```

This lets you:
- Give each bot different capabilities
- Share some tools across bots (e.g., `shared-utils`)
- Keep sensitive tools restricted to specific bots

## Adding Dependencies

If your custom tools need npm packages:

1. Install in the **root** `package.json`:

```bash
npm install --save some-telegram-api
```

2. Import in your tool:

```typescript
import TelegramClient from 'some-telegram-api';

export const osintTools: Tool[] = [
  {
    name: 'telegram_search',
    handler: async (input) => {
      const client = new TelegramClient(process.env.TELEGRAM_API_KEY);
      // ...
    },
  },
];
```

## Environment Variables

Add bot-specific env vars to each bot's `.env` file:

```bash
# .env.osint
ADDITIONAL_TOOLS=osint
TELEGRAM_API_KEY=your_key_here
TELEGRAM_API_HASH=your_hash_here
```

Your tools can read these via `process.env.TELEGRAM_API_KEY`.

## TypeScript Support

The additional-tools directory is included in the root `tsconfig.json`, so you get full type checking and IntelliSense.

To import types:

```typescript
import { Tool, ToolContext } from '../../shared/tools/src/base';
```

## Troubleshooting

### "No tool arrays found in X/index.js"

Make sure you're exporting an array:

```typescript
export const osintTools: Tool[] = [
  // ...
];
```

Not an object:

```typescript
// ❌ Wrong
export const osintTools = {
  myTool: { ... }
};

// ✅ Right
export const osintTools: Tool[] = [
  { name: 'my_tool', ... }
];
```

### "Additional tools not found: X"

1. Check the path: `additional-tools/X/index.js` must exist
2. Make sure you ran `npm run build` to compile TypeScript
3. Check for typos in `ADDITIONAL_TOOLS=osint,cryptids`

### "Module not found: some-package"

Install the package in the **root** directory:

```bash
npm install some-package
```

Not in `additional-tools/osint/`.

## Security Notes

- ✅ This directory is **gitignored** - safe for sensitive code
- ✅ Each bot has isolated storage via `BOT_ID`
- ✅ Environment variables are per-bot (`.env.osint`, `.env.cryptids`)
- ⚠️ Tools still run with full coordinator permissions (database, file access)
- ⚠️ Use tool permissions (`requiresAdmin`, etc.) to restrict access

## Example: Real-World OSINT Tool

```typescript
import { Tool } from '../../shared/tools/src/base';
import { WebClient } from '@slack/web-api';

export const osintTools: Tool[] = [
  {
    name: 'monitor_slack_workspace',
    description: 'Monitor a Slack workspace for specific keywords',
    category: 'osint',
    use_cases: [
      'Track mentions in external Slack workspaces',
      'Monitor competitor discussions',
      'Gather intelligence from public Slack channels',
    ],
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search for',
        },
        workspace_token: {
          type: 'string',
          description: 'Slack workspace token (or use SLACK_OSINT_TOKEN env var)',
        },
      },
      required: ['query'],
    },
    handler: async (input, context) => {
      const token = input.workspace_token || process.env.SLACK_OSINT_TOKEN;

      if (!token) {
        return {
          success: false,
          error: 'Slack token required (SLACK_OSINT_TOKEN or workspace_token)',
        };
      }

      const client = new WebClient(token);

      try {
        const result = await client.search.messages({
          query: input.query,
          count: 50,
        });

        return {
          success: true,
          matches: result.messages?.matches || [],
          total: result.messages?.total || 0,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  },
];
```

## Tips

1. **Start simple**: Create one tool, test it, then add more
2. **Use TypeScript**: You get IntelliSense and type safety
3. **Share utilities**: Create `shared-utils/` for helpers used across categories
4. **Test individually**: Use one bot to test new tools before deploying to all bots
5. **Document well**: Add clear descriptions and use_cases so the LLM knows when to use your tools
