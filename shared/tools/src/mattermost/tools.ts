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
// List Channels
// ============================================================================

export const listChannels = createTool({
  name: 'list_mattermost_channels',
  description: 'List channels the bot has access to. Returns channel IDs needed for posting messages. The bot is typically a member of one team — this lists that team\'s channels.',
  category: 'communication',
  use_cases: [
    'Find a channel ID to post a message to',
    'See what channels the bot can access',
    'Look up channel details before posting',
  ],
  inputSchema: z.object({}),
  handler: async (_input, context) => {
    const config = getMattermostConfig(context);

    try {
      // Get bot's own user info
      const meResponse = await fetch(`${config.url}/api/v4/users/me`, {
        headers: { 'Authorization': `Bearer ${config.token}` },
      });
      if (!meResponse.ok) throw new Error(`Failed to get bot info: ${meResponse.statusText}`);
      const me = await meResponse.json() as any;

      // Get teams the bot belongs to
      const teamsResponse = await fetch(`${config.url}/api/v4/users/${me.id}/teams`, {
        headers: { 'Authorization': `Bearer ${config.token}` },
      });
      if (!teamsResponse.ok) throw new Error(`Failed to get teams: ${teamsResponse.statusText}`);
      const teams = await teamsResponse.json() as any[];

      // Get channels for each team
      const result: Array<{ team: string; team_id: string; channels: Array<{ id: string; name: string; display_name: string; type: string }> }> = [];

      for (const team of teams) {
        const channelsResponse = await fetch(`${config.url}/api/v4/users/${me.id}/teams/${team.id}/channels`, {
          headers: { 'Authorization': `Bearer ${config.token}` },
        });
        if (!channelsResponse.ok) continue;
        const channels = await channelsResponse.json() as any[];

        result.push({
          team: team.display_name,
          team_id: team.id,
          channels: channels
            .filter((c: any) => c.type !== 'D' && c.type !== 'G') // exclude DMs and group messages
            .map((c: any) => ({
              id: c.id,
              name: c.name,
              display_name: c.display_name,
              type: c.type === 'O' ? 'public' : c.type === 'P' ? 'private' : c.type,
            }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name)),
        });
      }

      return { success: true, teams: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
});

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
// Post Message (text only)
// ============================================================================

export const postMessage = createTool({
  name: 'post_mattermost_message',
  description: 'Post a text message to a Mattermost channel. Use this when you need to proactively send a message (handoff summaries, notifications, status updates). Your normal chat responses are posted automatically — this tool is for posting to OTHER channels or threads.',
  category: 'communication',
  use_cases: [
    'Post a handoff summary to a channel',
    'Send a notification to a specific channel',
    'Post a status update',
    'Reply to a thread in another channel',
  ],
  inputSchema: z.object({
    channel_id: z.string().describe('Mattermost channel ID to post to'),
    message: z.string().describe('Message text (supports Mattermost markdown)'),
    thread_id: z.string().optional().describe('Thread ID (root_id) to reply to. If provided, posts as a threaded reply.'),
  }),
  handler: async ({ channel_id, message, thread_id }, context) => {
    const config = getMattermostConfig(context);

    try {
      const postBody: any = {
        channel_id,
        message,
      };

      if (thread_id) {
        postBody.root_id = thread_id;
      }

      const response = await fetch(`${config.url}/api/v4/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to post message: ${response.statusText} - ${errorBody}`);
      }

      const postData = await response.json() as any;

      return {
        success: true,
        post_id: postData.id,
        channel_id: postData.channel_id,
        message: 'Message posted successfully',
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
  listChannels,
  downloadAttachment,
  postMessage,
  postWithAttachment,
  addReaction,
];
