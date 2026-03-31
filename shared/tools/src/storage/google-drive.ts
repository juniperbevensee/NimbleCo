// Google Drive tools - using service account authentication
// Matches the existing NimbleCo tool patterns

import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Tool, ToolContext } from '../base';
import type { drive_v3 } from 'googleapis';
import { Readable } from 'stream';

// Lazy-initialized context to avoid re-creating auth on every call
let cachedContext: { auth: GoogleAuth; drive: drive_v3.Drive } | null = null;

/**
 * Get or create a Google Drive client using service account credentials
 */
async function getDriveClient(ctx: ToolContext): Promise<drive_v3.Drive> {
  // Check if we already have a cached client
  if (cachedContext) {
    return cachedContext.drive;
  }

  // Get service account key from credentials
  const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKeyJson) {
    throw new Error(
      'Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.'
    );
  }

  let serviceAccountKey: any;
  try {
    serviceAccountKey = JSON.parse(serviceAccountKeyJson);
  } catch (e: any) {
    throw new Error(
      `Failed to parse service account key as JSON: ${e.message}\n` +
      `Hint: Make sure the JSON is not wrapped in extra quotes and has no escape issues.`
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  const drive = google.drive({ version: 'v3', auth: auth as any });

  // Cache for reuse
  cachedContext = { auth, drive };

  return drive;
}

// Helper to format file response
function formatFile(file: drive_v3.Schema$File) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    parents: file.parents,
    shared: file.shared,
  };
}

export const googleDriveListFiles: Tool = {
  name: 'google_drive_list_files',
  description: 'List files in Google Drive with optional query filter',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'list Drive files',
    'browse Google Drive',
    'view files in folder',
  ],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Drive query string (e.g., "name contains \'report\'" or "mimeType = \'application/pdf\'")',
      },
      folder_id: {
        type: 'string',
        description: 'Folder ID to list files from (optional)',
      },
      page_size: {
        type: 'number',
        description: 'Maximum number of files to return (default: 50)',
      },
      order_by: {
        type: 'string',
        description: 'Sort order (e.g., "modifiedTime desc", "name")',
      },
    },
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      let query = input.query || '';
      if (input.folder_id) {
        const folderQuery = `'${input.folder_id}' in parents`;
        query = query ? `${query} and ${folderQuery}` : folderQuery;
      }

      const response = await drive.files.list({
        q: query || undefined,
        pageSize: input.page_size || 50,
        fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents,shared)',
        orderBy: input.order_by || 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = (response.data.files || []).map(formatFile);

      return {
        success: true,
        files,
        count: files.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveSearch: Tool = {
  name: 'google_drive_search',
  description: 'Search for files in Google Drive by name or content',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'search Drive files',
    'find file by name',
    'locate document',
  ],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (searches file names and content)',
      },
      mime_type: {
        type: 'string',
        description: 'Filter by MIME type (e.g., "application/pdf", "application/vnd.google-apps.document")',
      },
      page_size: {
        type: 'number',
        description: 'Maximum number of results (default: 25)',
      },
    },
    required: ['query'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      // Build search query - use fullText for content search
      let query = `fullText contains '${input.query.replace(/'/g, "\\'")}'`;
      if (input.mime_type) {
        query += ` and mimeType = '${input.mime_type}'`;
      }

      const response = await drive.files.list({
        q: query,
        pageSize: input.page_size || 25,
        fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents,shared)',
        orderBy: 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = (response.data.files || []).map(formatFile);

      return {
        success: true,
        files,
        count: files.length,
        query: input.query,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveUploadFile: Tool = {
  name: 'google_drive_upload_file',
  description: 'Upload a file to Google Drive',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'upload file to Drive',
    'save file to Google Drive',
    'store document',
  ],
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'File name',
      },
      content: {
        type: 'string',
        description: 'File content (text or base64 encoded for binary)',
      },
      mime_type: {
        type: 'string',
        description: 'MIME type (e.g., "text/plain", "application/pdf")',
      },
      folder_id: {
        type: 'string',
        description: 'Parent folder ID (optional)',
      },
      is_base64: {
        type: 'boolean',
        description: 'Whether content is base64 encoded (default: false)',
      },
    },
    required: ['name', 'content', 'mime_type'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      const fileMetadata: any = {
        name: input.name,
      };

      if (input.folder_id) {
        fileMetadata.parents = [input.folder_id];
      }

      // Convert content to buffer
      const buffer = input.is_base64
        ? Buffer.from(input.content, 'base64')
        : Buffer.from(input.content);

      const stream = Readable.from(buffer);

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: input.mime_type,
          body: stream,
        },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true,
      });

      return {
        success: true,
        file: {
          id: response.data.id,
          name: response.data.name,
          webViewLink: response.data.webViewLink,
        },
        message: `File uploaded: ${input.name}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveDownloadFile: Tool = {
  name: 'google_drive_download_file',
  description: 'Download file content from Google Drive',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'download Drive file',
    'read file content',
    'get document content',
  ],
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'File ID to download',
      },
      as_base64: {
        type: 'boolean',
        description: 'Return content as base64 (for binary files, default: false)',
      },
    },
    required: ['file_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      // First get file metadata to check type
      const fileInfo = await drive.files.get({
        fileId: input.file_id,
        fields: 'id,name,mimeType,size',
        supportsAllDrives: true,
      });

      const mimeType = fileInfo.data.mimeType || '';

      // For Google Workspace docs, export instead of download
      let content: Buffer;
      if (mimeType.startsWith('application/vnd.google-apps.')) {
        // Export Google Docs as plain text or PDF
        let exportMimeType = 'text/plain';
        if (mimeType === 'application/vnd.google-apps.spreadsheet') {
          exportMimeType = 'text/csv';
        } else if (mimeType === 'application/vnd.google-apps.presentation') {
          exportMimeType = 'application/pdf';
        }

        const response = await drive.files.export(
          { fileId: input.file_id, mimeType: exportMimeType },
          { responseType: 'arraybuffer' }
        );
        content = Buffer.from(response.data as ArrayBuffer);
      } else {
        // Regular file download
        const response = await drive.files.get(
          { fileId: input.file_id, alt: 'media', supportsAllDrives: true },
          { responseType: 'arraybuffer' }
        );
        content = Buffer.from(response.data as ArrayBuffer);
      }

      // Return as text or base64
      const isTextContent = mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType.startsWith('application/vnd.google-apps.');

      return {
        success: true,
        file: {
          id: fileInfo.data.id,
          name: fileInfo.data.name,
          mimeType: fileInfo.data.mimeType,
          size: fileInfo.data.size,
        },
        content: (input.as_base64 || !isTextContent)
          ? content.toString('base64')
          : content.toString('utf-8'),
        encoding: (input.as_base64 || !isTextContent) ? 'base64' : 'utf-8',
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveCreateFolder: Tool = {
  name: 'google_drive_create_folder',
  description: 'Create a folder in Google Drive',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'create Drive folder',
    'make directory',
    'organize files',
  ],
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Folder name',
      },
      parent_id: {
        type: 'string',
        description: 'Parent folder ID (optional)',
      },
    },
    required: ['name'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      const fileMetadata: any = {
        name: input.name,
        mimeType: 'application/vnd.google-apps.folder',
      };

      if (input.parent_id) {
        fileMetadata.parents = [input.parent_id];
      }

      const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id,name,webViewLink',
        supportsAllDrives: true,
      });

      return {
        success: true,
        folder: {
          id: response.data.id,
          name: response.data.name,
          webViewLink: response.data.webViewLink,
        },
        message: `Folder created: ${input.name}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveCreateGoogleDoc: Tool = {
  name: 'google_drive_create_google_doc',
  description: 'Create a native Google Doc (unlimited storage, collaborative editing)',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'create Google Doc',
    'new document',
    'collaborative document',
  ],
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Document name',
      },
      content: {
        type: 'string',
        description: 'Initial document content (plain text)',
      },
      folder_id: {
        type: 'string',
        description: 'Parent folder ID (optional)',
      },
    },
    required: ['name'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      const fileMetadata: any = {
        name: input.name,
        mimeType: 'application/vnd.google-apps.document',
      };

      if (input.folder_id) {
        fileMetadata.parents = [input.folder_id];
      }

      const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id,name,webViewLink',
        supportsAllDrives: true,
      });

      // If content provided, add it using Docs API
      if (input.content && response.data.id) {
        const docs = google.docs({ version: 'v1', auth: cachedContext?.auth });
        await docs.documents.batchUpdate({
          documentId: response.data.id,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: input.content,
                },
              },
            ],
          },
        });
      }

      return {
        success: true,
        document: {
          id: response.data.id,
          name: response.data.name,
          webViewLink: response.data.webViewLink,
        },
        message: `Google Doc created: ${input.name}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveShareFile: Tool = {
  name: 'google_drive_share_file',
  description: 'Share a file with a user or make it publicly accessible',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'share Drive file',
    'grant access',
    'make file public',
  ],
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'File ID to share',
      },
      email: {
        type: 'string',
        description: 'Email address to share with (omit for public link)',
      },
      role: {
        type: 'string',
        enum: ['reader', 'writer', 'commenter'],
        description: 'Permission role (default: "reader")',
      },
      type: {
        type: 'string',
        enum: ['user', 'group', 'domain', 'anyone'],
        description: 'Permission type (default: "user" if email provided, "anyone" otherwise)',
      },
    },
    required: ['file_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      const permission: any = {
        type: input.type || (input.email ? 'user' : 'anyone'),
        role: input.role || 'reader',
      };

      if (input.email) {
        permission.emailAddress = input.email;
      }

      const response = await drive.permissions.create({
        fileId: input.file_id,
        requestBody: permission,
        fields: 'id',
        supportsAllDrives: true,
      });

      // Get the file's web link
      const fileInfo = await drive.files.get({
        fileId: input.file_id,
        fields: 'webViewLink',
        supportsAllDrives: true,
      });

      return {
        success: true,
        permissionId: response.data.id,
        webViewLink: fileInfo.data.webViewLink,
        message: input.email
          ? `File shared with ${input.email}`
          : 'File made publicly accessible',
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveDeleteFile: Tool = {
  name: 'google_drive_delete_file',
  description: 'Delete a file from Google Drive',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'delete Drive file',
    'remove file',
    'trash document',
  ],
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'File ID to delete',
      },
    },
    required: ['file_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      await drive.files.delete({
        fileId: input.file_id,
        supportsAllDrives: true,
      });

      return {
        success: true,
        message: `File deleted: ${input.file_id}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveMoveFile: Tool = {
  name: 'google_drive_move_file',
  description: 'Move a file to a different folder in Google Drive',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'move Drive file',
    'organize files',
    'change file location',
  ],
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'File ID to move',
      },
      new_parent_id: {
        type: 'string',
        description: 'New parent folder ID',
      },
    },
    required: ['file_id', 'new_parent_id'],
  },

  async handler(input, ctx: ToolContext) {
    try {
      const drive = await getDriveClient(ctx);

      // Get current parents
      const file = await drive.files.get({
        fileId: input.file_id,
        fields: 'parents,name',
        supportsAllDrives: true,
      });

      const previousParents = file.data.parents?.join(',') || '';

      // Move file
      const response = await drive.files.update({
        fileId: input.file_id,
        addParents: input.new_parent_id,
        removeParents: previousParents,
        fields: 'id,name,webViewLink',
        supportsAllDrives: true,
      });

      return {
        success: true,
        file: {
          id: response.data.id,
          name: response.data.name,
          webViewLink: response.data.webViewLink,
        },
        message: `File moved: ${file.data.name}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Google Drive API error: ${error.message}`,
      };
    }
  },
};

export const googleDriveTools = [
  googleDriveListFiles,
  googleDriveSearch,
  googleDriveUploadFile,
  googleDriveDownloadFile,
  googleDriveCreateFolder,
  googleDriveCreateGoogleDoc,
  googleDriveShareFile,
  googleDriveDeleteFile,
  googleDriveMoveFile,
];
