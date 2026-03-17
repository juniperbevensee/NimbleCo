/**
 * File storage tools for S3-compatible storage (MinIO, AWS S3, etc.)
 *
 * Provides persistent file storage for documents, reports, and exports.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, ToolContext } from '../base';

// Local fallback storage when S3 is not configured
const LOCAL_STORAGE_ROOT = process.env.FILE_STORAGE_PATH || path.resolve(process.cwd(), 'storage/files');

/**
 * Upload a file to storage
 */
export const uploadFile: Tool = {
  name: 'upload_file',
  description: 'Upload a file to persistent storage. Returns a URL or path to access the file.',
  category: 'storage',
  use_cases: [
    'Store generated reports',
    'Save exported data',
    'Archive files for later access',
  ],
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Name for the stored file',
      },
      content: {
        type: 'string',
        description: 'File content (text or base64 for binary)',
      },
      content_type: {
        type: 'string',
        description: 'MIME type (e.g., text/plain, application/json)',
      },
      folder: {
        type: 'string',
        description: 'Optional folder/prefix for organization',
      },
    },
    required: ['filename', 'content'],
  },
  async handler(input: { filename: string; content: string; content_type?: string; folder?: string }, ctx: ToolContext) {
    const { filename, content, content_type, folder } = input;

    // Use local storage as fallback
    const targetDir = folder
      ? path.join(LOCAL_STORAGE_ROOT, folder)
      : LOCAL_STORAGE_ROOT;

    await fs.mkdir(targetDir, { recursive: true });

    const filepath = path.join(targetDir, filename);

    // Security: ensure path is within storage root
    const resolvedPath = path.resolve(filepath);
    if (!resolvedPath.startsWith(path.resolve(LOCAL_STORAGE_ROOT))) {
      return {
        success: false,
        error: 'Access denied: path must be within storage root',
      };
    }

    try {
      await fs.writeFile(resolvedPath, content, 'utf-8');

      return {
        success: true,
        path: resolvedPath,
        filename,
        size: content.length,
        message: `File saved to ${resolvedPath}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to upload file: ${error.message}`,
      };
    }
  },
};

/**
 * Download/read a file from storage
 */
export const downloadFile: Tool = {
  name: 'download_file',
  description: 'Download or read a file from persistent storage.',
  category: 'storage',
  use_cases: [
    'Retrieve stored reports',
    'Access archived files',
    'Read previously saved data',
  ],
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file',
      },
    },
    required: ['path'],
  },
  async handler(input: { path: string }, ctx: ToolContext) {
    const filepath = path.isAbsolute(input.path)
      ? input.path
      : path.join(LOCAL_STORAGE_ROOT, input.path);

    // Security check
    const resolvedPath = path.resolve(filepath);
    if (!resolvedPath.startsWith(path.resolve(LOCAL_STORAGE_ROOT))) {
      return {
        success: false,
        error: 'Access denied: path must be within storage root',
      };
    }

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const stats = await fs.stat(resolvedPath);

      return {
        success: true,
        path: resolvedPath,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        content,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to download file: ${error.message}`,
      };
    }
  },
};

/**
 * List files in storage
 */
export const listFiles: Tool = {
  name: 'list_files',
  description: 'List files in persistent storage.',
  category: 'storage',
  use_cases: [
    'Browse stored files',
    'Find archived data',
    'Check available exports',
  ],
  parameters: {
    type: 'object',
    properties: {
      folder: {
        type: 'string',
        description: 'Optional folder to list',
      },
    },
  },
  async handler(input: { folder?: string }, ctx: ToolContext) {
    const targetDir = input.folder
      ? path.join(LOCAL_STORAGE_ROOT, input.folder)
      : LOCAL_STORAGE_ROOT;

    // Security check
    const resolvedDir = path.resolve(targetDir);
    if (!resolvedDir.startsWith(path.resolve(LOCAL_STORAGE_ROOT))) {
      return {
        success: false,
        error: 'Access denied: path must be within storage root',
      };
    }

    try {
      await fs.mkdir(LOCAL_STORAGE_ROOT, { recursive: true });
      const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

      const files = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(resolvedDir, entry.name);
          const stats = await fs.stat(fullPath);
          return {
            name: entry.name,
            type: entry.isDirectory() ? 'folder' : 'file',
            size: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
      );

      return {
        success: true,
        folder: resolvedDir,
        files,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          success: true,
          folder: resolvedDir,
          files: [],
          message: 'Directory is empty or does not exist',
        };
      }
      return {
        success: false,
        error: `Failed to list files: ${error.message}`,
      };
    }
  },
};

export const fileStorageTools: Tool[] = [uploadFile, downloadFile, listFiles];
