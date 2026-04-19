"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBotId = getBotId;
exports.getBotStorageRoot = getBotStorageRoot;
exports.getWorkspaceRoot = getWorkspaceRoot;
exports.getFileStorageRoot = getFileStorageRoot;
exports.getMemoryFilePath = getMemoryFilePath;
exports.getIdentityFilePath = getIdentityFilePath;
const path = __importStar(require("path"));
/**
 * Get the bot ID for storage isolation
 */
function getBotId() {
    return process.env.BOT_ID || 'default';
}
/**
 * Get the bot's root storage directory: storage/{BOT_ID}/
 */
function getBotStorageRoot() {
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
function getWorkspaceRoot() {
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
function getFileStorageRoot() {
    const storageEnv = process.env.FILE_STORAGE_PATH;
    if (storageEnv) {
        return path.resolve(process.cwd(), storageEnv);
    }
    return path.join(getBotStorageRoot(), 'files');
}
/**
 * Get the memory file path for the current bot: storage/{BOT_ID}/memory.md
 */
function getMemoryFilePath() {
    return path.join(getBotStorageRoot(), 'memory.md');
}
/**
 * Get the identity file path for the current bot: storage/{BOT_ID}/identity.md
 */
function getIdentityFilePath() {
    return path.join(getBotStorageRoot(), 'identity.md');
}
//# sourceMappingURL=workspace-helper.js.map