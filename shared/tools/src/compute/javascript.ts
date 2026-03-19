/**
 * JavaScript sandbox execution tools for data science and computation
 *
 * Uses isolated-vm for true V8 isolation with resource limits.
 * - Separate V8 isolate (cannot access parent process)
 * - Configurable memory limits (default 128MB)
 * - CPU timeout protection
 * - Safe for untrusted code execution
 */

import { Tool } from '../base';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot, getFileStorageRoot } from '../workspace-helper';

// Use require() for isolated-vm since it exports on prototype (not compatible with import *)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ivm: any = require('isolated-vm');

/**
 * Execute JavaScript code in a sandboxed environment using isolated-vm
 */
async function executeJavaScript(
  code: string,
  timeout: number = 30000,
  memoryLimit: number = 128
): Promise<{ output: string; result: any; error?: string }> {
  let isolate: any = null;

  try {
    // Create isolated V8 instance with memory limit
    isolate = new ivm.Isolate({ memoryLimit });

    // Create context within the isolate
    const context = await isolate.createContext();

    // Storage for console output
    const outputLines: string[] = [];

    // Set up console.log to capture output
    const jail = context.global;
    await jail.set('global', jail.derefInto());

    // Create console object with log/error/warn
    await jail.set('_outputLines', new ivm.Reference(outputLines));
    await jail.set('_consoleLog', new ivm.Reference((...args: any[]) => {
      outputLines.push(args.map(a => String(a)).join(' '));
    }));
    await jail.set('_consoleError', new ivm.Reference((...args: any[]) => {
      outputLines.push('[ERROR] ' + args.map(a => String(a)).join(' '));
    }));
    await jail.set('_consoleWarn', new ivm.Reference((...args: any[]) => {
      outputLines.push('[WARN] ' + args.map(a => String(a)).join(' '));
    }));

    // Add safe fs.readFileSync for reading workspace files
    // Restricted to storage and workspace directories only (both bot-isolated)
    const workspaceRoot = getWorkspaceRoot();
    const storageRoot = getFileStorageRoot();

    await jail.set('_readFileSyncImpl', new ivm.Reference((filepath: string, encoding?: string) => {
      const resolvedPath = path.resolve(filepath);

      // Security: only allow reading from workspace or storage
      const isInWorkspace = resolvedPath.startsWith(path.resolve(workspaceRoot));
      const isInStorage = resolvedPath.startsWith(path.resolve(storageRoot));

      if (!isInWorkspace && !isInStorage) {
        throw new Error(`Access denied: can only read files from workspace (${workspaceRoot}) or storage (${storageRoot})`);
      }

      return fs.readFileSync(resolvedPath, (encoding as BufferEncoding) || 'utf-8');
    }));

    // Set up console, fs, and result storage in the isolated context
    await context.eval(`
      globalThis.console = {
        log: function(...args) {
          _consoleLog.applySync(undefined, args);
        },
        error: function(...args) {
          _consoleError.applySync(undefined, args);
        },
        warn: function(...args) {
          _consoleWarn.applySync(undefined, args);
        }
      };

      // Provide fs.readFileSync for reading workspace files
      globalThis.fs = {
        readFileSync: function(filepath, encoding) {
          return _readFileSyncImpl.applySync(undefined, [filepath, encoding || 'utf-8']);
        }
      };

      globalThis.__capturedResult = undefined;
    `);

    // Wrap code to capture return value in the isolated context
    const wrappedCode = `
      globalThis.__capturedResult = (function() {
        ${code}
      })();
    `;

    // Compile and run the code with timeout (convert ms to seconds for isolated-vm)
    const script = await isolate.compileScript(wrappedCode);
    await script.run(context, { timeout: Math.ceil(timeout / 1000) });

    // Extract the result by reading it from the context
    const resultHandle = await jail.get('__capturedResult', { reference: true });
    let resultValue = null;

    if (resultHandle) {
      try {
        resultValue = await resultHandle.copy();
        resultHandle.release();
      } catch (copyError) {
        try {
          // Try copySync if copy() fails
          resultValue = resultHandle.copySync();
          resultHandle.release();
        } catch {
          resultHandle.release();
          resultValue = '[Non-transferable Object]';
        }
      }
    }

    const output = outputLines.join('\n');

    // Clean up
    isolate.dispose();

    return {
      output: output || '(no output)',
      result: resultValue,
    };
  } catch (error: any) {
    // Clean up on error
    if (isolate) {
      isolate.dispose();
    }

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
    description: 'Execute JavaScript code in a truly isolated sandbox with memory and CPU limits. ⚠️ USE THIS for processing large workspace files instead of read_workspace_file! Has access to fs.readFileSync() for reading files locally without token waste. Perfect for counting, filtering, aggregating, and analyzing large datasets. ⚠️ IMPORTANT: fs is globally available - DO NOT use require("fs"), just use fs.readFileSync() directly.',
    category: 'compute',
    use_cases: [
      '✅ BEST PRACTICE: Process large JSON files from workspace (use fs.readFileSync() - NO require needed!)',
      '✅ Count, filter, aggregate, and analyze datasets without sending to LLM',
      'Perform mathematical calculations and statistical computations',
      'Transform and filter arrays and objects',
      'Generate summaries and reports from large data',
      'Parse and process any data format locally',
    ],
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. ⚠️ CRITICAL: Do NOT use require() - fs is already available globally. Use fs.readFileSync() directly. ⚠️ For output, use console.log(JSON.stringify(data)) - return values may fail to transfer. Example: const data = JSON.parse(fs.readFileSync("/path/to/file.json", "utf-8")); console.log(JSON.stringify({result: "processed"}));',
        },
        timeout_ms: {
          type: 'number',
          description: 'Execution timeout in milliseconds (default: 30000)',
        },
        memory_limit_mb: {
          type: 'number',
          description: 'Memory limit in MB (default: 128)',
        },
      },
      required: ['code'],
    },
    handler: async (input: any, context: any) => {
      const { code, timeout_ms, memory_limit_mb } = input;

      if (!code || typeof code !== 'string') {
        return {
          success: false,
          error: 'Code parameter is required and must be a string',
        };
      }

      try {
        const result = await executeJavaScript(
          code,
          timeout_ms || 30000,
          memory_limit_mb || 128
        );

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
