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

export const googleDriveCreateGoogleSheet: Tool = {
  name: 'google_drive_create_google_sheet',
  description: 'Create a native Google Sheets spreadsheet (unlimited storage, collaborative editing)',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'Create a new spreadsheet for data collection',
    'Set up a shared spreadsheet for collaboration',
    'Create a tracking sheet from structured data',
  ],
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Title for the new spreadsheet',
      },
      folder_id: {
        type: 'string',
        description: 'Google Drive folder ID to create the spreadsheet in (optional)',
      },
      sheet_names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names for sheet tabs (default: ["Sheet1"])',
      },
      initial_data: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'string' },
        },
        description: 'Initial rows of data to populate (first row as headers)',
      },
    },
    required: ['title'],
  },

  async handler(input: any, ctx: ToolContext) {
    const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error('Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    });
    const sheets = google.sheets({ version: 'v4', auth: auth as any });
    const drive = google.drive({ version: 'v3', auth: auth as any });

    try {
      // Create spreadsheet
      const sheetNames = input.sheet_names || ['Sheet1'];
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: input.title },
          sheets: sheetNames.map((name: string, i: number) => ({
            properties: { title: name, index: i },
          })),
        },
      });

      const spreadsheetId = spreadsheet.data.spreadsheetId!;

      // Move to folder if specified
      if (input.folder_id) {
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: input.folder_id,
          fields: 'id, parents',
        });
      }

      // Populate initial data if provided
      if (input.initial_data && input.initial_data.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetNames[0]}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: input.initial_data },
        });
      }

      return {
        success: true,
        spreadsheet_id: spreadsheetId,
        title: input.title,
        url: spreadsheet.data.spreadsheetUrl,
        sheets: sheetNames,
      };
    } catch (error: any) {
      return { success: false, error: `Google Sheets API error: ${error.message}` };
    }
  },
};

export const googleSheetsRead: Tool = {
  name: 'google_sheets_read',
  description: 'Read data from a Google Sheets spreadsheet. Returns cell values from the specified range or entire sheet.',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'Read data from a spreadsheet',
    'Check current contents of a Google Sheet before writing',
    'Extract structured data from a sheet',
    'Review spreadsheet headers and rows',
  ],
  parameters: {
    type: 'object',
    properties: {
      spreadsheet_id: {
        type: 'string',
        description: 'Spreadsheet ID from the Google Sheets URL (the long string between /d/ and /edit)',
      },
      range: {
        type: 'string',
        description: 'A1 notation range to read (e.g., "A1:D10", "Sheet1!A:Z"). Defaults to entire first sheet.',
      },
      sheet_name: {
        type: 'string',
        description: 'Name of the sheet tab to read from (default: first sheet). Ignored if range includes sheet name.',
      },
    },
    required: ['spreadsheet_id'],
  },

  async handler(input: any, ctx: ToolContext) {
    const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error('Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth: auth as any });

    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: input.spreadsheet_id });
      const sheetNames = meta.data.sheets?.map(s => s.properties?.title) ?? [];

      let range = input.range;
      if (!range) {
        const sheetName = input.sheet_name || sheetNames[0] || 'Sheet1';
        range = sheetName;
      } else if (input.sheet_name && !range.includes('!')) {
        range = `${input.sheet_name}!${range}`;
      }

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: input.spreadsheet_id,
        range,
      });

      const rows = response.data.values || [];
      return {
        success: true,
        spreadsheet_id: input.spreadsheet_id,
        title: meta.data.properties?.title,
        sheet_names: sheetNames,
        range: response.data.range,
        total_rows: rows.length,
        data: rows,
      };
    } catch (error: any) {
      return { success: false, error: `Google Sheets API error: ${error.message}` };
    }
  },
};

export const googleSheetsList: Tool = {
  name: 'google_sheets_list',
  description: 'List all sheet tabs in a Google Sheets spreadsheet, including their properties (name, index, row/column count).',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'See what tabs exist in a spreadsheet',
    'Get sheet metadata before reading or writing',
    'Find the right sheet tab name',
  ],
  parameters: {
    type: 'object',
    properties: {
      spreadsheet_id: {
        type: 'string',
        description: 'Spreadsheet ID from the Google Sheets URL',
      },
    },
    required: ['spreadsheet_id'],
  },

  async handler(input: any, ctx: ToolContext) {
    const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error('Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth: auth as any });

    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: input.spreadsheet_id });
      const sheetTabs = meta.data.sheets?.map(s => ({
        title: s.properties?.title,
        index: s.properties?.index,
        sheetId: s.properties?.sheetId,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      })) ?? [];

      return {
        success: true,
        spreadsheet_id: input.spreadsheet_id,
        title: meta.data.properties?.title,
        sheets: sheetTabs,
      };
    } catch (error: any) {
      return { success: false, error: `Google Sheets API error: ${error.message}` };
    }
  },
};

export const googleSheetsWrite: Tool = {
  name: 'google_sheets_write',
  description: 'Write rows of data to an existing Google Sheets spreadsheet',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'Write data to a spreadsheet',
    'Append rows to an existing sheet',
    'Update specific cells in a spreadsheet',
  ],
  parameters: {
    type: 'object',
    properties: {
      spreadsheet_id: {
        type: 'string',
        description: 'Spreadsheet ID from the Google Sheets URL',
      },
      range: {
        type: 'string',
        description: 'A1 notation range to write to (e.g., "A1:D10", "Sheet1!A1")',
      },
      values: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'string' },
        },
        description: 'Rows of data to write (array of arrays)',
      },
      mode: {
        type: 'string',
        enum: ['overwrite', 'append'],
        description: 'overwrite: write at range. append: add after existing data (default: overwrite)',
      },
    },
    required: ['spreadsheet_id', 'values'],
  },

  async handler(input: any, ctx: ToolContext) {
    const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error('Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth: auth as any });

    try {
      const mode = input.mode || 'overwrite';

      if (mode === 'append') {
        const range = input.range || 'Sheet1';
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: input.spreadsheet_id,
          range,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: input.values },
        });

        return {
          success: true,
          spreadsheet_id: input.spreadsheet_id,
          updated_range: response.data.updates?.updatedRange,
          rows_written: input.values.length,
        };
      } else {
        const range = input.range || 'Sheet1!A1';
        const response = await sheets.spreadsheets.values.update({
          spreadsheetId: input.spreadsheet_id,
          range,
          valueInputOption: 'RAW',
          requestBody: { values: input.values },
        });

        return {
          success: true,
          spreadsheet_id: input.spreadsheet_id,
          updated_range: response.data.updatedRange,
          rows_written: response.data.updatedRows,
          cells_updated: response.data.updatedCells,
        };
      }
    } catch (error: any) {
      return { success: false, error: `Google Sheets API error: ${error.message}` };
    }
  },
};

export const googleDocsRead: Tool = {
  name: 'google_docs_read',
  description: 'Read the text content of a Google Doc. Returns the full document text.',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'Read the contents of a Google Doc',
    'Check what is already in a document before editing',
    'Extract text from a shared document',
  ],
  parameters: {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'Google Doc ID from the URL (the long string between /d/ and /edit)',
      },
    },
    required: ['document_id'],
  },

  async handler(input: any, ctx: ToolContext) {
    const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error('Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/documents.readonly'],
    });
    const docs = google.docs({ version: 'v1', auth: auth as any });

    try {
      const doc = await docs.documents.get({ documentId: input.document_id });

      let text = '';
      for (const element of doc.data.body?.content ?? []) {
        if (element.paragraph) {
          for (const el of element.paragraph.elements ?? []) {
            if (el.textRun?.content) {
              text += el.textRun.content;
            }
          }
        } else if (element.table) {
          for (const row of element.table.tableRows ?? []) {
            const cells: string[] = [];
            for (const cell of row.tableCells ?? []) {
              let cellText = '';
              for (const cellContent of cell.content ?? []) {
                if (cellContent.paragraph) {
                  for (const el of cellContent.paragraph.elements ?? []) {
                    if (el.textRun?.content) {
                      cellText += el.textRun.content.trim();
                    }
                  }
                }
              }
              cells.push(cellText);
            }
            text += cells.join('\t') + '\n';
          }
        }
      }

      return {
        success: true,
        document_id: input.document_id,
        title: doc.data.title,
        content: text,
        character_count: text.length,
      };
    } catch (error: any) {
      return { success: false, error: `Google Docs API error: ${error.message}` };
    }
  },
};

export const googleDocsAppend: Tool = {
  name: 'google_docs_append',
  description: 'Append text content to an existing Google Doc',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'Add content to the end of a document',
    'Append meeting notes to a shared doc',
    'Add new sections to an existing document',
  ],
  parameters: {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'Google Doc ID from the URL',
      },
      content: {
        type: 'string',
        description: 'Text content to append to the document',
      },
    },
    required: ['document_id', 'content'],
  },

  async handler(input: any, ctx: ToolContext) {
    const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error('Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/documents'],
    });
    const docs = google.docs({ version: 'v1', auth: auth as any });

    try {
      // Get current doc to find the end index
      const doc = await docs.documents.get({ documentId: input.document_id });
      const body = doc.data.body?.content ?? [];
      const lastElement = body[body.length - 1];
      const endIndex = (lastElement?.endIndex ?? 2) - 1;

      await docs.documents.batchUpdate({
        documentId: input.document_id,
        requestBody: {
          requests: [{
            insertText: {
              location: { index: endIndex },
              text: input.content,
            },
          }],
        },
      });

      return {
        success: true,
        document_id: input.document_id,
        characters_appended: input.content.length,
      };
    } catch (error: any) {
      return { success: false, error: `Google Docs API error: ${error.message}` };
    }
  },
};

export const googleDocsUpdate: Tool = {
  name: 'google_docs_update',
  description: 'Replace the entire content of a Google Doc with new text, or insert text at a specific position. For appending, use google_docs_append instead.',
  category: 'storage',
  requiredEnv: ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'],
  use_cases: [
    'Rewrite a Google Doc with new content',
    'Replace document content with an updated version',
    'Insert text at a specific position in a document',
  ],
  parameters: {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'Google Doc ID from the URL (the long string between /d/ and /edit)',
      },
      content: {
        type: 'string',
        description: 'New text content for the document',
      },
      mode: {
        type: 'string',
        enum: ['replace', 'insert'],
        description: 'replace: clear doc and write new content. insert: insert at position (default: replace)',
      },
      insert_index: {
        type: 'number',
        description: 'Character index to insert at (only for insert mode, default: 1 = start of doc)',
      },
    },
    required: ['document_id', 'content'],
  },

  async handler(input: any, ctx: ToolContext) {
    const serviceAccountKeyJson = ctx.credentials.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKeyJson) {
      throw new Error('Google Drive credentials required. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY environment variable.');
    }

    const serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/documents'],
    });
    const docs = google.docs({ version: 'v1', auth: auth as any });

    try {
      const mode = input.mode || 'replace';
      const requests: any[] = [];

      if (mode === 'replace') {
        const doc = await docs.documents.get({ documentId: input.document_id });
        const body = doc.data.body?.content ?? [];
        const lastElement = body[body.length - 1];
        const endIndex = (lastElement?.endIndex ?? 2) - 1;

        if (endIndex > 1) {
          requests.push({
            deleteContentRange: {
              range: { startIndex: 1, endIndex },
            },
          });
        }
        requests.push({
          insertText: {
            location: { index: 1 },
            text: input.content,
          },
        });
      } else {
        const insertIndex = input.insert_index ?? 1;
        requests.push({
          insertText: {
            location: { index: insertIndex },
            text: input.content,
          },
        });
      }

      await docs.documents.batchUpdate({
        documentId: input.document_id,
        requestBody: { requests },
      });

      return {
        success: true,
        document_id: input.document_id,
        mode,
        characters_written: input.content.length,
      };
    } catch (error: any) {
      return { success: false, error: `Google Docs API error: ${error.message}` };
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
  googleDriveCreateGoogleSheet,
  googleSheetsRead,
  googleSheetsList,
  googleSheetsWrite,
  googleDocsRead,
  googleDocsAppend,
  googleDocsUpdate,
  googleDriveShareFile,
  googleDriveDeleteFile,
  googleDriveMoveFile,
];
