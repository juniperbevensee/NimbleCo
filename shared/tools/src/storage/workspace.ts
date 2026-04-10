/**
 * Workspace storage tools for handling large results and temporary files
 *
 * Provides ephemeral storage for tool results that are too large to return inline.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, ToolContext } from '../base';
import { getWorkspaceRoot, getFileStorageRoot } from '../workspace-helper';

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
  description: 'Read a file from the agent workspace. For images/binary files, use format="base64". ⚠️ IMPORTANT: For large JSON/text files (>100KB), this tool returns ONLY structure/sample. DO NOT try to read full files - instead use execute_javascript to process them locally. For data analysis (counting, filtering, aggregating), ALWAYS use execute_javascript with fs.readFileSync() to avoid token waste.',
  category: 'storage',
  use_cases: [
    'Read chart PNG files as base64 for attachment (format="base64")',
    'Read image files for sharing (format="base64")',
    'Get file structure and metadata for large datasets',
    'Read small configuration or result files',
    'Preview first few records of large files',
    'Check what files exist in workspace',
    '⚠️ DO NOT USE for data analysis - use execute_javascript instead',
    '⚠️ DO NOT USE to read full large files - use execute_javascript with fs.readFileSync()',
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
        enum: ['text', 'json', 'base64'],
        description: 'How to parse the file contents. Use base64 for binary files (images, etc.)',
      },
      limit: {
        type: 'number',
        description: 'For JSON arrays, limit number of items returned. Max: 50 items. For larger datasets, use execute_javascript instead.',
      },
      offset: {
        type: 'number',
        description: 'For JSON arrays, skip this many items. For processing full datasets, use execute_javascript with fs.readFileSync().',
      },
    },
    required: ['file_path'],
  },
  async handler(input: { file_path: string; format?: string; limit?: number; offset?: number }, ctx: ToolContext) {
    const { file_path, format = 'json', offset = 0 } = input;

    // Hard cap on limit to prevent token waste
    const MAX_LIMIT = 50;
    const limit = input.limit ? Math.min(input.limit, MAX_LIMIT) : undefined;

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
      // For base64 format, read as buffer instead of UTF-8
      if (format === 'base64') {
        const buffer = await fs.readFile(resolvedPath);
        const base64Content = buffer.toString('base64');
        const fileSizeKB = Math.round(buffer.length / 1024);

        return {
          success: true,
          format: 'base64',
          size_kb: fileSizeKB,
          content: base64Content,
          file_path: resolvedPath,
        };
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');
      const fileSizeKB = Math.round(content.length / 1024);

      if (format === 'json') {
        let data = JSON.parse(content);

        // For very large files (>100KB), only return metadata + sample unless limit specified
        if (content.length > 100000) {
          // Check if it's an object with nested arrays (common pattern)
          let arrayInfo = null;
          let sampleData = null;

          if (typeof data === 'object' && !Array.isArray(data)) {
            // Find arrays in the top-level object
            const arrays = Object.entries(data)
              .filter(([_, value]) => Array.isArray(value))
              .map(([key, value]: [string, any]) => ({ key, length: value.length }));

            if (arrays.length > 0) {
              const mainArray = arrays.reduce((max, curr) =>
                curr.length > max.length ? curr : max
              );
              arrayInfo = {
                mainArrayKey: mainArray.key,
                arrayLength: mainArray.length,
                otherFields: Object.keys(data).filter(k => !Array.isArray(data[k])),
              };

              // Provide sample of first few items
              if (limit) {
                const cappedLimit = Math.min(limit, MAX_LIMIT);
                data[mainArray.key] = data[mainArray.key].slice(offset, offset + cappedLimit);
                sampleData = data;
              } else {
                // Default: return structure + first 5 items as sample
                const originalArray = data[mainArray.key];
                data[mainArray.key] = originalArray.slice(0, 5);
                sampleData = data;
              }
            }
          }

          // For direct arrays
          if (Array.isArray(data)) {
            const total = data.length;
            if (limit || !limit) {
              // Always apply default limit for large arrays
              const actualLimit = limit || 10;
              data = data.slice(offset, offset + actualLimit);
              return {
                success: true,
                file_path: resolvedPath,
                large_file: true,
                file_size_bytes: content.length,
                file_size_kb: fileSizeKB,
                total_records: total,
                returned_records: data.length,
                offset,
                warning: `⚠️ LARGE FILE (${fileSizeKB}KB, ${total} records). Returning only ${data.length} items to avoid token waste.`,
                recommendation: `To process this data, use execute_javascript with: const data = JSON.parse(fs.readFileSync('${resolvedPath}', 'utf-8'));`,
                data,
              };
            }
          }

          // For objects with arrays
          if (arrayInfo) {
            const returnedCount = limit || 5;
            return {
              success: true,
              file_path: resolvedPath,
              large_file: true,
              file_size_bytes: content.length,
              file_size_kb: fileSizeKB,
              structure: arrayInfo,
              warning: `⚠️ LARGE FILE (${fileSizeKB}KB, ${arrayInfo.arrayLength} records in ${arrayInfo.mainArrayKey}). Returning only ${returnedCount} items to avoid token waste.`,
              recommendation: `To process this data, use execute_javascript with: const data = JSON.parse(fs.readFileSync('${resolvedPath}', 'utf-8')); const items = data.${arrayInfo.mainArrayKey};`,
              message: limit
                ? `Returned ${returnedCount} items from ${arrayInfo.mainArrayKey} array (offset: ${offset})`
                : `Returning sample (first 5 items from ${arrayInfo.mainArrayKey}).`,
              data: sampleData,
            };
          }

          // Fallback for other large JSON
          return {
            success: false,
            error: `⚠️ File too large (${fileSizeKB}KB) to return. Use execute_javascript to process: const data = JSON.parse(fs.readFileSync('${resolvedPath}', 'utf-8'));`,
            file_size_bytes: content.length,
          };
        }

        // Handle pagination for arrays (small files)
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
    'List files in workspace',
    'Browse workspace directory',
    'Check your workspace',
    'See what data exists',
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
      // Ensure workspace root exists
      await fs.mkdir(getWorkspaceRoot(), { recursive: true });

      // Check if target directory exists
      try {
        await fs.access(resolvedDir);
      } catch (error) {
        // Directory doesn't exist - return empty list instead of error
        return {
          success: true,
          directory: resolvedDir,
          files: [],
          message: `Directory does not exist yet. It will be created when files are written.`,
        };
      }

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

    // Get bot-isolated storage root
    const LOCAL_STORAGE_ROOT = getFileStorageRoot();

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
