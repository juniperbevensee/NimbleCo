/**
 * Agent Memory Tools
 *
 * Tools for reading and writing to Audrey's persistent memory file.
 * The memory file is append-only for learned preferences to maintain history.
 */

import { Tool } from '../base';
import * as fs from 'fs/promises';
import { getMemoryFilePath, getBotStorageRoot } from '../workspace-helper';

export const memoryTools: Tool[] = [
  {
    name: 'read_agent_memory',
    description: 'Read my persistent memory file containing learned preferences and session notes',
    category: 'storage',
    use_cases: [
      'Recall learned preferences and values',
      'Check what I already know',
      'Review session notes',
      'Understand my memory about relationships and communication',
    ],
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async (input: any, context: any) => {
      try {
        const content = await fs.readFile(getMemoryFilePath(), 'utf-8');

        return {
          success: true,
          content,
          path: getMemoryFilePath(),
        };
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return {
            success: false,
            error: 'Memory file not found. It may need to be created.',
          };
        }
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  },
  {
    name: 'append_agent_memory',
    description: 'Add a new learned preference or important note to my persistent memory (append-only)',
    category: 'storage',
    use_cases: [
      'Remember a new preference or value',
      'Store an important learning',
      'Record a significant interaction or boundary',
      'Add context about relationships',
    ],
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The preference or note to add. Should be a complete thought.',
        },
        date: {
          type: 'string',
          description: 'Optional date in YYYY-MM-DD format. Defaults to today.',
        },
      },
      required: ['content'],
    },
    handler: async (input: any, context: any) => {
      try {
        const { content } = input;
        const date = input.date || new Date().toISOString().split('T')[0];

        if (!content || content.trim().length === 0) {
          return {
            success: false,
            error: 'Content cannot be empty',
          };
        }

        // Read current memory file
        let currentContent = '';
        try {
          currentContent = await fs.readFile(getMemoryFilePath(), 'utf-8');
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
          // File doesn't exist, will create it
        }

        // Find the "# Session Notes" section and insert before it
        const sessionNotesIndex = currentContent.indexOf('# Session Notes');

        const newEntry = `- ${date}: ${content}\n`;

        let updatedContent: string;
        if (sessionNotesIndex !== -1) {
          // Insert before Session Notes section
          updatedContent =
            currentContent.slice(0, sessionNotesIndex) +
            newEntry +
            currentContent.slice(sessionNotesIndex);
        } else {
          // Just append to the end
          updatedContent = currentContent + '\n' + newEntry;
        }

        await fs.writeFile(getMemoryFilePath(), updatedContent, 'utf-8');

        return {
          success: true,
          message: 'Memory added successfully',
          added: newEntry.trim(),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  },
  {
    name: 'update_session_notes',
    description: 'Update the ephemeral session notes section (cleared on restart)',
    category: 'storage',
    use_cases: [
      'Track temporary context for this session',
      'Note things relevant only to current conversation',
      'Store working state that doesn\'t need to persist',
    ],
    parameters: {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description: 'Session notes to write (replaces existing session notes)',
        },
      },
      required: ['notes'],
    },
    handler: async (input: any, context: any) => {
      try {
        const { notes } = input;

        // Read current memory file
        let currentContent = await fs.readFile(getMemoryFilePath(), 'utf-8');

        // Find and replace Session Notes section
        const sessionNotesIndex = currentContent.indexOf('# Session Notes');

        if (sessionNotesIndex === -1) {
          return {
            success: false,
            error: 'Session Notes section not found in memory file',
          };
        }

        // Keep everything before Session Notes, then add new session notes
        const beforeSessionNotes = currentContent.slice(0, sessionNotesIndex);
        const updatedContent = beforeSessionNotes +
          '# Session Notes\n' +
          '<!-- Ephemeral: Cleared on each restart -->\n\n' +
          notes + '\n';

        await fs.writeFile(getMemoryFilePath(), updatedContent, 'utf-8');

        return {
          success: true,
          message: 'Session notes updated successfully',
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  },
];
