/**
 * JavaScript sandbox execution tools for data science and computation
 */

import { Tool } from '../base';
import * as vm from 'vm';

/**
 * Execute JavaScript code in a sandboxed environment
 */
async function executeJavaScript(
  code: string,
  timeout: number = 30000
): Promise<{ output: string; result: any; error?: string }> {
  try {
    // Create a sandbox with limited capabilities
    const sandbox: any = {
      console: {
        log: (...args: any[]) => {
          sandbox.__output.push(args.map(a => String(a)).join(' '));
        },
        error: (...args: any[]) => {
          sandbox.__output.push('[ERROR] ' + args.map(a => String(a)).join(' '));
        },
        warn: (...args: any[]) => {
          sandbox.__output.push('[WARN] ' + args.map(a => String(a)).join(' '));
        },
      },
      __output: [] as string[],
      // Add common global functions
      setTimeout: undefined, // Block async operations
      setInterval: undefined,
      setImmediate: undefined,
      // Add Math for data science
      Math,
      // Add useful data processing helpers
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      RegExp,
      Map,
      Set,
      Promise: undefined, // Block promises
    };

    // Create context
    const context = vm.createContext(sandbox);

    // Wrap code to capture result
    const wrappedCode = `
      (function() {
        ${code}
      })()
    `;

    // Execute with timeout
    const result = vm.runInContext(wrappedCode, context, {
      timeout,
      displayErrors: true,
    });

    // Collect output
    const output = sandbox.__output.join('\n');

    return {
      output: output || '(no output)',
      result: result !== undefined ? result : null,
    };
  } catch (error: any) {
    return {
      output: '',
      result: null,
      error: error.message || String(error),
    };
  }
}

export const computeTools: Tool[] = [
  {
    name: 'execute_javascript',
    description: 'Execute JavaScript code in a sandboxed environment. Useful for data processing, calculations, and analysis. No async operations or I/O allowed.',
    category: 'compute',
    use_cases: [
      'Perform mathematical calculations',
      'Process and analyze data arrays',
      'Run statistical computations',
      'Transform and filter data',
      'Generate reports from data',
    ],
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. Use console.log() to print output. Return values are captured.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Execution timeout in milliseconds (default: 30000)',
        },
      },
      required: ['code'],
    },
    handler: async (input: any, context: any) => {
      const { code, timeout_ms } = input;

      if (!code || typeof code !== 'string') {
        return {
          success: false,
          error: 'Code parameter is required and must be a string',
        };
      }

      try {
        const result = await executeJavaScript(code, timeout_ms || 30000);

        if (result.error) {
          return {
            success: false,
            error: result.error,
            output: result.output,
          };
        }

        return {
          success: true,
          output: result.output,
          result: result.result,
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
