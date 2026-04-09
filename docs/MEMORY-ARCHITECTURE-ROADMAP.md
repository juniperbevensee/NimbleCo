# Memory Architecture Roadmap

**Status:** Planning / Research
**Last Updated:** 2026-04-09

## Problem Statement

Current memory system (`storage/{agent}/memory.md`) is a single flat file that:
- Contains all learned preferences, patterns, and context
- Auto-injected into every request (growing token cost)
- No scoping by channel/room/project/tool
- No access control for multi-user scenarios

As agents accumulate more context, we need:
1. **Selective loading** - Only inject relevant memory (token efficiency)
2. **Scoped contexts** - Different memory for different channels/teams
3. **Access control** - Private channel memory shouldn't leak to public
4. **Tool-specific context** - Deep knowledge loaded only when using that tool

## Use Cases

### UC1: Channel-Scoped Memory
**Scenario:** Agent operates in both public team channel and private admin channel

**Need:**
- Private channel has sensitive context (security findings, personnel issues)
- Public channel has general team knowledge (coding standards, workflows)
- Same agent process, different memory injection based on where conversation happens

**Risk:** Memory from private channel leaks to public response

### UC2: Tool-Specific Deep Context
**Scenario:** Agent has 500+ tokens of context about tool configuration, but only uses tool 10% of time

**Need:**
- Don't waste tokens loading tool context for unrelated requests
- When tool IS used, agent needs full context (database structure, common patterns, quirks)

**Example categories:**
- CRM field mappings and pipeline stages
- Project management database structure and filters
- Code repository patterns and team ownership
- Search API response structures and parsing patterns

### UC3: Team/Domain Knowledge
**Scenario:** OSINT agent has specialized knowledge for security research

**Need:**
- Domain-specific patterns (threat intel sources, research methods)
- Only relevant when doing OSINT work, not general queries
- Shared across team members in that domain

### UC4: Project-Specific Context
**Scenario:** Agent is working on multiple projects with different stakeholders/timelines

**Need:**
- Load project context only when relevant
- Project timeline, blockers, key people
- Avoid loading Project A context when discussing Project B

### UC5: Cross-Platform Identity
**Scenario:** Same agent deployed in both team chat and personal Discord

**Need:**
- Namespace contexts by platform (team workspace vs personal server)
- Potentially different memory scopes for different platforms
- Clear separation of work vs personal contexts

## Architectural Dimensions

### 1. Memory Scope Hierarchy

```
Agent Level (Core)
├─ Always loaded: personality, communication style, role
└─ ~100-200 tokens

Platform Level
├─ Mattermost Team A
├─ Discord Server B
└─ Namespaces by deployment

Team Level
├─ Shared knowledge for team members
└─ Domain-specific patterns

Room/Channel Level
├─ Per-channel context
├─ Command aliases, conversation history summaries
└─ Auto-loaded based on current room

Tool Level
├─ Deep context per tool
├─ Only loaded when tool is used
└─ Database schemas, common queries, quirks

Project Level
├─ Temporary context tied to initiative
├─ Loaded on mention or explicit request
└─ Timeline, stakeholders, blockers
```

### 2. Access Control Models

#### Option A: Room-Scoped (Simplest)
**Model:** Each channel gets own memory file, only loaded in that channel

```
storage/{agent}/contexts/{room_id}/memory.md
```

**Pros:**
- Natural isolation - private never leaks to public
- Easy to reason about
- Mirrors human mental model

**Cons:**
- No cross-channel learning (feature or bug?)
- Knowledge duplication across channels
- Doesn't handle team-level shared knowledge

#### Option B: Hierarchical with Inheritance
**Model:** Memory flows down: Agent → Team → Channel

```
storage/{agent}/
  memory.md              # Core (always loaded)
  teams/{team}/
    memory.md            # Team knowledge (loaded for team members)
    channels/{room}/
      memory.md          # Channel-specific
```

**Pros:**
- Knowledge sharing at appropriate levels
- Explicit about scope
- Can have team-wide patterns + channel-specific overrides

**Cons:**
- More complex (3 files to check)
- Inheritance rules could conflict
- How to determine team membership?

#### Option C: Tag-Based Access Control
**Model:** All memory in one place, tagged with visibility

```markdown
---
visibility: private
channels: [abc123, xyz789]
teams: [red-team]
---
```

**Pros:**
- Single source of truth
- Flexible - same memory can be multi-context
- Can query by tag

**Cons:**
- Need runtime access enforcement
- Agent must understand "don't use tagged memory in wrong context"
- Harder to audit

### 3. Context Injection Strategies

#### Strategy 1: Static (Current Approach)
Load all memory at startup, inject into every request

**Pros:** Simple, agent always has full context
**Cons:** Token waste, doesn't scale, no scoping

#### Strategy 2: Request Analysis (Keyword-Based)
Analyze request before LLM call, load relevant memory

```typescript
if (request.includes('database') || request.includes('tasks')) {
  memories.push(loadMemory('tools/project-management.md'));
}
```

**Pros:** Efficient token usage, automatic
**Cons:** Keyword matching is brittle, false negatives

#### Strategy 3: Tool-Time Injection (Event-Driven)
Load tool context when tool is actually called

```typescript
// 1st call: minimal context
response = await llm.call(coreMemory + request);

// Agent chooses to use tool
if (response.toolCalls.includes('database_query')) {
  // 2nd call: inject tool context
  response = await llm.call(coreMemory + toolMemory + response);
}
```

**Pros:** Only load when needed, no false positives
**Cons:** Extra LLM round-trip, slower

#### Strategy 4: Agent-Driven (Explicit Tool)
Give agent a tool to load additional memory

```typescript
{
  name: 'load_memory_context',
  parameters: {
    context: { enum: ['tools/crm', 'projects/launch', 'domains/security'] }
  }
}
```

**Pros:** Agent decides relevance, explicit
**Cons:** Agent might forget, extra tool call, more complex

#### Strategy 5: Hybrid (Recommended)
Core (always) + Room (auto) + Tool (on-demand)

```typescript
// Always loaded
- Core agent preferences (~100 tokens)

// Auto-loaded based on context
- Current room memory (if exists)

// Loaded when tool is called
- Tool-specific deep context

// Available via explicit load
- Project contexts
- Domain knowledge
```

### 4. Storage Backend Options

#### Option A: Obsidian Vault (Markdown + Frontmatter)
```
storage/{agent}/memory/
  MEMORY.md              # Index
  user/role.md
  contexts/{room}/memory.md
  tools/{tool}.md
  projects/{project}.md
```

**Pros:**
- Agents already have filesystem tools
- Git-friendly (version history)
- Human-readable and editable
- Dataview plugin for queries
- No external dependencies

**Cons:**
- No database queries (Dataview helps but not SQL)
- No concurrent write locking
- Manual schema enforcement

#### Option B: Anytype (Structured Objects)
**Pros:**
- Built-in types and relations
- Free P2P sync
- Graph database queries
- Open source

**Cons:**
- No API yet (roadmap item)
- Need desktop app running
- Less mature

#### Option C: SQLite
**Pros:**
- Real queries (JOIN, WHERE, etc)
- Transaction support
- Concurrent access handled

**Cons:**
- Not human-readable without tools
- No git-friendly diffs
- Need migration system

**Recommendation:** Start with Obsidian (Option A), can migrate later

## Key Design Questions

### 1. Context Loading Timing
**When to inject memory into context?**
- [ ] All at startup (current, simple but wasteful)
- [ ] Based on request keywords (brittle)
- [ ] When tool is called (efficient but slower)
- [ ] Agent explicitly requests (most control)
- [ ] Hybrid approach (core + room auto, rest on-demand)

### 2. Access Control Granularity
**How to prevent memory leaks across contexts?**
- [ ] Room-scoped files (simplest, natural isolation)
- [ ] Hierarchical with inheritance (complex but flexible)
- [ ] Tag-based filtering (flexible but needs enforcement)

### 3. Tool Context Scope
**Should tool context be global or per-team?**
- `storage/{agent}/tools/crm.md` (shared across all teams)
- `storage/{agent}/teams/{team}/tools/crm.md` (team-specific)

### 4. Cross-Platform Namespacing
**How to handle same agent in multiple platforms?**
```
storage/{agent}/
  platforms/
    mattermost-team-workspace/
      contexts/...
    discord-personal-server/
      contexts/...
```

### 5. Memory Authorship
**Who can write to memory contexts?**
- Agent only (automatic learning)
- Admins only (manual curation)
- User who created it (ownership model)
- Room members (collaborative)

### 6. Egregore Integration
**How does this relate to Egregore's memory system?**

Egregore is for cross-agent handoffs (ephemeral working memory)
This system is for learned patterns (long-term memory)

**Options:**
- Keep separate (clear boundary)
- Egregore writes to memory after handoff completes
- Egregore references memory contexts in handoffs

### 7. Discovery and Visibility
**How does agent know what memory exists?**
- MEMORY.md as index (lists available contexts)
- Tool to list available memory contexts
- Memory is opaque (agent doesn't see what exists)

## Implementation Phases

### Phase 0: Current State (Implemented)
- [x] Single memory.md per agent
- [x] Auto-injected into every request
- [x] Agent can append new memories

### Phase 1: Token Efficiency (Priority)
Goal: Reduce token waste, load only relevant context

**Scope:**
- Restructure memory.md into vault (core + tools + projects)
- MEMORY.md becomes lightweight index (~100 tokens)
- Tool-specific context loaded when tool is called
- Keep everything in one agent namespace (no channel scoping yet)

**Implementation:**
1. Migrate existing memory.md to vault structure
2. Update memory injection to load core + tool contexts
3. Add tool to explicitly load project/domain contexts
4. Document structure in MEMORY.md index

**Out of scope:**
- Channel/room scoping
- Multi-user access control
- Cross-platform namespacing

### Phase 2: Channel Scoping
Goal: Support private vs public channel contexts

**Scope:**
- Add room-level memory contexts
- Auto-load room memory based on current channel
- Test with one agent in multiple channels

**Implementation:**
1. Create `contexts/{room_id}/memory.md` structure
2. Update coordinator to pass room_id to memory loader
3. Test isolation (private doesn't leak to public)
4. Add tool for agent to query available contexts

**Out of scope:**
- Hierarchical team memory
- Cross-channel queries

### Phase 3: Advanced Scoping
Goal: Team/project contexts with access control

**Scope:**
- Team-level shared memory
- Project contexts
- Explicit memory loading tools
- Access control enforcement

**Implementation:**
- TBD based on Phase 1 & 2 learnings

## Open Questions

1. **Concurrent writes:** If multiple users talk to agent simultaneously in different channels, how to handle memory updates?

2. **Memory lifecycle:** When does memory expire? Archive old project memories?

3. **Token budget:** What's the maximum context size we're comfortable with? (1000 tokens? 2000?)

4. **User intelligence needed:**
   - How often do users actually need private vs public separation?
   - Is tool context really that large? Measure actual sizes
   - Do users want visibility into what agent remembers?
   - How important is cross-channel knowledge sharing?

5. **Performance:** Tool-time injection adds latency. Is it acceptable?

6. **Backup/sync:** How to backup memory? Git is good for Obsidian, but what about concurrent edits?

## Success Metrics

How will we know if this is working?

- **Token efficiency:** Context size reduced by X% without hurting agent performance
- **No leaks:** Private channel memory never appears in public responses
- **User satisfaction:** Users report agent has "good memory" without being asked
- **Performance:** Response time increase < 500ms from lazy loading

## Next Steps

1. **Instrument current system:** Measure actual token usage per request type
2. **Survey usage patterns:** Which tools are used together? How often?
3. **Prototype Phase 1:** Migrate one agent's memory to vault structure
4. **Test token savings:** Compare before/after token counts
5. **Get user feedback:** Does selective loading hurt perceived memory quality?

## References

- Current implementation: `coordinator/src/main.ts` (lines 67-76, 536-548)
- Memory tools: `shared/tools/src/memory/agent-memory.ts`
- Path resolution fix: commit bf8a080 (2026-04-09)
