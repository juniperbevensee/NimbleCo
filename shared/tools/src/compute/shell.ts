/**
 * Shell command execution via Docker.
 * Same isolation pattern as run_python but for arbitrary bash commands.
 */

import { Tool, ToolContext } from '../base';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { getWorkspaceRoot } from '../workspace-helper';
import { writeJobStatus } from './jobs';
import { randomUUID } from 'crypto';

const DOCKER_IMAGE = process.env.PYTHON_DOCKER_IMAGE || 'python:3.11-slim';

export const run_shell: Tool = {
  name: 'run_shell',
  description: `Execute a shell command via Docker (bash). Same isolation as run_python.

Use for commands that aren't Python: curl pipelines, grep/awk/sed on files, wget, nmap, etc.
For Python work, prefer run_python.

For LONG jobs: set background: true. Returns job ID immediately; posts to Mattermost on completion or error.`,
  category: 'compute',
  use_cases: [
    'Run shell commands for file processing (grep, awk, sort, uniq)',
    'Download files with wget or curl',
    'Run any shell pipeline on workspace files',
  ],
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Bash command to execute. Workspace is at /workspace.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds for synchronous jobs (default: 120).',
      },
      background: {
        type: 'boolean',
        description: 'Set true for long-running commands. Returns job ID immediately.',
      },
      output_file: {
        type: 'string',
        description: 'Workspace-relative path to capture stdout.',
      },
      description: {
        type: 'string',
        description: 'Human-readable label for background jobs.',
      },
    },
    required: ['command'],
  },
  handler: async (input: {
    command: string;
    timeout?: number;
    background?: boolean;
    output_file?: string;
    description?: string;
  }, context: ToolContext) => {
    try {
      execSync('docker info', { stdio: 'ignore' });
    } catch {
      return { success: false, error: 'Docker is not running or not accessible.' };
    }

    const workspaceRoot = getWorkspaceRoot();
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const dockerArgsList = [
      'run',
      input.background ? '-d' : '--rm',
      '-v', `${workspaceRoot}:/workspace`,
      '-w', '/workspace',
      DOCKER_IMAGE,
      'bash', '-c', input.command,
    ];

    if (!input.background) {
      try {
        const stdout = execSync(`docker ${dockerArgsList.join(' ')}`, {
          timeout: (input.timeout ?? 120) * 1000,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf-8',
          cwd: workspaceRoot,
        });
        const output = stdout.trim();
        if (input.output_file) {
          const outPath = path.join(workspaceRoot, input.output_file);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, output, 'utf-8');
          return { success: true, output_file: input.output_file, preview: output.slice(0, 2000) };
        }
        return { success: true, output };
      } catch (err: any) {
        return { success: false, error: err.stderr?.trim() || err.message, exit_code: err.status };
      }
    }

    // Background
    const jobId = randomUUID().slice(0, 8);
    let containerId: string;
    try {
      containerId = execSync(`docker ${dockerArgsList.join(' ')}`, { encoding: 'utf-8' }).trim();
    } catch (err: any) {
      return { success: false, error: `Failed to start container: ${err.message}` };
    }

    const outputFile = input.output_file || `.jobs/${jobId}.stdout.txt`;
    const outputPath = path.join(workspaceRoot, outputFile);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    writeJobStatus({
      job_id: jobId,
      container_id: containerId,
      status: 'running',
      started: new Date().toISOString(),
      tool: 'run_shell',
      description: input.description,
      output_file: outputFile,
    });

    spawnWatcher({ jobId, containerId, workspaceRoot, outputPath, outputFile, context, description: input.description });

    if (context.room_id && context.credentials.MATTERMOST_BOT_TOKEN) {
      await postToMattermost(context, `⚙️ Job \`${jobId}\` started${input.description ? `: ${input.description}` : ''}. I'll post here when it finishes.`);
    }

    return {
      success: true,
      job_id: jobId,
      message: `Background job started. ID: ${jobId}. Use get_job_status("${jobId}") to check, or wait for the completion post.`,
    };
  },
};

function spawnWatcher(opts: {
  jobId: string;
  containerId: string;
  workspaceRoot: string;
  outputPath: string;
  outputFile: string;
  context: ToolContext;
  description?: string;
}): void {
  const watcherCode = `
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const jobId = ${JSON.stringify(opts.jobId)};
const containerId = ${JSON.stringify(opts.containerId)};
const workspaceRoot = ${JSON.stringify(opts.workspaceRoot)};
const outputPath = ${JSON.stringify(opts.outputPath)};
const outputFile = ${JSON.stringify(opts.outputFile)};
const mattermostUrl = ${JSON.stringify(opts.context.credentials.MATTERMOST_URL || '')};
const botToken = ${JSON.stringify(opts.context.credentials.MATTERMOST_BOT_TOKEN || '')};
const roomId = ${JSON.stringify(opts.context.room_id || '')};
const description = ${JSON.stringify(opts.description || '')};

function updateStatus(patch) {
  const filePath = path.join(workspaceRoot, '.jobs', jobId + '.json');
  try {
    const current = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    fs.writeFileSync(filePath, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
  } catch {}
}

function postMattermost(message) {
  if (!mattermostUrl || !botToken || !roomId) return;
  try {
    const body = JSON.stringify({ channel_id: roomId, message });
    spawnSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json',
      '-H', \`Authorization: Bearer \${botToken}\`, '-d', body,
      \`\${mattermostUrl}/api/v4/posts\`], { stdio: 'ignore' });
  } catch {}
}

try {
  const waitResult = spawnSync('docker', ['wait', containerId], { encoding: 'utf-8' });
  const exitCode = parseInt((waitResult.stdout || '1').trim(), 10);
  let logs = '';
  try { logs = execSync(\`docker logs \${containerId}\`, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }); } catch {}
  if (logs) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, logs, 'utf-8'); }
  const finished = new Date().toISOString();
  const tail = logs.trim().split('\\n').slice(-10).join('\\n');
  if (exitCode === 0) {
    updateStatus({ status: 'done', finished, exit_code: 0, last_output: tail });
    const label = description ? \`: \${description}\` : '';
    postMattermost(\`✅ Job \\\`\${jobId}\\\`\${label} completed.\${tail ? '\\n\`\`\`\\n' + tail.slice(0, 500) + '\\n\`\`\`' : ''}\`);
  } else {
    const errTail = logs.trim().split('\\n').slice(-20).join('\\n');
    updateStatus({ status: 'error', finished, exit_code: exitCode, last_output: errTail });
    const label = description ? \`: \${description}\` : '';
    postMattermost(\`❌ Job \\\`\${jobId}\\\`\${label} failed (exit \${exitCode}).\${errTail ? '\\n\`\`\`\\n' + errTail.slice(0, 800) + '\\n\`\`\`' : ''}\`);
  }
  try { execSync(\`docker rm -f \${containerId}\`, { stdio: 'ignore' }); } catch {}
} catch (err) {
  updateStatus({ status: 'error', error_message: err.message });
  postMattermost(\`❌ Job \\\`\${jobId}\\\` watcher error: \${err.message}\`);
}
`.trim();

  const watcher = spawn(process.execPath, ['-e', watcherCode], { detached: true, stdio: 'ignore' });
  watcher.unref();
}

async function postToMattermost(context: ToolContext, message: string): Promise<void> {
  if (!context.room_id || !context.credentials.MATTERMOST_URL || !context.credentials.MATTERMOST_BOT_TOKEN) return;
  try {
    await fetch(`${context.credentials.MATTERMOST_URL}/api/v4/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${context.credentials.MATTERMOST_BOT_TOKEN}` },
      body: JSON.stringify({ channel_id: context.room_id, message }),
    });
  } catch {}
}
