/**
 * Tool Permission System
 *
 * Inspired by cantrip-integrations-signal's logging dashboard controls:
 * - Admins can use sensitive tools for any room
 * - Non-admins can only use sensitive tools for their current room
 * - Prevents privacy violations (e.g., viewing logs of rooms you're not in)
 */

import { Tool } from './base';

export interface ToolPermissionContext {
  userId: string;
  isAdmin: boolean;
  contextRoom: string; // The room where the request came from
  targetRoom?: string; // The room the tool will operate on (if applicable)
  isContextRoomDM?: boolean; // Whether the current room is a DM (2 members)
  targetRoomIsPublic?: boolean; // Whether the target room is public (O type in Mattermost)
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string; // Why it was denied (for user feedback)
}

/**
 * Check if a user has permission to use a tool
 */
export function checkToolPermission(
  tool: Tool,
  context: ToolPermissionContext
): PermissionCheckResult {
  // No permissions specified = tool is public
  if (!tool.permissions) {
    return { allowed: true };
  }

  const { requiresAdmin, requiresContextRoom, sensitiveReason } = tool.permissions;

  // Admin-only tools
  if (requiresAdmin && !context.isAdmin) {
    return {
      allowed: false,
      reason: sensitiveReason
        ? `🔒 This tool is admin-only: ${sensitiveReason}`
        : `🔒 Only admins can use the "${tool.name}" tool`,
    };
  }

  // Context room restriction (sensitive tools)
  if (requiresContextRoom) {
    // If tool has a targetRoom parameter, check if it matches context
    if (context.targetRoom && context.targetRoom !== context.contextRoom) {
      // User trying to access a different room

      if (context.isAdmin && context.isContextRoomDM) {
        // Admin in a DM can analyze any room
        return { allowed: true };
      }

      // Non-admin: Allow if target room is PUBLIC
      if (!context.isAdmin && context.targetRoomIsPublic) {
        return { allowed: true };
      }

      // Regular user accessing private room OR admin in a shared room - deny
      const reason = context.isAdmin
        ? `🔒 For security, admins can only analyze other rooms from a DM (to prevent leaking content into shared rooms).\n\nYou're currently in a shared room. Please use this tool from a DM to analyze other rooms.`
        : context.targetRoomIsPublic === false
        ? `🔒 You can only analyze private channels you're currently in.\n\nPublic channels can be analyzed from anywhere. Admins can analyze any channel from DMs.`
        : `🔒 You can only analyze channels you're currently in, or any public channel in the workspace.\n\nAdmins can analyze any channel from DMs.`;

      return {
        allowed: false,
        reason: sensitiveReason ? `${sensitiveReason}\n\n${reason}` : reason,
      };
    }
  }

  return { allowed: true };
}

/**
 * Filter tools based on user permissions
 * Returns only tools the user is allowed to use
 */
export function filterToolsByPermission(
  tools: Tool[],
  context: ToolPermissionContext
): Tool[] {
  return tools.filter(tool => {
    const check = checkToolPermission(tool, context);
    return check.allowed;
  });
}

/**
 * Get permission info for a tool (for help/documentation)
 */
export function getToolPermissionInfo(tool: Tool): string {
  if (!tool.permissions) {
    return 'Available to all users';
  }

  const parts: string[] = [];

  if (tool.permissions.requiresAdmin) {
    parts.push('🔒 Admin only');
  }

  if (tool.permissions.requiresContextRoom) {
    parts.push('🔒 Context room only (admins: any room in DMs)');
  }

  if (tool.permissions.sensitiveReason) {
    parts.push(`Reason: ${tool.permissions.sensitiveReason}`);
  }

  return parts.join(' | ');
}

/**
 * Extract target room from tool parameters (if applicable)
 * Used to check if the tool is trying to access a different room
 */
export function extractTargetRoom(toolInput: any): string | undefined {
  // Common parameter names for room identifiers
  const roomParams = ['room_id', 'roomId', 'room', 'channel_id', 'channelId', 'channel'];

  for (const param of roomParams) {
    if (toolInput[param]) {
      return toolInput[param];
    }
  }

  return undefined;
}
