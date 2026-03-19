/**
 * Storage path helpers
 * Centralized logic for determining storage paths with bot isolation
 */

import * as path from 'path';

/**
 * Get the workspace root directory for the current bot
 *
 * Priority:
 * 1. WORKSPACE_ROOT env variable (preferred, set by setup script)
 * 2. WORKSPACE_PATH env variable (legacy support)
 * 3. Bot-specific workspace: storage/workspace-<BOT_ID>
 * 4. Default workspace: storage/workspace
 *
 * This ensures each bot has isolated ephemeral storage by default.
 */
export function getWorkspaceRoot(): string {
  // Support both WORKSPACE_ROOT (preferred) and WORKSPACE_PATH (legacy)
  const workspaceEnv = process.env.WORKSPACE_ROOT || process.env.WORKSPACE_PATH;

  if (workspaceEnv) {
    return path.resolve(process.cwd(), workspaceEnv);
  }

  // Default: use bot-specific workspace if BOT_ID is set
  const botId = process.env.BOT_ID;
  if (botId) {
    return path.resolve(process.cwd(), `storage/workspace-${botId}`);
  }

  // Fallback for single-bot setups
  return path.resolve(process.cwd(), 'storage/workspace');
}

/**
 * Get the file storage root directory for the current bot
 *
 * Priority:
 * 1. FILE_STORAGE_PATH env variable (explicit config)
 * 2. Bot-specific storage: storage/files-<BOT_ID>
 * 3. Default storage: storage/files
 *
 * This ensures each bot has isolated persistent file storage by default.
 */
export function getFileStorageRoot(): string {
  const storageEnv = process.env.FILE_STORAGE_PATH;

  if (storageEnv) {
    return path.resolve(process.cwd(), storageEnv);
  }

  // Default: use bot-specific storage if BOT_ID is set
  const botId = process.env.BOT_ID;
  if (botId) {
    return path.resolve(process.cwd(), `storage/files-${botId}`);
  }

  // Fallback for single-bot setups
  return path.resolve(process.cwd(), 'storage/files');
}
