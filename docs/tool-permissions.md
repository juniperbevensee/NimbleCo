# Tool Permission System

Fine-grained access control for sensitive tools, inspired by cantrip-integrations-signal's logging dashboard pattern.

## Overview

The tool permission system allows you to protect sensitive tools (logs, analytics, monitoring) from unauthorized access while maintaining a flexible experience for admins.

**Key Principle**:
- **Admins** can use any tool for any room (especially in DMs)
- **Non-admins** can only use sensitive tools for the current room they're in
- **Public tools** are available to everyone

## Permission Model

### Tool Permission Fields

Tools can specify permissions in their definition:

```typescript
const myTool: Tool = {
  name: 'view-room-logs',
  description: 'View chat logs for a specific room',
  category: 'monitoring',
  permissions: {
    requiresAdmin: false,           // If true, ONLY admins can use this tool
    requiresContextRoom: true,      // Non-admins limited to current room
    sensitiveReason: 'Privacy: Prevents viewing logs of rooms you are not in'
  },
  // ... rest of tool definition
}
```

### Permission Types

#### 1. Public Tools (Default)
No `permissions` field = tool is available to everyone for any room.

**Example**: Creating calendar events, searching documentation

```typescript
const publicTool: Tool = {
  name: 'create-calendar-event',
  // No permissions field = public
}
```

#### 2. Admin-Only Tools
Only users in `MATTERMOST_ADMIN_USERS` can use these tools.

**Example**: System configuration, user management

```typescript
const adminTool: Tool = {
  name: 'configure-system',
  permissions: {
    requiresAdmin: true,
    sensitiveReason: 'System administration requires elevated privileges'
  }
}
```

#### 3. Context-Restricted Tools
Everyone can use, but non-admins are limited to their current room.

**Example**: Viewing logs, analytics, monitoring

```typescript
const restrictedTool: Tool = {
  name: 'view-room-activity',
  permissions: {
    requiresContextRoom: true,
    sensitiveReason: 'Privacy: Non-admins can only view activity for the current room'
  },
  parameters: {
    type: 'object',
    properties: {
      room_id: { type: 'string', description: 'Room to analyze' }
    }
  }
}
```

**Behavior**:
- User in Room A asks: "Show me activity for Room A" ✅ Allowed (current room)
- User in Room A asks: "Show me activity for PUBLIC Room B" ✅ Allowed (public channel)
- User in Room A asks: "Show me activity for PRIVATE Room B" ❌ Denied (not in that room)
- Admin in DM asks: "Show me activity for Room B" ✅ Allowed (admin bypass)
- Admin in Room A asks: "Show me activity for Room B" ❌ Denied (security: prevents leaking into shared rooms)

## How It Works

### 1. Permission Context

When a tool is executed, the system builds a permission context:

```typescript
{
  userId: '@user:localhost',         // Who is requesting
  isAdmin: true,                     // Are they an admin?
  contextRoom: '!abc:localhost',     // Which room are they in?
  targetRoom: '!xyz:localhost',      // Which room does the tool target?
  targetRoomIsPublic: true           // Is target room public? (fetched from DB)
}
```

### 2. Channel Visibility Tracking

The system tracks channel types in the database:
- **Public channels ('O')**: Anyone can analyze logs
- **Private channels ('P')**: Only members (or admins from DMs) can analyze
- **Direct messages ('D')**: Only participants (or admins from DMs)
- **Group messages ('G')**: Only participants (or admins from DMs)

Channel types are fetched from Mattermost API and stored in `conversations.channel_type`.

### 3. Permission Check

Before executing the tool:

```typescript
const permissionCheck = checkToolPermission(tool, context);

if (!permissionCheck.allowed) {
  return {
    success: false,
    error: permissionCheck.reason // User-friendly explanation
  };
}
```

### 4. User Feedback

When denied, users see clear explanations:

```
🔒 You can only analyze private channels you're currently in.

Public channels can be analyzed from anywhere.
Admins can analyze any channel from DMs.
```

## Configuration

### Setting Admin Users

In `.env`:
```bash
# Comma-separated list of admin user IDs
MATTERMOST_ADMIN_USERS=@you:localhost,@friend:localhost
```

Or during setup:
```bash
./setup.sh
# ... follow prompts ...
# When asked "Configure admin users?"
# Enter: @you:localhost,@friend:localhost
```

### Session Persistence

Admin configuration is saved in `.setup-last-session`:
```bash
./setup.sh
# First time: Configure admin users
# Next time: "Keep everything the same as last session?" → Yes
# Admin config automatically restored
```

### Access Tiers (Tools & LLM Models)

Control which tools and LLM models are available to admin vs non-admin users.

```bash
# Tools restricted to admin users only (comma-separated tool names)
ADMIN_ONLY_TOOLS=update_attio_person,create_notion_page,create_github_issue

# Entire categories restricted to admins (comma-separated)
ADMIN_ONLY_CATEGORIES=crm,code

# LLM model for admin users (more powerful/expensive)
ADMIN_LLM_MODEL=claude-opus-4-5-20251101

# LLM model for non-admin users (cost-effective)
USER_LLM_MODEL=claude-sonnet-4-5-20250929

# LLM providers admins can use (comma-separated)
ADMIN_LLM_PROVIDERS=bedrock,anthropic

# LLM providers non-admins can use
USER_LLM_PROVIDERS=ollama,vertex
```

**Default admin-only tools** (if `ADMIN_ONLY_TOOLS` not set):
- CRM tools: `update_attio_person`, `add_attio_note`, `link_attio_person_company`
- Docs tools: `create_notion_page`, `update_notion_page`, `search_notion`
- Code tools: `create_github_issue`, `create_pull_request`, `merge_pull_request`, `github_search`

To allow all users access to these tools, set `ADMIN_ONLY_TOOLS=` (empty).

## Creating Sensitive Tools

### Example: Room Log Viewer

```typescript
import { Tool } from '@nimbleco/tools';

export const roomLogTool: Tool = {
  name: 'view-room-logs',
  description: 'View chat history for a specific room',
  use_cases: ['Review conversation history', 'Search past messages'],
  category: 'monitoring',

  // Permission controls
  permissions: {
    requiresContextRoom: true, // Key line: restricts non-admins
    sensitiveReason: 'Privacy: Prevents viewing logs of rooms you are not in'
  },

  parameters: {
    type: 'object',
    properties: {
      room_id: {
        type: 'string',
        description: 'Mattermost channel ID'
      },
      limit: {
        type: 'number',
        description: 'Number of messages to retrieve',
        default: 50
      }
    },
    required: ['room_id']
  },

  handler: async (input, context) => {
    // Note: Permission checks happen BEFORE handler is called
    // If you're in the handler, permission was granted

    const logs = await fetchRoomLogs(input.room_id, input.limit);
    return {
      success: true,
      logs
    };
  }
};
```

### Example: Analytics Dashboard

```typescript
export const analyticsTool: Tool = {
  name: 'room-analytics',
  description: 'View analytics for a room',
  category: 'monitoring',

  permissions: {
    requiresContextRoom: true,
    sensitiveReason: 'Privacy: Non-admins can only view analytics for their current room'
  },

  parameters: {
    type: 'object',
    properties: {
      room_id: { type: 'string' },
      timeframe: {
        type: 'string',
        enum: ['day', 'week', 'month']
      }
    }
  },

  handler: async (input, context) => {
    const stats = await calculateRoomStats(input.room_id, input.timeframe);
    return { success: true, stats };
  }
};
```

## Testing Permissions

### Test as Non-Admin

1. Configure bot without your user in `MATTERMOST_ADMIN_USERS`
2. Create two rooms: Room A and Room B
3. Invite bot to both rooms
4. In Room A, ask: "Show me logs for Room A" → ✅ Should work
5. In Room A, ask: "Show me logs for Room B" → ❌ Should be denied

### Test as Admin

1. Add your user to `MATTERMOST_ADMIN_USERS`
2. Restart coordinator: `pm2 restart coordinator`
3. Open DM with bot
4. Ask: "Show me logs for Room B" → ✅ Should work (admin bypass)
5. In Room A, ask: "Show me logs for Room B" → ✅ Should work (admin bypass)

### Verify Permission Messages

When denied, check the error message includes:
- 🔒 lock emoji
- Reason (from `sensitiveReason`)
- Explanation: "Non-admins can only use this tool for the current room"
- Tip: "Admins can analyze any room in DMs"

## Real-World Use Case: Logging Dashboard

Inspired by cantrip-integrations-signal's pattern:

**Scenario**: You have a bot that can view conversation logs (for debugging, archival, etc.)

**Problem**: You don't want users snooping on rooms they're not in

**Solution**: Context-restricted permissions
- User in #engineering can view #engineering logs
- User in #engineering CANNOT view #sales logs
- Admin in DMs can view any room's logs (for moderation, debugging)

**Implementation**:
```typescript
export const loggingTools: Tool[] = [
  {
    name: 'view-logs',
    permissions: {
      requiresContextRoom: true,
      sensitiveReason: 'Privacy: Prevents viewing logs of other rooms'
    }
  },
  {
    name: 'search-logs',
    permissions: {
      requiresContextRoom: true,
      sensitiveReason: 'Privacy: Prevents searching logs of other rooms'
    }
  },
  {
    name: 'export-logs',
    permissions: {
      requiresAdmin: true, // Extra strict: only admins can export
      sensitiveReason: 'Data export requires admin approval'
    }
  }
];
```

## Architecture

### Flow Diagram

```
User sends message in Channel A
   ↓
Mattermost Listener extracts:
  - userId: user_id_abc123
  - contextRoom: channel_id_xyz789
  - isAdmin: false (checks MATTERMOST_ADMIN_USERS)
   ↓
Task dispatched to Coordinator with payload:
  {
    mattermost_user: 'user_id_abc123',
    is_admin: false,
    context_room: 'channel_id_xyz789',
    description: 'Show me logs for Channel B'
  }
   ↓
LLM decides to use tool:
  { tool: 'view-logs', input: { room_id: 'channel_id_def456' } }
   ↓
executeToolCall() checks permissions:
  - Tool has requiresContextRoom: true
  - User is not admin
  - targetRoom (Channel B) != contextRoom (Channel A)
  - Result: DENIED
   ↓
User receives error:
  "🔒 Privacy: Non-admins can only view logs for the current channel."
```

### Key Files

- `shared/tools/src/base.ts` - Tool interface with `permissions` field
- `shared/tools/src/permissions.ts` - Permission checking logic
- `shared/tools/src/index.ts` - Integration in `executeToolCall()`
- `coordinator/src/mattermost-listener.ts` - Admin detection and context tracking
- `coordinator/src/main.ts` - Passes payload to tool execution

## Best Practices

### 1. Default to Public
Most tools should be public. Only restrict when necessary:
- ❌ Don't restrict: Calendar creation, documentation search
- ✅ Do restrict: Logs, analytics, user data

### 2. Use Clear Reasons
Always provide `sensitiveReason` explaining WHY it's restricted:
```typescript
sensitiveReason: 'Privacy: Prevents viewing logs of rooms you are not in'
```

### 3. Admin Bypass Pattern
Use `requiresContextRoom` (not `requiresAdmin`) for most sensitive tools.
This allows:
- Non-admins: Limited to current room (privacy)
- Admins: Full access in DMs (moderation, debugging)

### 4. Avoid Over-Restriction
Don't make everything admin-only. Use context restrictions instead:
- ❌ Bad: `requiresAdmin: true` (too restrictive)
- ✅ Good: `requiresContextRoom: true` (balanced)

### 5. Test Both Modes
Always test as both admin and non-admin to ensure:
- Non-admins can still do their work in their rooms
- Admins have full access for moderation
- Error messages are clear

## Troubleshooting

### Permission Always Denied

Check:
1. Is `MATTERMOST_ADMIN_USERS` set in `.env`?
2. Is your user ID correct? (Format: `@username:homeserver`)
3. Did you restart coordinator after changing env vars?

```bash
# Verify in .env
cat .env | grep MATTERMOST_ADMIN_USERS

# Should be: MATTERMOST_ADMIN_USERS=@you:localhost

# Restart
pm2 restart coordinator
```

### Permission Always Allowed

Check:
1. Does the tool have `permissions` field?
2. Is `requiresContextRoom: true` set?
3. Is the tool correctly extracting target room?

```typescript
// Debug: Log permission context
console.log('Permission context:', {
  userId: context.userId,
  isAdmin: context.isAdmin,
  contextRoom: context.contextRoom,
  targetRoom: context.targetRoom
});
```

### Can't Extract Target Room

The system looks for these parameters in tool input:
- `room_id`
- `roomId`
- `room`
- `channel_id`
- `channelId`
- `channel`

If your tool uses a different parameter name, add it to `extractTargetRoom()` in `shared/tools/src/permissions.ts`:

```typescript
export function extractTargetRoom(toolInput: any): string | undefined {
  const roomParams = [
    'room_id', 'roomId', 'room',
    'channel_id', 'channelId', 'channel',
    'space_id', // Add your custom parameter
  ];
  // ...
}
```

## See Also

- [Tool Development Guide](../shared/tools/README.md) - Creating new tools
- [Security Best Practices](./security.md) - General security guidelines
