// Filesystem Tools - Agent-accessible file operations with sandbox enforcement
// All operations are scoped to /workspace to prevent system access

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Tool, ToolContext } from '../base';
import { getDefaultSandbox, createAgentSandbox } from './sandbox';
import { logAudit, AuditOperations } from '../audit/logger';
import { checkRateLimit, rateLimitError, RateLimits } from '../rate-limit/limiter';

// Helper to create tools with proper typing
function createTool<T extends z.ZodType<any>>(config: {
  name: string;
  description: string;
  category: Tool['category'];
  use_cases: string[];
  inputSchema: T;
  handler: (input: z.infer<T>, context: ToolContext) => Promise<any>;
}): Tool {
  // Convert Zod schema to JSON schema
  const jsonSchema: any = zodToJsonSchema(config.inputSchema as any, {
    target: 'openApi3',
    $refStrategy: 'none',
  });

  return {
    name: config.name,
    description: config.description,
    category: config.category,
    use_cases: config.use_cases,
    parameters: {
      type: 'object',
      properties: jsonSchema.properties || {},
      required: jsonSchema.required || [],
    },
    handler: config.handler as any,
  };
}

// ============================================================================
// Read File
// ============================================================================

export const readFile = createTool({
  name: 'read_file',
  description: 'Read contents of a file in the workspace',
  category: 'filesystem',
  use_cases: [
    'Read a file',
    'View file contents',
    'Load data from file',
    'Read configuration',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to file relative to /workspace'),
    encoding: z.enum(['utf-8', 'base64', 'hex']).optional().describe('File encoding (default: utf-8)'),
  }),
  handler: async ({ path, encoding = 'utf-8' }, context) => {
    const sandbox = getDefaultSandbox();
    const content = await sandbox.readFile(path, encoding as BufferEncoding);

    return {
      success: true,
      path,
      content,
      size: content.length,
    };
  },
});

// ============================================================================
// Write File
// ============================================================================

export const writeFile = createTool({
  name: 'write_file',
  description: 'Write content to a file in the workspace (creates or overwrites)',
  category: 'filesystem',
  use_cases: [
    'Create a file',
    'Write data to file',
    'Save output',
    'Generate file',
    'Store results',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to file relative to /workspace'),
    content: z.string().describe('Content to write to file'),
    encoding: z.enum(['utf-8', 'base64', 'hex']).optional().describe('File encoding (default: utf-8)'),
  }),
  handler: async ({ path, content, encoding = 'utf-8' }, context) => {
    // Rate limiting (optional - only enforced if user_id is provided)
    if (context.user_id) {
      const limit = checkRateLimit(context.user_id, 'filesystem', RateLimits.FILESYSTEM);
      if (!limit.allowed) {
        return {
          success: false,
          error: rateLimitError(limit.remaining, limit.resetMs),
        };
      }
    }

    const sandbox = getDefaultSandbox();
    await sandbox.writeFile(path, content, encoding as BufferEncoding);

    return {
      success: true,
      path,
      size: content.length,
      message: `File written to ${path}`,
    };
  },
});

// ============================================================================
// Append to File
// ============================================================================

export const appendFile = createTool({
  name: 'append_file',
  description: 'Append content to a file in the workspace (creates if does not exist)',
  category: 'filesystem',
  use_cases: [
    'Add to log file',
    'Append data',
    'Update file',
    'Add entries',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to file relative to /workspace'),
    content: z.string().describe('Content to append to file'),
    encoding: z.enum(['utf-8', 'base64', 'hex']).optional().describe('File encoding (default: utf-8)'),
  }),
  handler: async ({ path, content, encoding = 'utf-8' }, context) => {
    const sandbox = getDefaultSandbox();
    await sandbox.appendFile(path, content, encoding as BufferEncoding);

    return {
      success: true,
      path,
      message: `Content appended to ${path}`,
    };
  },
});

// ============================================================================
// List Directory
// ============================================================================

export const listDirectory = createTool({
  name: 'list_directory',
  description: 'List contents of a directory in the workspace',
  category: 'filesystem',
  use_cases: [
    'List files',
    'See directory contents',
    'Browse workspace',
    'Find files',
  ],
  inputSchema: z.object({
    path: z.string().optional().describe('Path to directory relative to /workspace (default: root)'),
    detailed: z.boolean().optional().describe('Include file sizes and dates'),
  }),
  handler: async ({ path = '.', detailed = false }, context) => {
    const sandbox = getDefaultSandbox();

    if (detailed) {
      const entries = await sandbox.listDirectoryDetailed(path);
      return {
        success: true,
        path,
        entries,
        count: entries.length,
      };
    } else {
      const entries = await sandbox.listDirectory(path);
      return {
        success: true,
        path,
        entries,
        count: entries.length,
      };
    }
  },
});

// ============================================================================
// Create Directory
// ============================================================================

export const createDirectory = createTool({
  name: 'create_directory',
  description: 'Create a directory in the workspace',
  category: 'filesystem',
  use_cases: [
    'Create folder',
    'Make directory',
    'Organize files',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to directory relative to /workspace'),
  }),
  handler: async ({ path }, context) => {
    const sandbox = getDefaultSandbox();
    await sandbox.createDirectory(path);

    return {
      success: true,
      path,
      message: `Directory created at ${path}`,
    };
  },
});

// ============================================================================
// Delete File
// ============================================================================

export const deleteFile = createTool({
  name: 'delete_file',
  description: 'Delete a file in the workspace',
  category: 'filesystem',
  use_cases: [
    'Remove file',
    'Delete file',
    'Clean up',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to file relative to /workspace'),
  }),
  handler: async ({ path }, context) => {
    const sandbox = getDefaultSandbox();

    try {
      await sandbox.deleteFile(path);

      // Audit log successful deletion
      await logAudit({
        userId: context.user_id,
        operation: AuditOperations.DELETE_FILE,
        resourceType: 'file',
        resourceId: path,
        details: { path },
        result: 'success',
      });

      return {
        success: true,
        path,
        message: `File deleted: ${path}`,
      };
    } catch (error: any) {
      // Audit log failed deletion
      await logAudit({
        userId: context.user_id,
        operation: AuditOperations.DELETE_FILE,
        resourceType: 'file',
        resourceId: path,
        details: { path },
        result: 'failure',
        errorMessage: error.message,
      });
      throw error;
    }
  },
});

// ============================================================================
// Delete Directory
// ============================================================================

export const deleteDirectory = createTool({
  name: 'delete_directory',
  description: 'Delete a directory in the workspace. For recursive deletes, use with caution.',
  category: 'filesystem',
  use_cases: [
    'Remove directory',
    'Delete folder',
    'Clean up',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to directory relative to /workspace'),
    recursive: z.boolean().optional().describe('Delete recursively (default: false). WARNING: Use with caution!'),
  }),
  handler: async ({ path, recursive = false }, context) => {
    const sandbox = getDefaultSandbox();

    // Safety check: prevent deleting workspace root
    if (path === '.' || path === '/' || path === '') {
      const error = 'Safety: Cannot delete workspace root. Specify a subdirectory.';
      await logAudit({
        userId: context.user_id,
        operation: recursive ? AuditOperations.RECURSIVE_DELETE : AuditOperations.DELETE_DIRECTORY,
        resourceType: 'directory',
        resourceId: path,
        details: { path, recursive, blocked: true, reason: 'workspace_root' },
        result: 'failure',
        errorMessage: error,
      });
      return {
        success: false,
        error,
      };
    }

    try {
      // Count files if recursive (for audit logging)
      let fileCount = 0;
      if (recursive) {
        try {
          const entries = await sandbox.listDirectoryDetailed(path);
          fileCount = entries.length;
        } catch (e) {
          // Ignore counting errors
        }
      }

      await sandbox.deleteDirectory(path, recursive);

      // Audit log successful deletion
      await logAudit({
        userId: context.user_id,
        operation: recursive ? AuditOperations.RECURSIVE_DELETE : AuditOperations.DELETE_DIRECTORY,
        resourceType: 'directory',
        resourceId: path,
        details: { path, recursive, fileCount },
        result: 'success',
      });

      return {
        success: true,
        path,
        message: recursive
          ? `Directory deleted recursively: ${path} (${fileCount} files)`
          : `Directory deleted: ${path}`,
      };
    } catch (error: any) {
      // Audit log failed deletion
      await logAudit({
        userId: context.user_id,
        operation: recursive ? AuditOperations.RECURSIVE_DELETE : AuditOperations.DELETE_DIRECTORY,
        resourceType: 'directory',
        resourceId: path,
        details: { path, recursive },
        result: 'failure',
        errorMessage: error.message,
      });
      throw error;
    }
  },
});

// ============================================================================
// Check if File Exists
// ============================================================================

export const fileExists = createTool({
  name: 'file_exists',
  description: 'Check if a file or directory exists in the workspace',
  category: 'filesystem',
  use_cases: [
    'Check if file exists',
    'Verify path',
    'Test existence',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to check relative to /workspace'),
  }),
  handler: async ({ path }, context) => {
    const sandbox = getDefaultSandbox();
    const exists = await sandbox.exists(path);

    return {
      success: true,
      path,
      exists,
    };
  },
});

// ============================================================================
// Get File Info
// ============================================================================

export const getFileInfo = createTool({
  name: 'get_file_info',
  description: 'Get information about a file or directory (size, dates, type)',
  category: 'filesystem',
  use_cases: [
    'Get file details',
    'Check file size',
    'Get file metadata',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to file relative to /workspace'),
  }),
  handler: async ({ path }, context) => {
    const sandbox = getDefaultSandbox();
    const stats = await sandbox.stat(path);

    return {
      success: true,
      path,
      ...stats,
    };
  },
});

// ============================================================================
// Copy File
// ============================================================================

export const copyFile = createTool({
  name: 'copy_file',
  description: 'Copy a file to a new location in the workspace',
  category: 'filesystem',
  use_cases: [
    'Copy file',
    'Duplicate file',
    'Backup file',
  ],
  inputSchema: z.object({
    source: z.string().describe('Source file path relative to /workspace'),
    destination: z.string().describe('Destination file path relative to /workspace'),
  }),
  handler: async ({ source, destination }, context) => {
    const sandbox = getDefaultSandbox();
    await sandbox.copyFile(source, destination);

    return {
      success: true,
      source,
      destination,
      message: `File copied from ${source} to ${destination}`,
    };
  },
});

// ============================================================================
// Move File
// ============================================================================

export const moveFile = createTool({
  name: 'move_file',
  description: 'Move or rename a file in the workspace',
  category: 'filesystem',
  use_cases: [
    'Move file',
    'Rename file',
    'Relocate file',
  ],
  inputSchema: z.object({
    source: z.string().describe('Source file path relative to /workspace'),
    destination: z.string().describe('Destination file path relative to /workspace'),
  }),
  handler: async ({ source, destination }, context) => {
    const sandbox = getDefaultSandbox();
    await sandbox.moveFile(source, destination);

    return {
      success: true,
      source,
      destination,
      message: `File moved from ${source} to ${destination}`,
    };
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const filesystemTools = [
  readFile,
  writeFile,
  appendFile,
  listDirectory,
  createDirectory,
  deleteFile,
  deleteDirectory,
  fileExists,
  getFileInfo,
  copyFile,
  moveFile,
];
