# Dynamic Swarm Architecture

## Overview

The NimbleCo coordinator supports **dynamic agent swarms** with **no hardcoded limits** on the number of agents. You can request 5, 10, 50, or any number of agents based on your needs.

## How It Works

### 1. Natural Language Requests

Users can request any number of agents using natural language:

```
@audrey-bot spin up 5 agents to redesign the homepage
@audrey-bot create a 10-agent security red team
@audrey-bot I need 20 agents to review this codebase
```

### 2. Claude-Powered Parsing

The coordinator uses Claude (Sonnet 4.5) to parse the request and extract:
- Number of agents
- Agent types/roles
- Individual instructions for each agent

**See:** `/coordinator/src/main.ts` line 514-556 (handleCustomTask)

### 3. Dynamic Spawning

The coordinator spawns agents based on Claude's parsing:

```typescript
// No hardcoded limit!
const agents = parsedFromClaude; // Could be 3, 5, 10, 100...

const results = await Promise.allSettled(
  agents.map(agent => this.callAgent(agent.type, {
    role: agent.role,
    instructions: agent.instructions,
  }))
);
```

**See:** `/coordinator/src/main.ts` line 570-576

## Architecture Improvements (2026-03-13)

### Fixed Issues

1. **Undefined Task Errors** ✅
   - **Problem:** Coordinator subscribed to `tasks.*` which caught result messages
   - **Fix:** Changed to `tasks.from-mattermost` to only receive actual tasks
   - **File:** `/coordinator/src/main.ts` line 132

2. **No Hardcoded Limits** ✅
   - **Verification:** Searched entire codebase for hardcoded "3"
   - **Result:** No hardcoded agent count limits found
   - **Capability:** System supports N agents (limited only by resources)

3. **Deprecated Old Agent** ✅
   - **Action:** Stopped agent-code-review process
   - **Documentation:** Created `/agents/code-review/DEPRECATED.md`
   - **Replacement:** Universal agents handle all roles dynamically

## Universal Agent Architecture

### Old Way (Specialized Agents)

```
coordinator → agent-code-review (only code review)
           → agent-security (only security)
           → agent-test-runner (only tests)
```

**Limitations:**
- Fixed agent types
- Hardcoded roles
- Limited to 3 types

### New Way (Universal Agents)

```
coordinator → agent-universal (any role, any tools)
           → agent-universal (any role, any tools)
           → agent-universal (any role, any tools)
           → ... (as many as needed)
```

**Benefits:**
- Dynamic role assignment
- Any number of agents
- Flexible tool selection
- Scales to N agents

## Example Requests

### 5 Agents
```
@audrey-bot spin up 5 agents:
- 1 security expert
- 2 code reviewers
- 1 performance analyst
- 1 UX researcher
```

### 10 Agents
```
@audrey-bot create a 10-agent red team to find vulnerabilities
```

### 20 Agents
```
@audrey-bot I need 20 agents to analyze this entire codebase
- 10 for code quality
- 5 for security
- 5 for performance
```

## Technical Details

### NATS Subjects

- `tasks.from-mattermost` - Tasks from Mattermost → Coordinator
- `tasks.agent-universal` - Tasks from Coordinator → Universal Agents
- `results.${task_id}` - Results from Agents → Coordinator

**Important:** The coordinator no longer uses `tasks.*` wildcard to avoid catching result messages.

### Queue Groups

Universal agents use queue groups for load balancing:

```typescript
this.nc.subscribe('tasks.agent-universal', {
  queue: 'universal-agents' // Load balanced across all instances
});
```

This means:
- Multiple universal agents can run
- Tasks are automatically distributed
- Scales horizontally

## Scaling Guidelines

### Resource Requirements (per agent)

- **Memory:** ~50-100 MB
- **CPU:** Varies by LLM (local = high, cloud = low)
- **Network:** Minimal (NATS is lightweight)

### Recommended Limits

- **Local Ollama:** 5-10 agents (limited by GPU/CPU)
- **Cloud LLMs (Claude/Vertex):** 50-100 agents (limited by API rate limits)
- **Hybrid:** 20-30 agents (mix of local and cloud)

### Monitoring

Track agent performance in logs:
```
🐝 Spawning 10 agents
  → Agent 1/10: ✓ completed in 1.2s
  → Agent 2/10: ✓ completed in 0.8s
  ...
✅ Swarm complete: 9 succeeded, 1 failed
```

## Future Enhancements

1. **Dynamic Agent Scaling**
   - Auto-spawn agents based on queue depth
   - Auto-kill idle agents to save resources

2. **Agent Pools**
   - Pre-spawn agent pools for instant response
   - Warm standby for high-traffic scenarios

3. **Cost Optimization**
   - Route simple tasks to local models
   - Route complex tasks to cloud models
   - Automatic model selection

4. **Agent Specialization**
   - Agents learn from feedback
   - Role-specific context retention
   - Performance-based routing

---

**Last Updated:** 2026-03-13
**Author:** Juniper Bevensee
