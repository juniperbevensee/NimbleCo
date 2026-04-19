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
/**
 * Get the bot ID for storage isolation
 */
export declare function getBotId(): string;
/**
 * Get the bot's root storage directory: storage/{BOT_ID}/
 */
export declare function getBotStorageRoot(): string;
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
export declare function getWorkspaceRoot(): string;
/**
 * Get the file storage root directory for the current bot
 *
 * Priority:
 * 1. FILE_STORAGE_PATH env variable (explicit config)
 * 2. Bot-specific storage: storage/{BOT_ID}/files/
 *
 * This ensures each bot has isolated persistent file storage.
 */
export declare function getFileStorageRoot(): string;
/**
 * Get the memory file path for the current bot: storage/{BOT_ID}/memory.md
 */
export declare function getMemoryFilePath(): string;
/**
 * Get the identity file path for the current bot: storage/{BOT_ID}/identity.md
 */
export declare function getIdentityFilePath(): string;
//# sourceMappingURL=workspace-helper.d.ts.map