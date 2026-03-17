// Direct Notion API integration - comprehensive and practical
// Better than MCP because we expose the full API power

import { Client } from '@notionhq/client';
import { Tool, ToolContext } from '../base';

interface NotionBlock {
  type: string;
  [key: string]: any;
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

export const createNotionPage: Tool = {
  name: 'create_notion_page',
  description: 'Create a new page in Notion with markdown content. Can create in a database or as a child of another page.',
  category: 'docs',
  use_cases: [
    'creating documentation',
    'logging meeting notes',
    'writing project doc',
    'creating task in Notion database'
  ],
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Page title'
      },
      content: {
        type: 'string',
        description: 'Page content in markdown format'
      },
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
      icon_emoji: {
        type: 'string',
        description: 'Emoji for page icon (e.g., "📝")'
      }
    },
    required: ['title', 'content', 'parent_id']
  },

  async handler(input, ctx: ToolContext) {
    const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

    const blocks = markdownToNotionBlocks(input.content);

    const parent = input.parent_type === 'database'
      ? { database_id: input.parent_id }
      : { page_id: input.parent_id };

    const pageData: any = {
      parent,
      properties: {
        title: {
          title: [{ text: { content: input.title } }]
        }
      },
      children: blocks
    };

    if (input.icon_emoji) {
      pageData.icon = { type: 'emoji', emoji: input.icon_emoji };
    }

    const page = await notion.pages.create(pageData);

    return {
      success: true,
      page_id: page.id,
      url: (page as any).url,
      message: `Created Notion page: ${input.title}`
    };
  }
};

export const appendNotionPage: Tool = {
  name: 'append_to_notion_page',
  description: 'Add content to an existing Notion page (appends to the end)',
  category: 'docs',
  use_cases: [
    'adding to existing doc',
    'appending notes',
    'updating documentation',
    'logging additional info'
  ],
  parameters: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'Notion page ID to append to'
      },
      content: {
        type: 'string',
        description: 'Content to append (markdown format)'
      }
    },
    required: ['page_id', 'content']
  },

  async handler(input, ctx: ToolContext) {
    const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

    const blocks = markdownToNotionBlocks(input.content);

    await notion.blocks.children.append({
      block_id: input.page_id,
      children: blocks as any
    });

    return {
      success: true,
      page_id: input.page_id,
      message: 'Content appended to Notion page'
    };
  }
};

export const searchNotion: Tool = {
  name: 'search_notion',
  description: 'Search across all Notion pages and databases you have access to',
  category: 'docs',
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
        description: 'Search query'
      },
      filter: {
        type: 'string',
        enum: ['page', 'database'],
        description: 'Filter results by type (optional)'
      }
    },
    required: ['query']
  },

  async handler(input, ctx: ToolContext) {
    const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

    const searchParams: any = { query: input.query };

    if (input.filter) {
      searchParams.filter = { property: 'object', value: input.filter };
    }

    const results = await notion.search(searchParams);

    const formatted = results.results.map((item: any) => {
      const title = item.properties?.title?.title?.[0]?.plain_text ||
                    item.properties?.Name?.title?.[0]?.plain_text ||
                    'Untitled';

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
      count: formatted.length
    };
  }
};

export const readNotionPage: Tool = {
  name: 'read_notion_page',
  description: 'Read content from a Notion page (returns blocks as structured data)',
  category: 'docs',
  use_cases: [
    'reading existing documentation',
    'fetching page content',
    'retrieving information from Notion'
  ],
  parameters: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'Notion page ID to read'
      }
    },
    required: ['page_id']
  },

  async handler(input, ctx: ToolContext) {
    const notion = new Client({ auth: ctx.credentials.NOTION_API_KEY });

    // Get page properties
    const page = await notion.pages.retrieve({ page_id: input.page_id });

    // Get page content (blocks)
    const blocks = await notion.blocks.children.list({
      block_id: input.page_id,
      page_size: 100
    });

    // Convert blocks to readable text
    const content = blocks.results.map((block: any) => {
      if (block.type === 'paragraph') {
        return block.paragraph.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type.startsWith('heading_')) {
        const level = block.type.split('_')[1];
        const text = block[block.type].rich_text.map((t: any) => t.plain_text).join('');
        return '#'.repeat(parseInt(level)) + ' ' + text;
      } else if (block.type === 'bulleted_list_item') {
        return '- ' + block.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type === 'code') {
        const code = block.code.rich_text.map((t: any) => t.plain_text).join('');
        return `\`\`\`${block.code.language}\n${code}\n\`\`\``;
      }
      return '';
    }).filter(Boolean).join('\n\n');

    return {
      success: true,
      page_id: input.page_id,
      url: (page as any).url,
      content,
      block_count: blocks.results.length
    };
  }
};

export const createNotionDatabase: Tool = {
  name: 'create_notion_database',
  description: 'Create a new database in Notion (like a table or task list)',
  category: 'docs',
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
        description: 'Database properties (columns). Example: {"Status": {"type": "select"}, "Due Date": {"type": "date"}}',
        additionalProperties: true
      }
    },
    required: ['title', 'parent_page_id']
  },

  async handler(input, ctx: ToolContext) {
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
  }
};

export const notionTools = [
  createNotionPage,
  appendNotionPage,
  searchNotion,
  readNotionPage,
  createNotionDatabase
];
