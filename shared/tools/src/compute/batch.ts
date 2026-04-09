/**
 * Batch lookup tool — run a list of targets through any registered tool without
 * consuming a coordinator LLM turn per item.
 *
 * Typical use: process 50 emails through osint_dehashed_search in one tool call,
 * get back a consolidated results object, optionally written to a workspace file.
 */

import { Tool, ToolContext } from '../base';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot } from '../workspace-helper';
import { registry } from '../index';

export const batch_lookup: Tool = {
  name: 'batch_lookup',
  description:
    'Run a list of targets (emails, usernames, company names, IPs, etc.) through any registered tool, one call per target, with controlled concurrency. Returns consolidated results and optionally writes them to a workspace JSON file. Use this instead of calling a tool in a loop — it completes in one LLM turn regardless of list size.',
  category: 'compute',
  use_cases: [
    'Look up a list of emails in Dehashed breach database',
    'Search a list of company names in OpenCorporates',
    'Run WHOIS on a list of domains',
    'Batch any OSINT lookup across a list of targets',
    'Process a CSV column of identifiers through a tool and save results',
  ],
  parameters: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of values to look up (emails, usernames, domains, IPs, etc.)',
      },
      tool: {
        type: 'string',
        description: 'Name of the registered tool to call for each target (e.g. "osint_dehashed_search", "osint_whois_lookup")',
      },
      input_field: {
        type: 'string',
        description: 'The parameter name to pass each target into (e.g. "email", "domain", "username", "ip")',
      },
      extra_params: {
        type: 'object',
        description: 'Additional fixed parameters to include in every call (e.g. {"size": 10})',
      },
      concurrency: {
        type: 'number',
        description: 'Max parallel calls at once (default: 3, max: 10). Higher = faster but more API pressure.',
      },
      output_file: {
        type: 'string',
        description: 'Workspace-relative path to write results JSON (e.g. "results/dehashed_batch.json"). If omitted, results are returned inline.',
      },
    },
    required: ['targets', 'tool', 'input_field'],
  },
  handler: async (input: {
    targets: string[];
    tool: string;
    input_field: string;
    extra_params?: Record<string, any>;
    concurrency?: number;
    output_file?: string;
  }, context: ToolContext) => {
    const { targets, tool: toolName, input_field, extra_params = {}, output_file } = input;
    const concurrency = Math.min(input.concurrency ?? 3, 10);

    const targetTool = registry.getTool(toolName);
    if (!targetTool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found. Available tools: ${registry.getAllNames().join(', ')}`,
      };
    }

    const results: Array<{ target: string; result: any; error?: string }> = [];
    let completed = 0;
    let errors = 0;

    // Process in batches of `concurrency`
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (target) => {
          try {
            const toolInput = { [input_field]: target, ...extra_params };
            const result = await targetTool.handler(toolInput, context);
            completed++;
            return { target, result };
          } catch (err: any) {
            errors++;
            return { target, result: null, error: err.message };
          }
        })
      );
      results.push(...batchResults);
    }

    const summary = {
      tool: toolName,
      total: targets.length,
      completed,
      errors,
      results,
    };

    if (output_file) {
      const workspaceRoot = getWorkspaceRoot();
      const outputPath = path.join(workspaceRoot, output_file);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
      return {
        success: true,
        total: targets.length,
        completed,
        errors,
        output_file: output_file,
        message: `Results written to workspace/${output_file}. Use read_workspace_file to inspect.`,
        // Return a small preview inline so the LLM has something to work with
        preview: results.slice(0, 3).map(r => ({ target: r.target, result: r.result })),
      };
    }

    return summary;
  },
};
