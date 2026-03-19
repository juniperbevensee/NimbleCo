# Multi-Bot Deployment Guide

NimbleCo supports running multiple bot instances with different personas, tool configurations, and team memberships from a single deployment.

## Overview

Each bot is configured via a separate `.env.<bot-name>` file and can have:
- **Unique identity/persona** (stored in `storage/identity-<bot-name>.md`)
- **Different tool access** (enable/disable tool categories per bot)
- **Separate Mattermost teams** (each bot joins specific teams)
- **Isolated workspaces** (files stored in separate directories)
- **Unified dashboard** (all bots visible in one dashboard with filtering)

## Quick Start

### 1. Create Your First Bot

```bash
npm run setup:bot
```

Follow the interactive prompts to configure:
- Bot ID (e.g., `personal`, `osint`, `cryptid`)
- Mattermost credentials and team
- Tool categories to enable
- Identity persona file

### 2. Start All Bots

```bash
npm start
```

This uses PM2 to automatically discover all `.env.*` files and start a coordinator process for each bot.

### 3. Monitor Bots

```bash
# List all running bots
npm run status

# View logs from all bots
npm logs

# View logs from specific bot
pm2 logs nimble-personal

# Restart all bots
npm restart

# Stop all bots
npm stop
```

## File Structure

```
/
├── .env.personal          # Bot config for "personal" bot
├── .env.osint            # Bot config for "osint" bot
├── .env.cryptid          # Bot config for "cryptid" bot
├── storage/
│   ├── identity-personal.md    # Persona for personal bot
│   ├── identity-osint.md       # Persona for OSINT bot
│   ├── identity-cryptid.md     # Persona for cryptid bot
│   ├── workspace-personal/     # File storage for personal bot
│   ├── workspace-osint/        # File storage for OSINT bot
│   └── workspace-cryptid/      # File storage for cryptid bot
└── pm2.config.js         # Auto-discovers .env.* files
```

## Bot Configuration (.env.* files)

Each bot needs these core variables:

### Required
```bash
# Bot Identity
BOT_ID=personal  # Must match the .env.* suffix

# Mattermost Connection
MATTERMOST_URL=https://chat.company.com
MATTERMOST_BOT_TOKEN=xyz123abc456  # Unique token per bot

# Database & Infrastructure (shared across all bots)
DATABASE_URL=postgresql://agent:password@localhost:5432/nimbleco
NATS_URL=nats://localhost:4222
```

### Optional
```bash
# Mattermost Team (if not set, bot joins all teams it has access to)
MATTERMOST_TEAM_NAME=engineering

# Identity & Storage
IDENTITY_FILE=./storage/identity-personal.md
WORKSPACE_ROOT=./storage/workspace-personal

# LLM Configuration (shared or per-bot)
ANTHROPIC_API_KEY=sk-ant-...
OLLAMA_URL=http://localhost:11434

# Tool Categories
ENABLE_OSINT_TOOLS=false       # Enable OSINT tools
ENABLE_CRYPTO_TOOLS=false      # Enable crypto/blockchain tools

# Admin Settings
MATTERMOST_ADMIN_USERS=user1,user2  # Users who can use admin commands
LLM_DAILY_COST_LIMIT=10.00          # Per-bot daily cost limit
```

## Tool Categories

Tools are organized into categories that can be enabled/disabled per bot:

### Core Tools (Always Enabled)
- File operations (read, write, search)
- JavaScript execution
- Web fetching
- GitHub operations

### OSINT Tools (Optional)
```bash
ENABLE_OSINT_TOOLS=true
OSINT_API_KEY=...  # If required by specific tools
```

Tools in this category:
- Social media scraping
- Public records search
- Domain/IP lookup
- (Add your custom OSINT tools here)

### Crypto/Blockchain Tools (Optional)
```bash
ENABLE_CRYPTO_TOOLS=true
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Tools in this category:
- Wallet operations
- Token transfers
- Smart contract interactions
- (Add your custom crypto tools here)

## Adding Custom Tool Categories

1. **Create tool directory**: `shared/tools/src/your-category/`

2. **Implement tools**:
```typescript
// shared/tools/src/your-category/index.ts
import { Tool, ToolRegistry } from '../base';

export function registerYourCategoryTools(registry: ToolRegistry) {
  // Only register if enabled via env
  if (process.env.ENABLE_YOUR_CATEGORY_TOOLS !== 'true') {
    console.log('🔒 Your category tools disabled');
    return;
  }

  registry.register({
    name: 'your_tool',
    description: 'What your tool does',
    // ... tool implementation
  });
}
```

3. **Update setup wizard** in `bin/setup-bot.js` to ask about the new category

4. **Load conditionally** in coordinator (already auto-loads from `shared/tools`)

## Identity/Persona Files

Each bot can have a unique personality defined in `storage/identity-<bot-name>.md`:

```markdown
# Personal Assistant Bot

## Who am I?
I'm a helpful personal assistant focused on productivity and organization.

## What am I good at?
- Scheduling and calendar management
- Note-taking and knowledge management
- Task prioritization and reminders

## How do I communicate?
Friendly, professional, and concise. I use bullet points and ask clarifying questions.

## What are my priorities?
1. Accuracy over speed
2. Privacy and security
3. Proactive suggestions
```

The coordinator loads this at startup and includes it in the system prompt.

## Dashboard Filtering

The dashboard automatically supports multi-bot filtering:

1. **Bot Selector** appears at the top of each page
2. **Filter by bot** to see metrics for specific bots
3. **"All Bots"** view shows aggregate stats

API endpoints support `?bot_id=<bot-name>` query parameter.

## Data Isolation

### Database
- All bots share one PostgreSQL database
- `bot_id` column tracks which bot handled each invocation
- Queries automatically filter by `bot_id` for isolation

### NATS Message Bus
- All bots share one NATS server
- Each bot subscribes to its own Mattermost webhooks
- No message crossover between bots

### File Storage
- Each bot has its own `WORKSPACE_ROOT` directory
- Tools only access files within that bot's workspace
- No file access crossover between bots

### Mattermost
- Each bot uses a unique `MATTERMOST_BOT_TOKEN`
- Each bot can join different teams
- No message/channel crossover between bots

## Security Considerations

### Shared Resources
- ✅ Database (isolated by `bot_id`)
- ✅ NATS (pub/sub, no conflicts)
- ✅ Universal agents (stateless workers)

### Isolated Resources
- ✅ Mattermost accounts (separate tokens)
- ✅ File storage (separate directories)
- ✅ LLM budget tracking (per-bot limits)

### Tool Access
- Tools only load if environment variables are configured
- Missing credentials = tools automatically disabled
- Each bot can have different tool access

## Example: Three-Bot Setup

### Personal Assistant
```.env.personal
BOT_ID=personal
MATTERMOST_TEAM_NAME=general
ENABLE_OSINT_TOOLS=false
ENABLE_CRYPTO_TOOLS=false
IDENTITY_FILE=./storage/identity-personal.md
```

### OSINT Researcher
```.env.osint
BOT_ID=osint
MATTERMOST_TEAM_NAME=security
ENABLE_OSINT_TOOLS=true
ENABLE_CRYPTO_TOOLS=false
OSINT_API_KEY=...
IDENTITY_FILE=./storage/identity-osint.md
```

### Crypto Trader
```.env.cryptid
BOT_ID=cryptid
MATTERMOST_TEAM_NAME=trading
ENABLE_OSINT_TOOLS=false
ENABLE_CRYPTO_TOOLS=true
SOLANA_RPC_URL=...
IDENTITY_FILE=./storage/identity-cryptid.md
```

Then run: `npm start` → All three bots start and run in parallel!

## Troubleshooting

### Bot not showing in PM2 list
- Check that `.env.<bot-name>` file exists and is not `.env.example` or `.env.template`
- Run `pm2 restart pm2.config.js` to reload configuration

### Bot showing wrong tools
- Check `ENABLE_*_TOOLS` environment variables in `.env.<bot-name>`
- Restart the bot: `pm2 restart nimble-<bot-name>`

### Dashboard showing wrong data
- Check `bot_id` query parameter in API calls
- Run database migration: `npm run db:migrate`

### Bots conflicting
- Ensure each bot has unique `MATTERMOST_BOT_TOKEN`
- Ensure each bot has unique `WORKSPACE_ROOT`
- Check that `BOT_ID` matches the `.env.*` file suffix

## Advanced: Private Fork for Sensitive Tools

See [PRIVATE-FORK-GUIDE.md](./PRIVATE-FORK-GUIDE.md) for instructions on:
- Creating a private fork with sensitive tools
- Pulling updates from public repo
- Managing merge conflicts
- Keeping sensitive code isolated
