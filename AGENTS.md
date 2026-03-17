# NimbleCo - Agent Guide

This document explains the NimbleCo codebase for AI agents working on the project.

## Overview

NimbleCo is a self-hosted agent orchestration platform. It enables an AI assistant ("Audrey") to interact with users via chat (Mattermost), execute tasks using tools, and coordinate multi-agent swarms for complex work.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mattermost    │────▶│   Coordinator   │────▶│ Universal Agent │
│  (Chat UI)      │     │  (Orchestrator) │     │   (Workers)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │      NATS       │     │     Tools       │
                        │  (Message Bus)  │     │  (40+ integrations)
                        └─────────────────┘     └─────────────────┘
```

### Message Flow

1. User mentions `@audrey` in Mattermost
2. `MattermostListener` receives the message, classifies it (chat vs task)
3. Task is published to NATS on `tasks.from-mattermost`
4. `Coordinator` receives task and either:
   - Handles directly with tool calling (simple tasks)
   - Spawns a swarm of Universal Agents (complex tasks)
5. Response is posted back to Mattermost

## Directory Structure

```
NimbleCo/
├── coordinator/           # Central orchestration service
│   └── src/
│       ├── main.ts              # Coordinator class, task handling, swarms
│       ├── mattermost-listener.ts # WebSocket listener for Mattermost
│       ├── rate-limiter.ts      # Per-user and global rate limiting
│       ├── invocation-logger.ts # Logs all LLM calls to database
│       └── message-bus-logger.ts # Logs NATS messages for debugging
│
├── agents/
│   └── universal/         # Universal agent (handles any role)
│       └── src/main.ts          # Agentic loop with tool calling
│
├── shared/
│   ├── llm-adapters/      # Multi-provider LLM support
│   │   └── src/index.ts         # Ollama, Claude, Bedrock, Vertex adapters
│   │
│   └── tools/             # Tool implementations
│       └── src/
│           ├── index.ts         # Tool registry and execution
│           ├── base.ts          # Tool type definitions
│           ├── permissions.ts   # Tool permission system
│           ├── crm/             # Attio CRM tools
│           ├── docs/            # Notion tools
│           ├── code/            # GitHub tools
│           ├── mattermost/      # Chat tools (post, react, etc.)
│           ├── analytics/       # Database query tools
│           ├── filesystem/      # Sandboxed file operations
│           ├── web/             # HTTP fetch with SSRF protection
│           └── ...              # Other tool categories
│
├── dashboard/             # React dashboard for monitoring
├── infrastructure/        # Database schemas and migrations
├── config/                # Identity template and configs
├── scripts/               # Dev scripts (start, stop, restart)
└── docs/                  # Architecture documentation
```

## Key Files

### `coordinator/src/main.ts`
The brain of the system. Key methods:
- `handleTask()` - Routes tasks to appropriate handlers
- `handleCustomTask()` - Direct tool-calling loop for simple tasks
- `handleSwarmTask()` - Spawns multi-agent swarms
- `runConversationSwarm()` - Manages turn-based agent conversations
- `callAgent()` - Dispatches work to Universal Agents via NATS
- `postToChatPlatform()` - Sends responses back to Mattermost

### `coordinator/src/mattermost-listener.ts`
Handles Mattermost WebSocket connection:
- `handlePosted()` - Processes new messages mentioning the bot
- `classifyMessage()` - Uses LLM to classify as chat vs task
- `getThreadContext()` - Fetches conversation history for context
- `getLastChannelExchange()` - Gets previous message for continuity

### `agents/universal/src/main.ts`
Stateless worker agent:
- `processTask()` - Main agentic loop with tool calling
- Supports `swarm_mode: 'conversation'` for multi-agent discussions
- Auto-selects tools based on task or uses explicitly provided list

### `shared/llm-adapters/src/index.ts`
Multi-provider LLM abstraction:
- `LLMRouter` - Routes requests to available providers
- Supports: Ollama (local), Anthropic Claude, AWS Bedrock, Google Vertex
- Model tiers: `quick` (Haiku), `code` (Sonnet), `complex` (Opus)

### `shared/tools/src/index.ts`
Tool registry and execution:
- `registry` - Global tool registry
- `executeToolCall()` - Executes a tool with permission checks
- `getToolsForTask()` - Auto-selects relevant tools for a task

## Important Patterns

### Tool Calling Format
Agents output JSON to call tools:
```json
{"tool": "search_notion", "input": {"query": "meeting notes"}}
```

The coordinator/agent parses this and executes via `executeToolCall()`.

### Swarm Modes
- `parallel` - Agents work independently, results aggregated
- `conversation` - Agents take turns, building on each other's responses

### Rate Limiting
- Per-user daily limits (configurable)
- Global daily cap across all users
- Circuit breaker for rapid-fire abuse

### Identity Document
`storage/identity.md` contains the assistant's persona, voice, and behavioral guidelines. Loaded at startup and included in system prompts.

## Environment Variables

Key variables in `.env`:
```bash
# LLM Providers
ANTHROPIC_API_KEY=          # For Claude API
AWS_BEARER_TOKEN_BEDROCK=   # For AWS Bedrock
OLLAMA_URL=                 # Local Ollama instance

# Chat Platform
MATTERMOST_URL=             # Mattermost server URL
MATTERMOST_BOT_TOKEN=       # Bot access token
MATTERMOST_ADMIN_USERS=     # Comma-separated admin user IDs

# Database
DATABASE_URL=               # PostgreSQL connection string

# Integrations
NOTION_API_KEY=             # Notion integration
GITHUB_TOKEN=               # GitHub API access
ATTIO_API_KEY=              # Attio CRM
```

## Development Workflow

### Starting Services
```bash
npm install          # Install dependencies
npm run build        # Build all packages
npm start            # Start via PM2 (coordinator + agents)
```

### Logs
```bash
pm2 logs coordinator     # Coordinator logs
pm2 logs agent-universal # Agent logs
```

### Testing Changes
The coordinator uses compiled JS, so rebuild after changes:
```bash
npm run build
pm2 restart coordinator
```

Universal agents use `tsx watch` - changes auto-reload.

## Common Tasks

### Adding a New Tool
1. Create file in `shared/tools/src/<category>/<tool>.ts`
2. Define tool with `name`, `description`, `parameters`, `handler`
3. Export from category index and register in `shared/tools/src/index.ts`
4. Rebuild: `npm run build`

### Adding LLM Provider
1. Add adapter in `shared/llm-adapters/src/index.ts`
2. Implement `LLMAdapter` interface with `chat()` method
3. Register in `createLLM()` factory

### Debugging Tool Calls
Check the message bus logs in the database:
```sql
SELECT * FROM message_bus_log ORDER BY timestamp DESC LIMIT 50;
```

Or use the `analyze_message_bus` tool from chat.

## Database Schema

Key tables:
- `conversations` - Chat threads by room/channel
- `messages` - Individual messages with role (user/assistant)
- `invocations` - LLM call logs with tokens, cost, duration
- `message_bus_log` - NATS message history for debugging
- `audit_log` - Security-relevant actions

## Security Considerations

- **Filesystem Sandbox**: All file operations restricted to `./workspace`
- **SSRF Protection**: Web fetch blocks localhost and private IPs
- **Tool Permissions**: Some tools require admin or specific room context
- **Rate Limiting**: Prevents abuse and runaway costs

## License

AGPL-3.0 - Network use requires source disclosure.
