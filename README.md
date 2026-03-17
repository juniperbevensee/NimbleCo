# NimbleCo

**A self-hosted, hackable agent orchestration platform for teams.**

Mattermost + GitHub/Radicle + intelligent agents working together. Built for **speed, simplicity, and local-first autonomy**.

## Vision

Enable 1+ people to orchestrate a suite of AI agents for code collaboration, task automation, and knowledge management. The point is not ideology—the point is **effectiveness and nimble development**.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              HUMAN INTERFACE LAYER                  │
│                                                     │
│  Mattermost (chat) • GitHub/Radicle (code)          │
│  Calendar (ICS) • File Storage (MinIO/GDrive)       │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│         AGENT ORCHESTRATION (Coordinator)           │
│                                                     │
│  Task decomposition • Agent dispatch • Aggregation  │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│      AGENT COMMUNICATION (NATS - sub-ms latency)    │
│                                                     │
│  High-speed pub/sub • Request/reply • Persistence   │
└─────────────────────────────────────────────────────┘
                        ↓
                        ┼
                        ↓
                    ┌─────────┐
                    │Univeral │
                    │ agent   │
                    └─────────┘
```

## Key Features

- **Sub-millisecond agent communication** via NATS
- **Local-first**: Run on your laptop or room of mac studios. Scale independent.
- **Hybrid LLM support**: Local (Qwen 2.5, Llama 3.1) + Cloud (Claude, Vertex, Bedrock)
- **Composable**: Swap Mattermost for Discord/Slack, add new agents easily
- **Practical**: No over-engineering, start simple, scale when needed
- **Private**: Self-hosted, your data stays yours
- **Cost-effective**: Use free cloud credits + local models

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- (Optional) Ollama for local LLMs

### First Time Setup

```bash
git clone https://github.com/juniperbevensee/NimbleCo.git
cd NimbleCo

# Interactive setup - configures everything
npm run setup
```

The setup script will configure LLM providers, integrations, and generate your `.env` file.

### Daily Development

```bash
npm start          # Start everything
npm run restart    # After code or .env changes
npm stop           # Stop everything
```

That's it. `npm start` handles Docker, migrations, builds, and runs the coordinator.

### Joining an Existing Mattermost Server

If connecting to a shared Mattermost (e.g., `mattermost.nimbleco.ai`), contact an admin for:
1. Bot token (they create it in System Console → Bot Accounts)
2. Your user ID if you need admin privileges

Enter these when running `npm run setup`.

## Project Structure

```
NimbleCo/
├── coordinator/           # Central orchestration service
│   ├── src/
│   │   ├── main.ts           # Entry point
│   │   ├── mattermost-listener.ts    # Mattermost bot integration
│   │   └── workflow-executor.ts
│   └── Dockerfile
├── agents/                # Specialist agents
│   ├── code-review/       # Code review agent
│   └── universal/         # General-purpose agent
├── dashboard/             # Admin dashboard (Vite + React)
│   ├── src/
│   │   ├── App.tsx           # Main dashboard app
│   │   ├── pages/            # Dashboard pages
│   │   │   ├── Dashboard.tsx      # Overview metrics
│   │   │   ├── InvocationStats.tsx # Rate limit usage
│   │   │   ├── AgentStatus.tsx    # Agent health
│   │   │   └── ToolUsage.tsx      # Tool & LLM stats
│   │   └── App.css           # Dashboard styles
│   ├── server.ts          # Express API server
│   └── vite.config.ts     # Vite configuration
├── shared/                # Shared libraries
│   ├── llm-adapters/      # Multi-provider LLM support
│   └── tools/             # Shared agent tools
│       └── src/
│           ├── calendar/  # ICS calendar tools
│           ├── code/      # GitHub integration
│           ├── crm/       # Attio CRM
│           ├── docs/      # Notion integration
│           ├── filesystem/# Sandboxed file operations
│           ├── meetings/  # Jitsi video meetings
│           ├── memory/    # Agent memory tools
│           └── storage/   # File storage tools
├── config/                # Configuration templates
│   └── identity.template.md  # Agent identity template
├── storage/               # Runtime data (gitignored)
│   ├── identity.md        # Personalized agent identity
│   └── memory.md          # Agent learned preferences
├── infrastructure/
│   └── postgres/          # Database schemas
├── scripts/               # Setup scripts
├── workflows/             # Workflow definitions
│   ├── daily-standup.yml
│   ├── handoff.yml
│   └── pr-review.yml
├── workspace/             # Agent sandboxes
├── docs/
│   ├── BEDROCK-AUTH-SOLUTION.md
│   ├── RATE_LIMITING.md
│   ├── SWARM-ARCHITECTURE.md
│   ├── context-sharing.md
│   ├── filesystem-sandbox.md
│   ├── free-credits.md
│   ├── integrations-architecture.md
│   ├── llm-improvements.md
│   ├── security-hardening.md
│   ├── tool-permissions.md
│   ├── tool-selection-strategy.md
│   └── tool-system-overview.md
├── docker-compose.yml
├── ecosystem.config.js
├── jest.config.js
└── setup.sh
```

## Local LLM Setup (Mac Mini)

Your Mac Mini (32GB RAM, 1TB storage) is perfect for running multiple models:

```bash
# Install Ollama
brew install ollama

# Start Ollama service
ollama serve

# Pull recommended models
ollama pull qwen3.5:9b            # Latest best small model with 256K context (6.6GB)
ollama pull qwen2.5-coder:32b     # Best available coding model (20GB)
ollama pull codellama:34b         # Meta's code model (19GB)
ollama pull deepseek-coder-v2:16b # Alternative coder (10GB)

# Test it
ollama run qwen3.5:9b "What's the difference between async and await?"
ollama run qwen2.5-coder:32b "Review this code: console.log('hello')"
```

**Model Selection Strategy:**
- **Quick tasks** (summaries, categorization): Qwen 3.5 9B (latest, 256K context)
- **Code generation/review**: Qwen 2.5 Coder 32B (specialized coding model)
- **Alternative code models**: CodeLlama 34B, DeepSeek Coder V2 16B
- **Best quality (cloud)**: Claude Sonnet 4.5

**Note:** Models evolve rapidly. Use `ollama list` to see what's installed locally. Check [Ollama library](https://ollama.com/library) for the latest available models.

## Free AI Credits

Get free cloud credits to supplement local models:

### Google Cloud (Vertex AI)
- $300 free credits for 90 days
- Access to Gemini models
- [Setup guide](./docs/free-credits.md#vertex-ai)

### AWS (Bedrock)
- Free tier available
- Access to Claude, Llama, Titan models
- [Setup guide](./docs/free-credits.md#aws-bedrock)

### Azure (OpenAI)
- $200 free credits
- Access to GPT-4, GPT-3.5
- [Setup guide](./docs/free-credits.md#azure-openai)

## Configuration

Key environment variables in `.env`:

```bash
# Core Infrastructure
NATS_URL=nats://localhost:4222
DATABASE_URL=postgresql://agent:password@localhost:5432/nimbleco

# Mattermost Integration
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_BOT_TOKEN=your-bot-token
MATTERMOST_ADMIN_USERS=user_id_1,user_id_2
MATTERMOST_LOG_ALL_MESSAGES=true

# LLM Providers (add any/all you want to use)
# Local (via Ollama)
OLLAMA_URL=http://localhost:11434

# Cloud APIs (optional)
ANTHROPIC_API_KEY=sk-ant-...
VERTEX_AI_PROJECT=your-gcp-project
VERTEX_AI_LOCATION=us-central1
AWS_BEDROCK_REGION=us-east-1

# GitHub Integration
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Radicle (optional)
RADICLE_NODE_URL=http://localhost:8080

# File Storage
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
```

## Agent Capabilities

### Code Review Agent
- Analyzes PRs for bugs, style issues, best practices
- Posts inline comments on GitHub/Radicle
- Runs linters and type checkers
- Notifies team via Mattermost

### Universal Agent
- General-purpose agent for flexible task handling
- Can be configured for various workflows
- Extensible with custom tools
- Handles tasks that don't fit specialized agents

## Agent Memory & Identity

NimbleCo includes a persistent memory system that allows agents to maintain identity and learned preferences across restarts:

### Constitutional Identity Document

Defines the agent's core values, principles, and communication preferences:

- **Location**: `config/identity.template.md` (template) or `storage/identity.md` (personalized, gitignored)
- **Purpose**: Loaded at startup and included in the agent's system prompt
- **Customization**: Copy template to `storage/identity.md` and personalize with your context
- **Contents**: Core values, relationships, communication style, technical context

### Persistent Memory

Append-only memory file for learned preferences and session notes:

- **Location**: `storage/memory.md`
- **Tools available**:
  - `read_agent_memory` - Recall learned preferences
  - `append_agent_memory` - Add new learnings (append-only)
  - `update_session_notes` - Track temporary context (cleared on restart)

### Key Features

- **Memory autonomy**: Agents can decide what to remember
- **Append-only preferences**: Historical record of learned values
- **Ephemeral session notes**: Temporary working memory
- **Privileged access**: Memory tools bypass filesystem sandbox for self-management
- **Constitutional grounding**: Identity document provides stable core values

Example memory entries:
```markdown
# Learned Preferences
- 2026-03-16: I prefer threaded progress updates with final results at top level
- 2026-03-16: Access control: public channels visible to all, private channels restricted

# Session Notes
Currently working on: PostgreSQL schema migrations
```

See the [identity template](./config/identity.template.md) for customization instructions.

## Tool System & Integrations

NimbleCo includes a practical tool integration system:

**Key Features:**
- **Smart tool selection**: Tiered loading keeps prompts manageable
- **Direct API access**: No abstraction overhead, full API power
- **Easy extensibility**: Add new tools by writing a function and registering it

**Current Integrations:**

| Category | Tool | Status |
|----------|------|--------|
| CRM | Attio | Available |
| Meetings | Jitsi | Available |
| Documentation | Notion | Available |
| Code | GitHub | Available |
| Calendar | ICS feeds | Available |
| Filesystem | Sandboxed ops | Available |

See [Tool System Overview](./docs/tool-system-overview.md) and [Tool Selection Strategy](./docs/tool-selection-strategy.md) for details.

## Admin Dashboard

NimbleCo includes a modern admin dashboard for monitoring system health, invocation statistics, and costs.

**Features:**
- **System Overview** - Real-time metrics (invocations, costs, agent health)
- **Invocation Stats** - Per-user breakdown, rate limit usage, recent activity
- **Agent Status** - Health monitoring, execution stats, last seen
- **Tool & LLM Usage** - Call counts, success rates, token consumption

**Access:**
- URL: http://localhost:5173
- API Server: http://localhost:3001
- Configuration: `DASHBOARD_ENABLED=true` in `.env`

**Architecture:**
```
Dashboard (React + Vite) :5173
       ↓ /api proxy
Dashboard API Server (Express) :3001
       ↓
PostgreSQL (invocations, agents, tool_calls)
```

The dashboard queries PostgreSQL directly for real-time data.

## Adding New Agents

```bash
# Copy an existing agent as template
cp -r agents/universal agents/my-new-agent

# Edit agent config
cd agents/my-new-agent
# Update package.json name
# Implement your agent logic in src/main.ts

# Restart to pick up the new agent
npm restart
```

## Security

NimbleCo implements multiple layers of security to protect against malicious operations and abuse:

- **Filesystem Sandbox** - All file operations restricted to `./workspace` directory
- **SSRF Protection** - Web fetch blocks localhost and private IP ranges
- **Audit Logging** - All destructive operations logged to database
- **Rate Limiting** - Prevents spam/abuse:
  - Per-user daily limit: 30 invocations/day (configurable)
  - Global daily cap: 150 invocations/day across all users
  - Bot-to-bot limit: 20 invocations/day
  - Admins bypass daily limits but NOT circuit breaker
- **Circuit Breaker** - Prevents infinite loops and recursion bombs:
  - Applies to ALL users including admins
  - Blocks after 20 invocations in 60 seconds
  - Protects against accidental recursive invocations
- **Recursive Delete Protection** - Cannot delete workspace root
- **Tool Permissions** - Fine-grained access control for sensitive operations

See [Security Hardening Guide](./docs/security-hardening.md) for implementation details and testing procedures.

## Roadmap

### Phase 1: MVP (Current)
- NATS-based communication
- Basic coordinator with Mattermost integration
- Code review agent + Universal agent
- Local + cloud LLM support
- Tool permission system

### Phase 2: Enhanced Features
- Visual workflow builder
- Real-time agent dashboard
- More specialist agents
- Radicle full support
- **Vision capabilities**: Enable Audrey to process images and screenshots
  - Image attachment analysis via vision-capable models (Claude, GPT-4V)
  - Screenshot debugging and UI feedback
  - Diagram/chart interpretation
- **Multi-platform chat support**:
  - **Signal bridge** - E2EE messaging integration via signal-cli or libsignal
  - Discord bridge - Guild/DM support
  - Slack bridge - Workspace integration
- **Storage architecture**: Decide how different chat platforms store conversation data
  - Shared database vs. per-platform isolation
  - Cross-platform context sharing (same user across Mattermost + Signal?)
  - Signal message persistence and E2EE considerations
- **Access-controlled analytics**: Room/channel-scoped log analysis
  - Non-admins can only analyze logs from rooms they're in
  - Admins can analyze across all rooms (existing MATTERMOST_ADMIN_USERS pattern)
  - Sensitive tools gated by room membership, not just user ID
- **Pluggable agent runtimes**: Support different agent types beyond the universal agent
  - Containerized agents (Docker/Podman) for sandboxed execution
  - Generic agent harness for popular frameworks:
    - ZeroClaw integration for autonomous coding
    - OpenClaw/Claude Code integration
    - Other LangGraph/CrewAI/AutoGPT agents
  - Agent registry with capability declarations
  - Runtime selection based on task requirements (security, resources, tools needed)
  - Standardized interface for wrapping any agent framework into NimbleCo
- **Environment personas**: Named .env profiles for different deployment contexts
  - Switch between local dev, staging, production configs easily
  - Support `.env.local`, `.env.staging`, `.env.prod` naming pattern
  - CLI command to switch active persona

### Phase 2.5: Agentic Swarms
- **Tool-using swarm agents**: Currently conversation-mode swarms skip tools to stay under the
  per-turn timeout. Agentic swarm modes (research, code review, etc.) need a different approach:
  - Add `swarm_mode: 'agentic'` alongside the existing `'conversation'` mode
  - Make the per-turn timeout configurable when spawning a swarm (not hardcoded at 120s)
  - A code review agent reading 10 files + running analysis may need 3-5 min per turn
  - `swarm_mode` is already on `AgentTask` — just needs new values and coordinator logic to
    pass an appropriate timeout based on the declared mode

### Phase 3: Scale
- NATS clustering
- Multi-region deployment
- Advanced cost optimization
- **Federated agent network**: Agent-to-agent communication across devices/networks
  - NAT traversal (MakeNAT, libp2p, or similar) for peer-to-peer agent comms
  - Distributed task delegation between people running bots
  - Capability discovery across the network ("who has a GPU agent?")
  - Trust/permission model for cross-network agent interactions

## Architecture Decisions

### Why NATS?
- Sub-millisecond latency
- 1M+ messages/sec throughput
- Simple deployment (single Docker container)
- Optional persistence with JetStream
- Battle-tested (Cloudflare, MasterCard)

### Why Mattermost?
- Self-hosted and open source
- Rich UI (threads, reactions, file sharing)
- Excellent API and bot support
- Familiar Slack-like UX
- Production-ready for teams
- Composable (can swap for Discord/Slack later)

### Why Local + Cloud Hybrid?
- Local models are fast and free
- Cloud models for complex tasks (Claude for hard reasoning)
- Free credits from multiple providers
- Cost optimization by routing appropriately

## Contributing

This is an experimental project. Contributions welcome! Areas of interest:
- New specialist agents
- Integration plugins (GitLab, Bitbucket, etc)
- UI improvements
- Performance optimizations
- Documentation

## License

AGPL-3.0 License - see [LICENSE](./LICENSE)

## Inspiration

- [Egregore](https://egregore.xyz) - Shared context patterns
- [Cantrip](https://github.com/deepfates/cantrip) - Agent architecture patterns
- Claude Code - Terminal-native AI collaboration

## Support

- GitHub Issues: Report bugs or request features
- Docs: [docs/](./docs/)

---

Built for practical, effective agent orchestration.
