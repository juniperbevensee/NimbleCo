/**
 * Mattermost API Tools
 * Tools for Audrey to interact with Mattermost - download attachments, post with attachments, add reactions
 */

import { Tool, ToolContext } from '../base';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

interface MattermostConfig {
  url: string;
  token: string;
}

function getMattermostConfig(context: ToolContext): MattermostConfig {
  const url = context.credentials.mattermost_url || process.env.MATTERMOST_URL;
  const token = context.credentials.mattermost_token || process.env.MATTERMOST_BOT_TOKEN;

  if (!url || !token) {
    throw new Error('Mattermost not configured. Set MATTERMOST_URL and MATTERMOST_BOT_TOKEN in environment.');
  }

  return { url, token };
}

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
// Download Attachment
// ============================================================================

export const downloadAttachment = createTool({
  name: 'download_mattermost_attachment',
  description: 'Download a file attachment from a Mattermost message. Use this when a user sends you a file and you need to read it.',
  category: 'communication',
  use_cases: [
    'Download file attachment',
    'Read uploaded file',
    'Get file from message',
    'Access attached document',
  ],
  inputSchema: z.object({
    file_id: z.string().describe('File ID from Mattermost (from message metadata)'),
  }),
  handler: async ({ file_id }, context) => {
    const config = getMattermostConfig(context);

    try {
      // Get file info first
      const infoResponse = await fetch(`${config.url}/api/v4/files/${file_id}/info`, {
        headers: {
          'Authorization': `Bearer ${config.token}`,
        },
      });

      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }

      const fileInfo = await infoResponse.json() as any;
      const filename = fileInfo.name || 'unknown';
      const size = fileInfo.size || 0;
      const mimeType = fileInfo.mime_type || 'application/octet-stream';

      // Download file content
      const fileResponse = await fetch(`${config.url}/api/v4/files/${file_id}`, {
        headers: {
          'Authorization': `Bearer ${config.token}`,
        },
      });

      if (!fileResponse.ok) {
        throw new Error(`Failed to download file: ${fileResponse.statusText}`);
      }

      const data = Buffer.from(await fileResponse.arrayBuffer());

      // For text files, return as string; for binary, return base64
      let content: string;
      if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) {
        content = data.toString('utf-8');
      } else {
        content = data.toString('base64');
      }

      return {
        success: true,
        filename,
        size,
        mime_type: mimeType,
        content,
        encoding: mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml') ? 'utf-8' : 'base64',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

// ============================================================================
// Upload and Post with Attachment
// ============================================================================

export const postWithAttachment = createTool({
  name: 'post_mattermost_message_with_attachment',
  description: '⚠️ Upload and attach a FILE to Mattermost (charts, images, documents). ONLY use when attaching files - NOT for sending text messages (your text response is posted automatically). ALWAYS use this immediately after creating charts/visualizations. NEVER just tell the user about a file - they cannot see it unless you attach it with this tool!',
  category: 'communication',
  use_cases: [
    '⚠️ REQUIRED: Attach charts/visualizations immediately after creating them',
    'Share PNG/image files with user',
    'Send file to user',
    'Post message with attachment',
    'Share document',
    'Upload file to channel',
  ],
  inputSchema: z.object({
    channel_id: z.string().describe('Mattermost channel ID to post to'),
    message: z.string().describe('Message text to include with the file'),
    filename: z.string().describe('Name of the file to upload'),
    content: z.string().describe('File content (as text or base64 string)'),
    encoding: z.enum(['utf-8', 'base64']).optional().describe('Content encoding (default: utf-8)'),
    thread_id: z.string().optional().describe('Thread ID (root_id) to reply to. If provided, the attachment will be posted as a threaded reply.'),
  }),
  handler: async ({ channel_id, message, filename, content, encoding = 'utf-8', thread_id }, context) => {
    const config = getMattermostConfig(context);

    try {
      // Convert content to buffer
      const buffer = encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : Buffer.from(content, 'utf-8');

      // Upload file first
      const formData = new FormData();
      formData.append('files', new Blob([buffer]), filename);
      formData.append('channel_id', channel_id);

      const uploadResponse = await fetch(`${config.url}/api/v4/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
      }

      const uploadResult = await uploadResponse.json() as any;
      const fileId = uploadResult.file_infos?.[0]?.id;

      if (!fileId) {
        throw new Error('File upload succeeded but no file ID returned');
      }

      // Post message with attachment
      const postBody: any = {
        channel_id,
        message,
        file_ids: [fileId],
      };

      // Add root_id if thread_id provided (for threaded replies)
      if (thread_id) {
        postBody.root_id = thread_id;
      }

      const postResponse = await fetch(`${config.url}/api/v4/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postBody),
      });

      if (!postResponse.ok) {
        throw new Error(`Failed to post message: ${postResponse.statusText}`);
      }

      const postData = await postResponse.json() as any;

      return {
        success: true,
        post_id: postData.id,
        file_id: fileId,
        message: `Message posted with attachment: ${filename}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

// ============================================================================
// Add Emoji Reaction
// ============================================================================

export const addReaction = createTool({
  name: 'add_mattermost_reaction',
  description: 'Add an emoji reaction to a Mattermost message. Use this to acknowledge messages or express emotions.',
  category: 'communication',
  use_cases: [
    'React to message',
    'Add emoji',
    'Acknowledge with reaction',
    'Express emotion',
  ],
  inputSchema: z.object({
    post_id: z.string().describe('Mattermost post ID to react to'),
    emoji_name: z.string().describe('Emoji name without colons (e.g., "thumbsup", "heart", "tada", "eyes")'),
  }),
  handler: async ({ post_id, emoji_name }, context) => {
    const config = getMattermostConfig(context);

    // Get bot user ID from context or environment
    const botUserId = context.credentials.mattermost_bot_user_id || process.env.MATTERMOST_BOT_USER_ID;

    if (!botUserId) {
      // Try to fetch it from Mattermost API
      try {
        const userResponse = await fetch(`${config.url}/api/v4/users/me`, {
          headers: {
            'Authorization': `Bearer ${config.token}`,
          },
        });

        if (!userResponse.ok) {
          throw new Error('Failed to get bot user ID');
        }

        const userData = await userResponse.json() as any;
        const fetchedBotUserId = userData.id;

        // Use the fetched ID
        try {
          const response = await fetch(`${config.url}/api/v4/reactions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              user_id: fetchedBotUserId,
              post_id,
              emoji_name,
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to add reaction: ${response.statusText}`);
          }

          return {
            success: true,
            message: `Reaction :${emoji_name}: added to post`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      } catch (error: any) {
        return {
          success: false,
          error: 'Bot user ID not configured and could not be fetched',
        };
      }
    }

    try {
      const response = await fetch(`${config.url}/api/v4/reactions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: botUserId,
          post_id,
          emoji_name,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to add reaction: ${response.statusText}`);
      }

      return {
        success: true,
        message: `Reaction :${emoji_name}: added to post`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const mattermostTools: Tool[] = [
  downloadAttachment,
  postWithAttachment,
  addReaction,
];
