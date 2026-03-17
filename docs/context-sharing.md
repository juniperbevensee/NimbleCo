# Context Sharing & Shift Handoffs

## The Problem

**Vibe coders across timezones** need to:
- Hand off work between shifts
- Share context on what's happening
- Collaborate on worktrees
- Not lose information

**NOT an egregore/Neo4j problem.** This is a human workflow problem.

## The Simple Stack (No Neo4j Needed)

```
1. Git worktrees + branches  ← Code state
2. Mattermost threads        ← Async communication
3. Notion pages              ← Persistent docs
4. Calendar events           ← "Who's on duty"
5. File storage              ← Artifacts/screenshots
```

**Zero database complexity. Just good workflow.**

---

## Shift Handoff Pattern

### End of Shift Workflow

**In Mattermost #handoffs channel:**

```
@handoff-bot start
---
## Shift Summary - Alice (2024-01-15 9am-5pm PST)

**What I Did:**
- ✅ Implemented calendar tools (12 tests passing)
- ✅ Added file storage (15 tests passing)
- 🚧 Started cantrip harness adoption (50% done)

**Current State:**
- Branch: `feature/tool-system`
- Worktree: `./worktrees/tool-system`
- Tests: 27/27 passing
- Last commit: 0cbe836

**Blockers:**
- Need to decide: adopt full cantrip Depends pattern or simplified version?
- Browser tools need Playwright setup (waiting on Docker perms)

**Next Person Should:**
1. Pull `feature/tool-system` branch
2. Review docs/tool-system-overview.md
3. Continue harness adoption (src/tools/decorator.ts)
4. Run `npm test` to verify setup

**Links:**
- PR: #123
- Notion doc: [Tool System Architecture](notion link)
- Design doc: docs/tool-system-overview.md

---
@handoff-bot end
```

**Agent automatically:**
1. Parses handoff message
2. Updates Notion "Current Status" page
3. Creates calendar event for next shift
4. Uploads worktree state snapshot to storage
5. Posts summary to #general

---

## Handoff Bot Implementation

```typescript
// agents/handoff-bot/src/main.ts

import { Agent } from '@nimbleco/agent-framework';
import { createNotionPage, uploadFile, createCalendarEvent } from '@nimbleco/tools';

async function handleHandoff(message: MattermostMessage) {
  const handoff = parseHandoffMessage(message.content);

  // 1. Update Notion
  await createNotionPage({
    parent_id: NOTION_HANDOFFS_DB,
    title: `Shift: ${handoff.author} - ${handoff.date}`,
    content: formatHandoffForNotion(handoff),
  });

  // 2. Create calendar event for next shift
  if (handoff.nextShiftStart) {
    await createCalendarEvent({
      title: `${handoff.nextPerson} on duty`,
      start_time: handoff.nextShiftStart,
      end_time: handoff.nextShiftEnd,
      description: `Previous: ${handoff.author}\\nBranch: ${handoff.branch}`,
    });
  }

  // 3. Snapshot worktree (optional)
  if (handoff.worktree) {
    await exec(`tar -czf /tmp/worktree-snapshot.tar.gz ${handoff.worktree}`);
    await uploadFile({
      file_path: '/tmp/worktree-snapshot.tar.gz',
      destination: `handoffs/${handoff.date}-${handoff.author}.tar.gz`,
      metadata: {
        branch: handoff.branch,
        commit: handoff.commit,
      },
    });
  }

  // 4. Post summary
  await mattermostClient.post({
    channel: '#general',
    message: `🔄 **Shift Handoff**\\n${handoff.author} → ${handoff.nextPerson}\\nBranch: \`${handoff.branch}\`\\nStatus: ${handoff.summary}`,
  });
}
```

---

## Notion Structure

### "Current Status" Page

Auto-updated by agents:

```
# NimbleCo - Current Status

Last updated: 2024-01-15 17:00 PST by handoff-bot

## Active Work

### Tool System (feature/tool-system)
**Owner:** Alice → Bob (taking over)
**Status:** 🚧 In Progress (60% done)
**Branch:** feature/tool-system
**Last Commit:** 0cbe836
**Tests:** 27/27 passing
**Next:** Finish cantrip harness adoption

**Recent Activity:**
- Jan 15 17:00: Alice completed file storage tools
- Jan 15 14:00: Alice completed calendar tools
- Jan 15 09:00: Alice started shift

**Blockers:**
- Waiting on design decision: full Depends DI vs simplified

---

### Security Scanner (feature/security-agent)
**Owner:** Carol
**Status:** ✅ Ready for Review
**PR:** #122
**Tests:** 18/18 passing

---

## Upcoming

- [ ] Finish tool system (Bob, Jan 16)
- [ ] Review security PR (David, Jan 16)
- [ ] Deploy to staging (Alice, Jan 17)
```

---

## Git Worktree Strategy

### Setup

```bash
# Main repo
cd NimbleCo

# Create worktrees for parallel work
git worktree add ../worktrees/tool-system feature/tool-system
git worktree add ../worktrees/security feature/security-agent

# Each person can work in separate worktree
cd ../worktrees/tool-system
npm install
npm test

# Handoff: Just tell next person which worktree
```

### Handoff Between Shifts

```bash
# Alice's shift ending
cd worktrees/tool-system
git add -A
git commit -m "WIP: Harness adoption (Alice EOD)"
git push origin feature/tool-system

# Post in Mattermost
# @handoff-bot start
# Branch: feature/tool-system
# Worktree: worktrees/tool-system
# Tests: 27/27 passing
# @handoff-bot end

# Bob's shift starting
cd worktrees/tool-system
git pull
npm install  # In case new deps
npm test     # Verify setup
# Continue work...
```

---

## Why This Works (No Neo4j Needed)

| Need | Solution | Why It's Enough |
|------|----------|-----------------|
| **Code state** | Git branches | Canonical source of truth |
| **Handoff notes** | Mattermost threads | Searchable, timestamped, threaded |
| **Persistent docs** | Notion | Rich formatting, links, searchable |
| **Who's working** | Calendar | Visual schedule, integrates with apps |
| **Artifacts** | File storage | Screenshots, logs, exports |
| **Search history** | Mattermost search | "What did Alice say about harness?" |

**Neo4j adds:**
- Graph relationships between conversations
- "Who talked about X?"
- Cross-reference context

**But for 2-5 people, you don't need this.** Mattermost search + Notion search is sufficient.

---

## When to Add Egregore/Neo4j

**Add it when:**
- Team grows past 10 people
- Context gets lost in Mattermost threads
- Need "who knows about X?" queries
- Cross-timezone async gets chaotic

**For now (2-5 people):**
- Mattermost threads + Notion + Git = sufficient
- Agent parses handoffs, updates Notion
- Everyone reads Notion before starting shift
- Clean, simple, works

---

## Example Agent Use Cases

### 1. Auto-Update Notion on Commit

```typescript
// Git hook or GitHub Action
on('push', async (commit) => {
  const status = await readNotionPage(CURRENT_STATUS_PAGE);

  await appendNotionPage({
    page_id: CURRENT_STATUS_PAGE,
    content: `- ${commit.timestamp}: ${commit.author} - ${commit.message}`,
  });
});
```

### 2. Daily Standup Summary

```typescript
// Cron: Every day at 9am
async function dailyStandup() {
  const yesterday = await mattermostClient.search({
    channel: '#handoffs',
    after: '24 hours ago',
  });

  const summary = summarizeHandoffs(yesterday);

  await createNotionPage({
    parent_id: STANDUP_DB,
    title: `Standup - ${today}`,
    content: summary,
  });

  await mattermostClient.post({
    channel: '#standup',
    message: `📊 **Daily Summary**\\n${summary}\\n[Full notes in Notion](${notionLink})`,
  });
}
```

### 3. Branch Health Check

```typescript
// Cron: Every hour
async function checkBranches() {
  const branches = await git.listBranches();

  for (const branch of branches) {
    const lastCommit = await git.log(branch, { maxCount: 1 });
    const age = Date.now() - lastCommit.timestamp;

    if (age > 7 * 24 * 60 * 60 * 1000) {  // 7 days old
      await mattermostClient.post({
        channel: '#alerts',
        message: `⚠️ Branch \`${branch}\` hasn't been updated in 7 days. Owner: @${lastCommit.author}`,
      });
    }
  }
}
```

---

## Meeting with Egregore CEO

**Ask:**
1. Can we integrate via API? (Add as tool if yes)
2. Is there an open-source version or plan to open source?
3. What's their pricing for small teams?
4. Can we self-host?

**If not available:**
- Build simple handoff system (above)
- Revisit when team grows
- Consider Neo4j only if search becomes painful

---

## Implementation Checklist

- [ ] Create handoff-bot agent
- [ ] Add Mattermost webhook for @handoff-bot mentions
- [ ] Create Notion "Current Status" template
- [ ] Set up git worktree structure
- [ ] Document handoff workflow in README
- [ ] Add cron jobs for daily standup
- [ ] Create calendar events for shifts

**Estimated time:** 4-6 hours (vs weeks for Neo4j integration)

---

## Philosophy

**Keep it simple until it breaks.**

- 2-5 people: Mattermost + Notion + Git
- 5-10 people: Add better search/indexing
- 10+ people: Consider graph database

Right now, you're pre-optimizing. Build the simple thing, ship it, iterate when real problems emerge.

**Your actual constraint:** Getting friends dependent on it ASAP.

**Solution:** Ship working handoff system this week, not perfect context graph in 3 months.
