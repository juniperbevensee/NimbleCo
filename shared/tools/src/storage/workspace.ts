/**
 * Workspace storage tools for handling large results and temporary files
 *
 * Provides ephemeral storage for tool results that are too large to return inline.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, ToolContext } from '../base';

// Workspace root - configurable via environment
// Computed at runtime to ensure dotenv has loaded
function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_PATH || path.resolve(process.cwd(), 'storage/workspace');
}

interface LargeResultOptions {
  filenamePrefix?: string;
  threshold?: number;
}

/**
 * Handle large results by saving to workspace and returning a reference
 * Used by tools that may return large datasets (e.g., social media search)
 */
export async function handleLargeResult(
  data: any,
  options: LargeResultOptions = {}
): Promise<{ saved: boolean; path?: string; data?: any; success?: boolean }> {
  const { filenamePrefix = 'result', threshold = 50000 } = options;
  const serialized = JSON.stringify(data, null, 2);

  if (serialized.length < threshold) {
    return { saved: false, ...data, success: true };
  }

  // Save to workspace
  const filename = `${filenamePrefix}-${Date.now()}.json`;
  const filepath = path.join(getWorkspaceRoot(), filename);

  await fs.mkdir(getWorkspaceRoot(), { recursive: true });
  await fs.writeFile(filepath, serialized, 'utf-8');

  return {
    saved: true,
    path: filepath,
    data: {
      message: `⚠️ Result saved to EPHEMERAL workspace (${(serialized.length / 1024).toFixed(1)}KB). This will be lost on restart! Use move_workspace_file_to_storage to make it permanent, or post_mattermost_message_with_attachment to share it.`,
      file: filename,
      full_path: filepath,
      record_count: Array.isArray(data) ? data.length : undefined,
    }
  };
}

/**
 * Read a file from the workspace
 */
export const readWorkspaceFile: Tool = {
  name: 'read_workspace_file',
  description: 'Read a file from the agent workspace. Use this to retrieve results that were saved by other tools.',
  category: 'storage',
  use_cases: [
    'Read saved search results',
    'Access large datasets from previous tool calls',
    'Review exported data',
  ],
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file (relative to workspace or absolute)',
      },
      format: {
        type: 'string',
        enum: ['text', 'json'],
        description: 'How to parse the file contents',
      },
      limit: {
        type: 'number',
        description: 'For JSON arrays, limit number of items returned',
      },
      offset: {
        type: 'number',
        description: 'For JSON arrays, skip this many items',
      },
    },
    required: ['file_path'],
  },
  async handler(input: { file_path: string; format?: string; limit?: number; offset?: number }, ctx: ToolContext) {
    const { file_path, format = 'json', limit, offset = 0 } = input;

    // Resolve path (allow both relative and absolute)
    const fullPath = path.isAbsolute(file_path)
      ? file_path
      : path.join(getWorkspaceRoot(), file_path);

    // Security: ensure path is within workspace
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(path.resolve(getWorkspaceRoot()))) {
      return {
        success: false,
        error: 'Access denied: path must be within workspace',
      };
    }

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');

      if (format === 'json') {
        let data = JSON.parse(content);

        // Handle pagination for arrays
        if (Array.isArray(data) && (limit || offset)) {
          const total = data.length;
          data = data.slice(offset, limit ? offset + limit : undefined);
          return {
            success: true,
            file_path: resolvedPath,
            total_records: total,
            returned_records: data.length,
            offset,
            data,
          };
        }

        // Warn if result is very large
        if (content.length > 100000) {
          return {
            success: true,
            file_path: resolvedPath,
            warning: 'Large JSON file - consider using offset/limit or processing in chunks',
            data,
          };
        }

        return { success: true, file_path: resolvedPath, data };
      }

      return { success: true, file_path: resolvedPath, content };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read file: ${error.message}`,
      };
    }
  },
};

/**
 * List files in the workspace
 */
export const listWorkspace: Tool = {
  name: 'list_workspace',
  description: 'List files in the agent workspace directory.',
  category: 'storage',
  use_cases: [
    'See what files are available',
    'Find saved results',
    'Check workspace contents',
  ],
  parameters: {
    type: 'object',
    properties: {
      subdirectory: {
        type: 'string',
        description: 'Optional subdirectory to list',
      },
    },
  },
  async handler(input: { subdirectory?: string }, ctx: ToolContext) {
    const targetDir = input.subdirectory
      ? path.join(getWorkspaceRoot(), input.subdirectory)
      : getWorkspaceRoot();

    // Security check
    const resolvedDir = path.resolve(targetDir);
    if (!resolvedDir.startsWith(path.resolve(getWorkspaceRoot()))) {
      return {
        success: false,
        error: 'Access denied: path must be within workspace',
      };
    }

    try {
      await fs.mkdir(getWorkspaceRoot(), { recursive: true });
      const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

      const files = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(resolvedDir, entry.name);
          const stats = await fs.stat(fullPath);
          return {
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
      );

      return {
        success: true,
        directory: resolvedDir,
        files,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to list directory: ${error.message}`,
      };
    }
  },
};

/**
 * Move or copy a file from ephemeral workspace to persistent storage
 */
export const moveWorkspaceFileToStorage: Tool = {
  name: 'move_workspace_file_to_storage',
  description: 'Move or copy a file from ephemeral workspace (lost on restart) to persistent storage (kept forever). Use this when users want to keep large results permanently.',
  category: 'storage',
  use_cases: [
    'Save ephemeral results permanently',
    'Archive large datasets',
    'Preserve reports before restart',
  ],
  parameters: {
    type: 'object',
    properties: {
      workspace_file: {
        type: 'string',
        description: 'Filename or path in workspace (e.g., "result-1234.json")',
      },
      storage_folder: {
        type: 'string',
        description: 'Optional folder in persistent storage (e.g., "reports", "exports")',
      },
      new_filename: {
        type: 'string',
        description: 'Optional new filename (defaults to original name)',
      },
      operation: {
        type: 'string',
        enum: ['move', 'copy'],
        description: 'Move (delete original) or copy (keep original). Default: move',
      },
    },
    required: ['workspace_file'],
  },
  async handler(input: { workspace_file: string; storage_folder?: string; new_filename?: string; operation?: 'move' | 'copy' }, ctx: ToolContext) {
    const { workspace_file, storage_folder, new_filename, operation = 'move' } = input;

    // Import storage root from files.ts
    const LOCAL_STORAGE_ROOT = process.env.FILE_STORAGE_PATH || path.resolve(process.cwd(), 'storage/files');

    // Resolve source path in workspace
    const sourcePath = path.isAbsolute(workspace_file)
      ? workspace_file
      : path.join(getWorkspaceRoot(), workspace_file);

    // Security: ensure source is within workspace
    const resolvedSource = path.resolve(sourcePath);
    if (!resolvedSource.startsWith(path.resolve(getWorkspaceRoot()))) {
      return {
        success: false,
        error: 'Access denied: source file must be within workspace',
      };
    }

    // Check if source exists
    try {
      await fs.access(resolvedSource);
    } catch (error) {
      return {
        success: false,
        error: `Source file not found: ${workspace_file}`,
      };
    }

    // Determine destination
    const filename = new_filename || path.basename(resolvedSource);
    const targetDir = storage_folder
      ? path.join(LOCAL_STORAGE_ROOT, storage_folder)
      : LOCAL_STORAGE_ROOT;

    const destPath = path.join(targetDir, filename);

    // Security: ensure destination is within storage
    const resolvedDest = path.resolve(destPath);
    if (!resolvedDest.startsWith(path.resolve(LOCAL_STORAGE_ROOT))) {
      return {
        success: false,
        error: 'Access denied: destination must be within storage',
      };
    }

    try {
      // Create destination directory
      await fs.mkdir(path.dirname(resolvedDest), { recursive: true });

      // Copy or move
      await fs.copyFile(resolvedSource, resolvedDest);

      if (operation === 'move') {
        await fs.unlink(resolvedSource);
      }

      const stats = await fs.stat(resolvedDest);

      return {
        success: true,
        operation,
        source: resolvedSource,
        destination: resolvedDest,
        size: stats.size,
        message: `File ${operation === 'move' ? 'moved' : 'copied'} to persistent storage: ${resolvedDest}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to ${operation} file: ${error.message}`,
      };
    }
  },
};

export const workspaceTools: Tool[] = [readWorkspaceFile, listWorkspace, moveWorkspaceFileToStorage];
