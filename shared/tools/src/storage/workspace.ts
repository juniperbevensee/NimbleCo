/**
 * Workspace storage tools for handling large results and temporary files
 *
 * Provides ephemeral storage for tool results that are too large to return inline.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, ToolContext } from '../base';

// Workspace root - configurable via environment
const WORKSPACE_ROOT = process.env.WORKSPACE_PATH || path.resolve(process.cwd(), 'storage/workspace');

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
  const filepath = path.join(WORKSPACE_ROOT, filename);

  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  await fs.writeFile(filepath, serialized, 'utf-8');

  return {
    saved: true,
    path: filepath,
    data: {
      message: `Result saved to workspace (${(serialized.length / 1024).toFixed(1)}KB)`,
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
      : path.join(WORKSPACE_ROOT, file_path);

    // Security: ensure path is within workspace
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(path.resolve(WORKSPACE_ROOT))) {
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
      ? path.join(WORKSPACE_ROOT, input.subdirectory)
      : WORKSPACE_ROOT;

    // Security check
    const resolvedDir = path.resolve(targetDir);
    if (!resolvedDir.startsWith(path.resolve(WORKSPACE_ROOT))) {
      return {
        success: false,
        error: 'Access denied: path must be within workspace',
      };
    }

    try {
      await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
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

export const workspaceTools: Tool[] = [readWorkspaceFile, listWorkspace];
