// Comprehensive Notion API integration
// Based on cantrip-integrations implementation

import { Client } from '@notionhq/client';
import { Tool, ToolContext } from '../base';

interface NotionBlock {
  type: string;
  [key: string]: any;
}

// Helper: Extract plain text from rich text array
function richTextToPlain(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map((rt) => rt.plain_text || '').join('');
}

// Helper: Format page/database properties for display
function formatProperties(properties: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (!prop) continue;
    const type = prop.type;
    switch (type) {
      case 'title':
        result[key] = richTextToPlain(prop.title);
        break;
      case 'rich_text':
        result[key] = richTextToPlain(prop.rich_text);
        break;
      case 'number':
        result[key] = prop.number;
        break;
      case 'select':
        result[key] = prop.select?.name || null;
        break;
      case 'multi_select':
        result[key] = prop.multi_select?.map((s: any) => s.name) || [];
        break;
      case 'date':
        result[key] = prop.date?.start || null;
        break;
      case 'checkbox':
        result[key] = prop.checkbox;
        break;
      case 'url':
        result[key] = prop.url;
        break;
      case 'email':
        result[key] = prop.email;
        break;
      case 'phone_number':
        result[key] = prop.phone_number;
        break;
      case 'status':
        result[key] = prop.status?.name || null;
        break;
      case 'people':
        result[key] = prop.people?.map((p: any) => p.name || p.id) || [];
        break;
      case 'relation':
        result[key] = prop.relation?.map((r: any) => r.id) || [];
        break;
      default:
        result[key] = `[${type}]`;
    }
  }
  return result;
}

// Helper: Format block content for display
function formatBlock(block: any): string {
  const type = block.type;
  const content = block[type];

  if (!content) return `[${type}]`;

  switch (type) {
    case 'paragraph':
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'quote':
    case 'callout':
    case 'toggle':
      return richTextToPlain(content.rich_text);
    case 'code':
      return `\`\`\`${content.language || ''}\n${richTextToPlain(content.rich_text)}\n\`\`\``;
    case 'to_do':
      const checked = content.checked ? '[x]' : '[ ]';
      return `${checked} ${richTextToPlain(content.rich_text)}`;
    case 'divider':
      return '---';
    case 'image':
    case 'video':
    case 'file':
    case 'pdf':
      const url = content.external?.url || content.file?.url || '';
      return `[${type}: ${url}]`;
    case 'bookmark':
      return `[bookmark: ${content.url}]`;
    case 'link_preview':
      return `[link: ${content.url}]`;
    case 'table':
      return `[table: ${content.table_width} columns]`;
    case 'child_page':
      return `[child page: ${content.title}]`;
    case 'child_database':
      return `[child database: ${content.title}]`;
    default:
      return `[${type}]`;
  }
}

// Helper: Convert markdown to Notion blocks (simplified)
function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) continue;

    // Heading
    if (line.startsWith('# ')) {
      blocks.push({
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }]
        }
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }]
        }
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }]
        }
      });
    }
    // Bullet list
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }]
        }
      });
    }
    // Numbered list
    else if (line.match(/^\d+\. /)) {
      blocks.push({
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\. /, '') } }]
        }
      });
    }
    // Code block
    else if (line.startsWith('```')) {
      const language = line.slice(3).trim() || 'plain text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          language: language
        }
      });
    }
    // Regular paragraph
    else {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }]
        }
      });
    }
  }

  return blocks;
}

// ============================================================================
// SEARCH & DISCOVERY
// ============================================================================

export const notionSearch: Tool = {
  name: 'notion_search',
  description: 'Search for pages and databases in Notion workspace by text query',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'finding existing docs in Notion workspace',
    'searching Notion pages by title or content',
    'locating Notion databases',
    'finding Notion content by keyword'
  ],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query text'
      },
      filter: {
        type: 'string',
        enum: ['page', 'database'],
        description: 'Filter results by type (optional)'
      },
      page_size: {
        type: 'number',
        description: 'Max results (1-100, default 100)'
      }
    },
    required: ['query']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const searchParams: any = { query: input.query };
      if (input.filter) {
        searchParams.filter = { property: 'object', value: input.filter };
      }
      if (input.page_size) {
        searchParams.page_size = Math.min(input.page_size, 100);
      }

      const results = await notion.search(searchParams);

      const formatted = results.results.map((item: any) => {
        const isPage = item.object === 'page';
        let title = '';

        if (isPage) {
          const titleProp = Object.values(item.properties || {}).find(
            (p: any) => p.type === 'title'
          ) as any;
          title = titleProp ? richTextToPlain(titleProp.title) : '(Untitled)';
        } else {
          title = richTextToPlain(item.title) || '(Untitled)';
        }

        return {
          id: item.id,
          type: item.object,
          title,
          url: item.url,
          last_edited: item.last_edited_time
        };
      });

      return {
        success: true,
        results: formatted,
        count: formatted.length,
        has_more: results.has_more
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

export const notionGetDatabase: Tool = {
  name: 'notion_get_database',
  description: 'Get a Notion database schema and metadata. Returns property definitions useful when creating pages.',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'view database schema',
    'check database properties',
    'see available columns',
    'understand database structure'
  ],
  parameters: {
    type: 'object',
    properties: {
      database_id: {
        type: 'string',
        description: 'The database ID (UUID)'
      }
    },
    required: ['database_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });
      const db = await notion.databases.retrieve({ database_id: input.database_id });

      // Format properties schema
      const schema: Record<string, any> = {};
      for (const [key, prop] of Object.entries((db as any).properties || {})) {
        const p = prop as any;
        schema[key] = {
          type: p.type,
          ...(p.select?.options && { options: p.select.options.map((o: any) => o.name) }),
          ...(p.multi_select?.options && { options: p.multi_select.options.map((o: any) => o.name) }),
          ...(p.status?.options && { options: p.status.options.map((o: any) => o.name) }),
        };
      }

      return {
        success: true,
        database: {
          id: db.id,
          title: richTextToPlain((db as any).title),
          url: (db as any).url,
          properties: schema,
          created_time: (db as any).created_time,
          last_edited_time: (db as any).last_edited_time,
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionQueryDatabase: Tool = {
  name: 'notion_query_database',
  description: 'Query pages from a Notion database with optional filtering and sorting. Use notion_get_database first to see available properties.',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'query database entries',
    'filter database pages',
    'list database items',
    'search within database'
  ],
  parameters: {
    type: 'object',
    properties: {
      database_id: {
        type: 'string',
        description: 'The database ID to query'
      },
      filter: {
        type: 'object',
        description: 'Notion filter object (see Notion API docs). Example: {"property": "Status", "select": {"equals": "Done"}}'
      },
      sorts: {
        type: 'array',
        description: 'Array of sort objects. Example: [{"property": "Created", "direction": "descending"}]'
      },
      page_size: {
        type: 'number',
        description: 'Max results per page (1-100)'
      },
      start_cursor: {
        type: 'string',
        description: 'Cursor for pagination'
      }
    },
    required: ['database_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const queryParams: any = { database_id: input.database_id };
      if (input.filter) queryParams.filter = input.filter;
      if (input.sorts) queryParams.sorts = input.sorts;
      if (input.page_size) queryParams.page_size = Math.min(input.page_size, 100);
      if (input.start_cursor) queryParams.start_cursor = input.start_cursor;

      const result = await notion.databases.query(queryParams);

      const pages = result.results.map((page: any) => ({
        id: page.id,
        url: page.url,
        properties: formatProperties(page.properties),
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
      }));

      return {
        success: true,
        results: pages,
        count: pages.length,
        has_more: result.has_more,
        next_cursor: result.next_cursor
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionCreateDatabase: Tool = {
  name: 'notion_create_database',
  description: 'Create a new database in Notion (like a table or task list)',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'creating project tracker',
    'setting up task database',
    'creating contact list',
    'building content calendar'
  ],
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Database title'
      },
      parent_page_id: {
        type: 'string',
        description: 'Parent page ID'
      },
      properties: {
        type: 'object',
        description: 'Database properties (columns). Example: {"Status": {"select": {"options": [{"name": "Todo"}, {"name": "Done"}]}}, "Due Date": {"date": {}}}',
        additionalProperties: true
      }
    },
    required: ['title', 'parent_page_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const defaultProperties = {
        Name: { title: {} },
        ...(input.properties || {})
      };

      const database = await notion.databases.create({
        parent: { page_id: input.parent_page_id },
        title: [{ text: { content: input.title } }],
        properties: defaultProperties as any
      });

      return {
        success: true,
        database_id: database.id,
        url: (database as any).url || undefined,
        message: `Created Notion database: ${input.title}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

// ============================================================================
// PAGE OPERATIONS
// ============================================================================

export const notionGetPage: Tool = {
  name: 'notion_get_page',
  description: 'Get a Notion page properties and metadata',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'get page properties',
    'check page metadata',
    'view page info'
  ],
  parameters: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'The page ID (UUID)'
      }
    },
    required: ['page_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });
      const page = await notion.pages.retrieve({ page_id: input.page_id });

      return {
        success: true,
        page: {
          id: page.id,
          url: (page as any).url,
          properties: formatProperties((page as any).properties),
          parent: (page as any).parent,
          created_time: (page as any).created_time,
          last_edited_time: (page as any).last_edited_time,
          created_by: (page as any).created_by,
          last_edited_by: (page as any).last_edited_by,
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionGetBlocks: Tool = {
  name: 'notion_get_blocks',
  description: 'Get the content blocks of a Notion page or block. Returns the actual content (text, headings, lists, etc.).',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'read page content',
    'get block children',
    'fetch page text',
    'retrieve document content'
  ],
  parameters: {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The page or block ID to get children of'
      },
      page_size: {
        type: 'number',
        description: 'Max blocks to return (1-100)'
      },
      start_cursor: {
        type: 'string',
        description: 'Cursor for pagination'
      }
    },
    required: ['block_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const params: any = { block_id: input.block_id };
      if (input.page_size) params.page_size = Math.min(input.page_size, 100);
      if (input.start_cursor) params.start_cursor = input.start_cursor;

      const result = await notion.blocks.children.list(params);

      const blocks = result.results.map((block: any) => ({
        id: block.id,
        type: block.type,
        content: formatBlock(block),
        has_children: block.has_children,
      }));

      return {
        success: true,
        blocks,
        count: blocks.length,
        has_more: result.has_more,
        next_cursor: result.next_cursor
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionCreatePage: Tool = {
  name: 'notion_create_page',
  description: 'Create a new page in a Notion database or as child of another page. Use notion_get_database first to see required properties.',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'creating documentation',
    'logging meeting notes',
    'writing project doc',
    'creating task in Notion database'
  ],
  parameters: {
    type: 'object',
    properties: {
      parent_id: {
        type: 'string',
        description: 'Parent page ID or database ID'
      },
      parent_type: {
        type: 'string',
        enum: ['page', 'database'],
        description: 'Type of parent (page or database)',
        default: 'page'
      },
      properties: {
        type: 'object',
        description: 'Page properties. For pages: {"title": {"title": [{"text": {"content": "My Title"}}]}}. For databases: match the database schema.'
      },
      content: {
        type: 'string',
        description: 'Page content in markdown format (optional)'
      },
      icon_emoji: {
        type: 'string',
        description: 'Emoji for page icon (e.g., "📝")'
      }
    },
    required: ['parent_id', 'properties']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const parent = input.parent_type === 'database'
        ? { database_id: input.parent_id }
        : { page_id: input.parent_id };

      const pageData: any = {
        parent,
        properties: input.properties,
      };

      if (input.content) {
        pageData.children = markdownToNotionBlocks(input.content);
      }

      if (input.icon_emoji) {
        pageData.icon = { type: 'emoji', emoji: input.icon_emoji };
      }

      const page = await notion.pages.create(pageData);

      return {
        success: true,
        page_id: page.id,
        url: (page as any).url,
        properties: formatProperties((page as any).properties),
        message: 'Page created successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionUpdatePage: Tool = {
  name: 'notion_update_page',
  description: 'Update a Notion page properties. Only include properties you want to change.',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'update page properties',
    'change page title',
    'modify database entry',
    'update task status'
  ],
  parameters: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'The page ID to update'
      },
      properties: {
        type: 'object',
        description: 'Properties to update'
      },
      archived: {
        type: 'boolean',
        description: 'Set to true to archive the page'
      }
    },
    required: ['page_id', 'properties']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const updateData: any = {
        page_id: input.page_id,
        properties: input.properties
      };
      if (input.archived !== undefined) {
        updateData.archived = input.archived;
      }

      const page = await notion.pages.update(updateData);

      return {
        success: true,
        page_id: page.id,
        url: (page as any).url,
        properties: formatProperties((page as any).properties),
        message: 'Page updated successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionAppendBlocks: Tool = {
  name: 'notion_append_blocks',
  description: 'Append content blocks to a Notion page. Supports markdown for simple content.',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'adding to existing doc',
    'appending notes',
    'updating documentation',
    'logging additional info'
  ],
  parameters: {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'Notion page or block ID to append to'
      },
      content: {
        type: 'string',
        description: 'Content to append (markdown format)'
      },
      children: {
        type: 'array',
        description: 'Array of block objects to append (alternative to content)'
      }
    },
    required: ['block_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      let blocks: any[];
      if (input.children) {
        blocks = input.children;
      } else if (input.content) {
        blocks = markdownToNotionBlocks(input.content);
      } else {
        return {
          success: false,
          error: 'Either content or children must be provided'
        };
      }

      const result = await notion.blocks.children.append({
        block_id: input.block_id,
        children: blocks as any
      });

      return {
        success: true,
        block_id: input.block_id,
        blocks_added: result.results.length,
        message: 'Content appended successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionDeleteBlock: Tool = {
  name: 'notion_delete_block',
  description: 'Delete (archive) a Notion block or page. The item can be restored from trash.',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'delete page',
    'remove block',
    'archive content',
    'delete database entry'
  ],
  parameters: {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The block or page ID to delete'
      }
    },
    required: ['block_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      await notion.blocks.delete({ block_id: input.block_id });

      return {
        success: true,
        archived_id: input.block_id,
        message: 'Block/page archived successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

// ============================================================================
// USER & WORKSPACE
// ============================================================================

export const notionGetMe: Tool = {
  name: 'notion_get_me',
  description: 'Get information about the current Notion integration/bot user',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'check bot identity',
    'verify API connection',
    'get bot user info'
  ],
  parameters: {
    type: 'object',
    properties: {}
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });
      const user = await notion.users.me({});

      return {
        success: true,
        user: {
          id: user.id,
          type: user.type,
          name: user.name,
          avatar_url: user.avatar_url,
          ...(user.type === 'bot' && { bot: (user as any).bot })
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionListUsers: Tool = {
  name: 'notion_list_users',
  description: 'List all users in the Notion workspace',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'list workspace members',
    'find user IDs',
    'see team members'
  ],
  parameters: {
    type: 'object',
    properties: {
      page_size: {
        type: 'number',
        description: 'Max users to return (1-100)'
      },
      start_cursor: {
        type: 'string',
        description: 'Cursor for pagination'
      }
    }
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const params: any = {};
      if (input.page_size) params.page_size = Math.min(input.page_size, 100);
      if (input.start_cursor) params.start_cursor = input.start_cursor;

      const result = await notion.users.list(params);

      const users = result.results.map((user: any) => ({
        id: user.id,
        type: user.type,
        name: user.name,
        avatar_url: user.avatar_url,
        ...(user.person && { email: user.person.email }),
      }));

      return {
        success: true,
        users,
        count: users.length,
        has_more: result.has_more,
        next_cursor: result.next_cursor
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

// ============================================================================
// COMMENTS
// ============================================================================

export const notionListComments: Tool = {
  name: 'notion_list_comments',
  description: 'List comments on a Notion page or block. Use this to read discussions and messages from collaborators.',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'read page comments',
    'view discussions',
    'check notifications',
    'read feedback'
  ],
  parameters: {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The page or block ID to get comments from'
      },
      page_size: {
        type: 'number',
        description: 'Max comments to return (1-100)'
      },
      start_cursor: {
        type: 'string',
        description: 'Cursor for pagination'
      }
    },
    required: ['block_id']
  },

  async handler(input, ctx: ToolContext) {
    try {
      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const params: any = { block_id: input.block_id };
      if (input.page_size) params.page_size = Math.min(input.page_size, 100);
      if (input.start_cursor) params.start_cursor = input.start_cursor;

      const result = await notion.comments.list(params);

      const comments = result.results.map((comment: any) => ({
        id: comment.id,
        created_time: comment.created_time,
        created_by: comment.created_by?.name || comment.created_by?.id,
        parent: comment.parent,
        discussion_id: comment.discussion_id,
        text: richTextToPlain(comment.rich_text),
      }));

      return {
        success: true,
        comments,
        count: comments.length,
        has_more: result.has_more,
        next_cursor: result.next_cursor
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

export const notionCreateComment: Tool = {
  name: 'notion_create_comment',
  description: 'Create a comment on a Notion page or reply to a discussion thread',
  category: 'docs',
  requiredEnv: ['NOTION_API_KEY'],
  use_cases: [
    'add page comment',
    'reply to discussion',
    'leave feedback',
    'post message'
  ],
  parameters: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'Page ID to create a new comment on (use this for new comments)'
      },
      discussion_id: {
        type: 'string',
        description: 'Discussion ID to reply to an existing thread (use this for replies)'
      },
      text: {
        type: 'string',
        description: 'The comment text'
      }
    },
    required: ['text']
  },

  async handler(input, ctx: ToolContext) {
    try {
      if (!input.page_id && !input.discussion_id) {
        return {
          success: false,
          error: 'Either page_id (for new comment) or discussion_id (for reply) is required'
        };
      }

      const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

      const params: any = {
        rich_text: [{ type: 'text', text: { content: input.text } }],
      };

      if (input.discussion_id) {
        params.discussion_id = input.discussion_id;
      } else {
        params.parent = { page_id: input.page_id };
      }

      const result = await notion.comments.create(params) as any;

      return {
        success: true,
        comment: {
          id: result.id,
          created_time: result.created_time,
          discussion_id: result.discussion_id,
          text: richTextToPlain(result.rich_text || []),
        },
        message: 'Comment created successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Notion API error: ${error.message}`
      };
    }
  }
};

// ============================================================================
// EXPORT ALL TOOLS
// ============================================================================

export const notionTools = [
  // Search & Discovery
  notionSearch,
  // Database Operations
  notionGetDatabase,
  notionQueryDatabase,
  notionCreateDatabase,
  // Page Operations
  notionGetPage,
  notionGetBlocks,
  notionCreatePage,
  notionUpdatePage,
  notionAppendBlocks,
  notionDeleteBlock,
  // User & Workspace
  notionGetMe,
  notionListUsers,
  // Comments
  notionListComments,
  notionCreateComment,
];
