# Swarm Agent Tool Filtering

## Overview
Swarm agents have filtered tool access to prevent conflicts with coordinator communication.

## Filtering Rules

### Always Blocked
- `post_mattermost_message_with_attachment` - Coordinator posts responses
- `add_mattermost_reaction` - Coordinator handles reactions

### Mode-Specific
**Parallel Mode:**
- ✅ Research tools (category: 'research') - for research and analysis tasks
- ✅ Inter-agent messaging (`send_message_to_agent`) - for coordination
- ✅ All other non-blocked tools (including additional tools if configured)

**Conversation Mode:**
- ✅ Research tools (category: 'research') and other configured tools
- ❌ Inter-agent messaging (coordinator manages transcript)
- ✅ All other non-blocked tools (including additional tools if configured)

## Access Control Layers
1. **Environment Variables**: Tools without API keys filtered
2. **Access Tiers**: Admin-only tools filtered for non-admins
3. **Swarm Filter**: Communication tools filtered (this layer)

## Future Enhancements: Swarm-Map GUI
The Swarm-Map admin interface will allow GUI-based management of:
- Per-tool swarm accessibility toggles
- Category-based filtering policies
- Separate rules for parallel vs conversation modes
- Visual tool registry with swarm flags
- Usage metrics and rate limiting per swarm

This will eliminate the need to edit code/env vars for tool filtering.

## Implementation Details
See `getToolsForSwarmAgent()` in `/shared/tools/src/index.ts`
