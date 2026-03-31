/**
 * Storage path helpers
 * Centralized logic for determining storage paths with bot isolation
 *
 * All bot-specific storage is organized under: storage/{BOT_ID}/
 *   - storage/{BOT_ID}/workspace/   (ephemeral working files)
 *   - storage/{BOT_ID}/files/       (persistent file storage)
 *   - storage/{BOT_ID}/identity.md  (persona identity document)
 *   - storage/{BOT_ID}/memory.md    (persistent memory)
 */

import * as path from 'path';

/**
 * Get the bot ID for storage isolation
 */
export function getBotId(): string {
  return process.env.BOT_ID || 'default';
}

/**
 * Get the bot's root storage directory: storage/{BOT_ID}/
 */
export function getBotStorageRoot(): string {
  const botId = getBotId();
  return path.resolve(process.cwd(), `storage/${botId}`);
}

/**
 * Get the workspace root directory for the current bot
 *
 * Priority:
 * 1. WORKSPACE_ROOT env variable (preferred, set by setup script)
 * 2. WORKSPACE_PATH env variable (legacy support)
 * 3. Bot-specific workspace: storage/{BOT_ID}/workspace/
 *
 * This ensures each bot has isolated ephemeral storage.
 */
export function getWorkspaceRoot(): string {
  // Support both WORKSPACE_ROOT (preferred) and WORKSPACE_PATH (legacy)
  const workspaceEnv = process.env.WORKSPACE_ROOT || process.env.WORKSPACE_PATH;

  if (workspaceEnv) {
    return path.resolve(process.cwd(), workspaceEnv);
  }

  return path.join(getBotStorageRoot(), 'workspace');
}

/**
 * Get the file storage root directory for the current bot
 *
 * Priority:
 * 1. FILE_STORAGE_PATH env variable (explicit config)
 * 2. Bot-specific storage: storage/{BOT_ID}/files/
 *
 * This ensures each bot has isolated persistent file storage.
 */
export function getFileStorageRoot(): string {
  const storageEnv = process.env.FILE_STORAGE_PATH;

  if (storageEnv) {
    return path.resolve(process.cwd(), storageEnv);
  }

  return path.join(getBotStorageRoot(), 'files');
}

/**
 * Get the memory file path for the current bot: storage/{BOT_ID}/memory.md
 */
export function getMemoryFilePath(): string {
  return path.join(getBotStorageRoot(), 'memory.md');
}

/**
 * Get the identity file path for the current bot: storage/{BOT_ID}/identity.md
 */
export function getIdentityFilePath(): string {
  return path.join(getBotStorageRoot(), 'identity.md');
}
