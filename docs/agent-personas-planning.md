# Agent Personas Architecture Planning

**Status**: Planning / Design Phase
**Goal**: Support multiple agent instances with different environment profiles, tool access, and invocation permissions

## Use Cases

### Primary Use Case: Personal Agent with Private Tool Access
**Scenario**: Juniper wants an agent in public channels that:
- Only they can invoke (even though others see it)
- Has access to their private resources (GitHub, GDrive, Notion)
- Can perform personal tasks like "turn this thread into a Notion task"
- No other users can access these private resources through any agent

### Secondary Use Cases
- **Budget-controlled agents**: Expensive Claude Opus agent vs cheap Ollama agent
- **Specialized tooling**: Code-review agent with GitHub access vs writer agent with Notion
- **Team-specific**: Engineering team agent vs Marketing team agent
- **Development stages**: Local dev agent vs staging vs production agents

## Core Requirements

### 1. Security & Isolation
**Critical**: One agent MUST NOT be able to:
- Read another agent's environment variables
- Access another agent's tool credentials
- See another agent's conversation history/logs
- Trigger actions using another agent's permissions

### 2. Access Control
**Who can invoke which agent?**
- User-specific agents (only Juniper can invoke their personal agent)
- Role-based agents (only admins can invoke certain agents)
- Channel-based agents (agent only responds in certain channels)
- Combination of above

### 3. Observability
**Dashboard requirements**:
- Filter invocations by persona/agent instance
- View costs per persona
- Monitor which user is using which agent
- Audit log: who invoked what agent with what tools

### 4. Operational Complexity
**Trade-offs to consider**:
- PM2 process management (many processes = messy logs?)
- Configuration management (many .env files?)
- Deployment complexity (N agents to manage)
- Debugging experience (which agent did what?)

## Architecture Options

### Option A: Separate Agent Processes (Process Isolation)

```
PM2 Processes:
├── coordinator (shared)
├── agent-universal-juniper-personal
├── agent-universal-team-shared
├── agent-universal-expensive
└── agent-code-review
```

**Implementation:**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'agent-juniper-personal',
      script: 'dist/main.js',
      cwd: './agents/universal',
      env_file: './personas/juniper-personal.env',
      env: {
        AGENT_PERSONA: 'juniper-personal',
        AGENT_DISPLAY_NAME: '@audrey-personal',
        ALLOWED_USERS: 'juniper_user_id',  // Only Juniper can invoke
        NATS_QUEUE_GROUP: 'persona-juniper-personal',
        LOG_FILE: './logs/juniper-personal.log',
      }
    },
    {
      name: 'agent-team-shared',
      script: 'dist/main.js',
      cwd: './agents/universal',
      env_file: './personas/team-shared.env',
      env: {
        AGENT_PERSONA: 'team-shared',
        AGENT_DISPLAY_NAME: '@audrey',
        ALLOWED_USERS: '*',  // Anyone can invoke
        NATS_QUEUE_GROUP: 'persona-team-shared',
        LOG_FILE: './logs/team-shared.log',
      }
    }
  ]
};
```

**Persona Environment Files:**
```bash
# personas/juniper-personal.env
GITHUB_TOKEN=juniper_personal_token
NOTION_TOKEN=juniper_notion_workspace
GDRIVE_CREDENTIALS=juniper_google_oauth
LLM_PROVIDER=bedrock
LLM_MODEL=claude-opus-4
BUDGET_LIMIT_USD=50.00

# personas/team-shared.env
GITHUB_TOKEN=team_readonly_token
NOTION_TOKEN=  # No Notion access
GDRIVE_CREDENTIALS=  # No GDrive access
LLM_PROVIDER=ollama
LLM_MODEL=qwen3.5:9b
BUDGET_LIMIT_USD=5.00
```

**Pros:**
- ✅ **Strong isolation**: OS-level process separation
- ✅ **Simple security model**: Env vars are process-scoped
- ✅ **Easy to reason about**: Each agent is independent
- ✅ **Crash isolation**: One agent crash doesn't affect others
- ✅ **Resource limits**: Can set memory/CPU per agent

**Cons:**
- ❌ **Many PM2 processes**: Could get messy (5+ agents = 5+ processes)
- ❌ **Resource overhead**: Each process has its own memory
- ❌ **Log fragmentation**: Need to correlate logs across processes
- ❌ **Startup complexity**: Managing many process lifecycles

**PM2 Logs:**
```bash
pm2 logs agent-juniper-personal  # Only Juniper's agent logs
pm2 logs agent-team-shared        # Team agent logs
pm2 logs --raw | grep "user:juniper"  # Filter by user
```

---

### Option B: Single Agent Process with Runtime Personas (Runtime Isolation)

```
PM2 Processes:
├── coordinator (shared)
└── agent-universal (handles all personas dynamically)
```

**Implementation:**
```typescript
// coordinator dispatches tasks with persona context
interface TaskWithPersona {
  type: string;
  userId: string;
  persona: string;  // 'juniper-personal' | 'team-shared'
  input: string;
}

// Coordinator determines persona based on invocation
async function routeTask(mattermostEvent: MattermostEvent) {
  let persona: string;

  // Check if user has a personal agent
  if (mattermostEvent.user_id === 'juniper_user_id' &&
      mattermostEvent.message.includes('@audrey-personal')) {
    persona = 'juniper-personal';
  } else {
    persona = 'team-shared';
  }

  // Dispatch with persona context
  await nats.publish('tasks.universal', {
    persona,
    userId: mattermostEvent.user_id,
    task: parseTask(mattermostEvent.message),
  });
}

// Agent loads persona config at runtime
class UniversalAgent {
  personaConfigs: Map<string, PersonaConfig>;

  async handleTask(msg: TaskWithPersona) {
    const config = this.personaConfigs.get(msg.persona);

    // Validate user can invoke this persona
    if (!config.canInvoke(msg.userId)) {
      throw new Error('User not authorized for this persona');
    }

    // Execute with persona-scoped tools
    const tools = loadTools(config);
    const llm = createLLMClient(config);

    await this.executeTask(msg.task, { tools, llm, config });
  }
}
```

**Persona Configuration:**
```typescript
// personas/config.ts
export const personas: Record<string, PersonaConfig> = {
  'juniper-personal': {
    displayName: '@audrey-personal',
    allowedUsers: ['juniper_user_id'],
    tools: {
      github: { token: process.env.JUNIPER_GITHUB_TOKEN },
      notion: { token: process.env.JUNIPER_NOTION_TOKEN },
      gdrive: { credentials: process.env.JUNIPER_GDRIVE_CREDS },
    },
    llm: {
      provider: 'bedrock',
      model: 'claude-opus-4',
      budget: 50.00,
    },
  },
  'team-shared': {
    displayName: '@audrey',
    allowedUsers: '*',
    tools: {
      github: { token: process.env.TEAM_GITHUB_TOKEN },
      // No Notion/GDrive
    },
    llm: {
      provider: 'ollama',
      model: 'qwen3.5:9b',
      budget: 5.00,
    },
  },
};
```

**Pros:**
- ✅ **Single process**: Cleaner PM2 process list
- ✅ **Shared resources**: Lower memory overhead
- ✅ **Unified logging**: All agent activity in one log stream
- ✅ **Easy deployment**: Only one agent to manage
- ✅ **Dynamic personas**: Can add/remove without restart

**Cons:**
- ❌ **Complex isolation**: Must ensure no credential leakage
- ❌ **Shared memory space**: One bug could expose all credentials
- ❌ **Security risk**: If tool loading has a bug, cross-persona access possible
- ❌ **No crash isolation**: One agent crash takes down all personas
- ❌ **Difficult to audit**: Harder to verify isolation is working

**Security Concerns:**
```typescript
// BAD: Potential credential leakage
let globalToolCache = {};  // Could cache tools across personas!

// GOOD: Persona-scoped tool instances
async function executeTask(task, persona) {
  const tools = createToolsForPersona(persona);  // Fresh instances
  try {
    await runTask(task, tools);
  } finally {
    tools.destroy();  // Clean up credentials
  }
}
```

---

### Option C: Hybrid - Agent Types + Runtime Personas

```
PM2 Processes:
├── coordinator (shared)
├── agent-personal (handles personal personas only)
└── agent-team (handles team/shared personas)
```

**Implementation:**
- Separate processes for "personal" vs "team" agent classes
- Within each process, runtime persona selection
- Balance between isolation and complexity

**Pros:**
- ✅ **Good isolation**: Personal agents can't leak to team agents
- ✅ **Manageable processes**: Only 2-3 agent processes
- ✅ **Some resource sharing**: Within each agent class

**Cons:**
- ⚠️ **Middle complexity**: More complex than Option A, less isolated than Option B
- ⚠️ **Still need runtime isolation**: Within each process

---

## Coordinator Routing

**How does coordinator know which agent/persona to dispatch to?**

### Strategy 1: Bot Mention-Based
```
User: @audrey review this PR
      ↓ routes to team-shared persona

User: @audrey-personal add this to my Notion
      ↓ routes to juniper-personal persona
```

**Implementation:**
```typescript
const botMentionMap = {
  '@audrey': 'team-shared',
  '@audrey-personal': 'juniper-personal',
  '@audrey-expensive': 'expensive-reasoning',
};

function determinePersona(message: string): string {
  for (const [mention, persona] of Object.entries(botMentionMap)) {
    if (message.includes(mention)) return persona;
  }
  return 'team-shared';  // Default
}
```

**Pros:**
- User-visible control (explicit @mention)
- Easy to understand

**Cons:**
- Multiple bot accounts in Mattermost
- Cluttered user list

### Strategy 2: Implicit Routing (Smart Detection)
```
User: @audrey add this to my Notion
      ↓ coordinator sees "Notion" + checks user has personal agent
      ↓ routes to juniper-personal persona

User: @audrey review this PR
      ↓ coordinator sees "review PR" + no personal tools needed
      ↓ routes to team-shared persona
```

**Implementation:**
```typescript
function determinePersona(message: string, userId: string): string {
  // Check if task requires personal tools
  const requiresPersonalTools =
    message.includes('Notion') ||
    message.includes('my GDrive') ||
    message.includes('my GitHub');

  // Check if user has a personal persona
  const personalPersona = `${userId}-personal`;
  if (requiresPersonalTools && personaExists(personalPersona)) {
    return personalPersona;
  }

  return 'team-shared';
}
```

**Pros:**
- Single bot account
- Automatic routing
- Less mental overhead for users

**Cons:**
- "Magic" behavior may surprise users
- Harder to predict which agent will respond
- Need good heuristics

### Strategy 3: Explicit Persona Flag
```
User: @audrey --personal add this to my Notion
User: @audrey --expensive analyze this complex codebase
User: @audrey review this PR  # defaults to team-shared
```

**Implementation:**
```typescript
function parsePersona(message: string): string | null {
  const match = message.match(/--(\w+)/);
  return match ? match[1] : null;
}
```

**Pros:**
- Explicit control
- Single bot account
- Easy to implement

**Cons:**
- Requires users to remember flags
- Less natural than @mentions

---

## Database Schema Changes

**Track persona usage for audit/billing:**

```sql
-- Add persona tracking to invocations
ALTER TABLE invocations
  ADD COLUMN agent_persona VARCHAR(100);

-- Add persona-specific configuration
CREATE TABLE agent_personas (
  id VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(200),
  llm_provider VARCHAR(50),
  llm_model VARCHAR(100),
  budget_limit_usd DECIMAL(10,2),
  allowed_user_ids TEXT[],  -- Array of Mattermost user IDs
  tool_config JSONB,        -- Encrypted tool credentials
  created_at TIMESTAMP DEFAULT NOW()
);

-- Track which users can invoke which personas
CREATE TABLE persona_permissions (
  persona_id VARCHAR(100) REFERENCES agent_personas(id),
  user_id VARCHAR(100),
  can_invoke BOOLEAN DEFAULT true,
  PRIMARY KEY (persona_id, user_id)
);
```

---

## Dashboard Integration

**UI Mockup for Persona Filtering:**

```
┌─────────────────────────────────────────────────┐
│ Invocations                                     │
│                                                 │
│ Filter by Persona: [All ▼]                      │
│                   [ ] team-shared               │
│                   [ ] juniper-personal          │
│                   [ ] expensive-reasoning       │
│                                                 │
│ Filter by User:    [All ▼]                      │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Time     User      Persona            Cost  │ │
│ │ 14:30    Juniper   juniper-personal   $0.08 │ │
│ │ 14:25    Alice     team-shared        $0.00 │ │
│ │ 14:20    Juniper   juniper-personal   $0.12 │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Cost Breakdown by Persona:                      │
│ ┌─────────────────────────────────────────────┐ │
│ │ team-shared:         $0.00  (Ollama)        │ │
│ │ juniper-personal:    $2.45  (Claude Opus)   │ │
│ │ expensive-reasoning: $15.30 (Claude Opus)   │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Backend API additions:**
```typescript
// GET /api/invocations/recent?persona=juniper-personal
// GET /api/costs/by-persona
// GET /api/personas/list
```

---

## Security Deep Dive

### Threat Model: What Could Go Wrong?

**Attack Vector 1: Credential Leakage**
```typescript
// BAD: Global state could leak credentials
let currentPersonaTools = null;

async function handleTask(task, persona) {
  currentPersonaTools = loadTools(persona);  // Stored globally!
  await executeTask(task);
}

// If another task runs concurrently, it could access currentPersonaTools
```

**Mitigation:**
- Use local scoping (no globals)
- Pass tools explicitly through call chain
- Clear credentials after task completion

**Attack Vector 2: Log Leakage**
```typescript
// BAD: Logging tokens
console.log('Using GitHub token:', config.githubToken);

// BAD: Logging API responses with sensitive data
console.log('GitHub API response:', response);
```

**Mitigation:**
- Redact credentials in logs
- Use structured logging with persona context
- Separate log files per persona (Option A)

**Attack Vector 3: Tool Confusion**
```typescript
// User invokes team agent but tries to trick it
User: "@audrey list files in my GDrive"
      ↓ team agent doesn't have GDrive access
      ↓ but what if tool resolution is buggy?
```

**Mitigation:**
- Strict tool registration per persona
- Fail closed: if tool not available, error immediately
- Audit log of which persona used which tools

**Attack Vector 4: Permission Bypass**
```typescript
// User tries to invoke personal agent
User: "@audrey-personal list my Notion tasks"
      ↓ but user is Alice, not Juniper

// What if permission check is missing?
```

**Mitigation:**
- Always check `allowed_users` before task execution
- Fail fast: reject unauthorized invocations immediately
- Audit log of denied invocations

---

## Logging Strategy

### Option A Logging (Separate Processes)
```bash
# Separate log files per persona
logs/
├── agent-juniper-personal-out.log
├── agent-juniper-personal-error.log
├── agent-team-shared-out.log
└── agent-team-shared-error.log

# PM2 logs
pm2 logs agent-juniper-personal
pm2 logs agent-team-shared

# Grep across all
tail -f logs/*.log | grep "user:juniper"
```

### Option B Logging (Single Process, Runtime Personas)
```bash
# Single log with persona tagging
logs/agent-universal-out.log:
[2026-03-16T16:00:00] [persona:juniper-personal] [user:juniper] Task started
[2026-03-16T16:00:05] [persona:team-shared] [user:alice] Task started
[2026-03-16T16:00:10] [persona:juniper-personal] [user:juniper] Tool: Notion
```

**Structured Logging:**
```typescript
logger.info('Task started', {
  persona: 'juniper-personal',
  user: 'juniper_user_id',
  taskType: 'notion-create-task',
  timestamp: Date.now(),
});

// Can filter/query logs
logs.filter(log => log.persona === 'juniper-personal')
```

---

## Recommendations

### For Initial Implementation (MVP)

**Recommendation: Start with Option A (Separate Processes)**

**Why:**
- Strongest security guarantees (process isolation)
- Easier to debug (separate logs)
- Proven pattern (how most multi-tenant systems work)
- Can always consolidate later if PM2 becomes messy

**Config:**
```bash
personas/
├── juniper-personal.env   # Your private agent
└── team-shared.env        # Team's shared agent
```

**PM2:**
```javascript
module.exports = {
  apps: [
    { name: 'coordinator', script: 'coordinator/dist/main.js' },
    {
      name: 'agent-personal-juniper',
      script: 'agents/universal/dist/main.js',
      env_file: './personas/juniper-personal.env',
      env: { AGENT_PERSONA: 'juniper-personal' }
    },
    {
      name: 'agent-team',
      script: 'agents/universal/dist/main.js',
      env_file: './personas/team-shared.env',
      env: { AGENT_PERSONA: 'team-shared' }
    }
  ]
};
```

**Routing Strategy: Bot Mention-Based (Strategy 1)**
- Create two Mattermost bot accounts: `@audrey` and `@audrey-personal`
- Users explicitly choose which agent to invoke
- Clear, predictable behavior

### Future Optimizations

If PM2 process list gets unwieldy (10+ personas):
- Switch to Option C (Hybrid) - group by agent class
- Or implement Option B (Runtime Personas) with strong isolation guarantees

---

## Open Questions

1. **Multiple personal agents**: What if multiple users want personal agents?
   - `@audrey-juniper`, `@audrey-alice`, etc.?
   - Or single `@audrey-personal` that routes based on user ID?

2. **Cost allocation**: How to bill costs back to users?
   - Track by persona in dashboard
   - Per-user monthly reports?

3. **Agent discovery**: How do users know which agents are available?
   - `@audrey help` shows available personas?
   - Dashboard page listing agents and their capabilities?

4. **Credential management**: Where to store encrypted tool credentials?
   - In .env files? (current approach)
   - In database with encryption? (more secure but complex)
   - External secret manager (AWS Secrets Manager, Vault)?

5. **Dynamic persona creation**: Should admins be able to create new personas via UI?
   - Or always require code changes + redeployment?

---

## Next Steps

1. **Decision**: Choose architecture option (A, B, or C)
2. **Design**: Finalize routing strategy (mention-based, implicit, or flags)
3. **Implement**:
   - Persona configuration system
   - Coordinator routing logic
   - Agent permission checks
   - Dashboard persona filtering
4. **Test**: Security audit - verify no credential leakage
5. **Document**: User guide on creating/using personas
