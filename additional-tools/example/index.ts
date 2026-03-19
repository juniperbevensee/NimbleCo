/**
 * Example custom tool
 *
 * To use:
 * 1. Run: npx tsc -p additional-tools/tsconfig.json
 * 2. Add to .env: ADDITIONAL_TOOLS=example
 * 3. Restart: npm restart
 */

import { Tool } from '../../shared/tools/src/base';

export const exampleTools: Tool[] = [
  {
    name: 'hello_custom_tool',
    description: 'Example custom tool that greets the user',
    category: 'communication',  // Use existing category or create new one
    use_cases: [
      'Test custom tool loading',
      'Say hello',
      'Verify additional-tools integration',
    ],
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name to greet',
        },
      },
      required: ['name'],
    },
    handler: async (input: { name: string }, context: any) => {
      return {
        success: true,
        message: `Hello, ${input.name}! This is a custom tool from additional-tools/example.`,
        timestamp: new Date().toISOString(),
      };
    },
  },
  {
    name: 'get_custom_config',
    description: 'Get configuration from environment variables',
    category: 'communication',  // Use existing category or create new one
    use_cases: [
      'Check custom env vars',
      'Verify bot-specific configuration',
    ],
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: async (input: any, context: any) => {
      return {
        success: true,
        bot_id: process.env.BOT_ID,
        additional_tools: process.env.ADDITIONAL_TOOLS,
        custom_env_example: process.env.MY_CUSTOM_ENV_VAR || '(not set)',
        message: 'These env vars are loaded from your .env.{bot_id} file',
      };
    },
  },
];
