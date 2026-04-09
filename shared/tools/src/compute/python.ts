/**
 * Python execution via Docker.
 *
 * Short jobs (background: false, default): synchronous, returns stdout inline.
 * Long jobs (background: true): detached Docker container, returns job ID immediately.
 *   A detached watcher subprocess posts to Mattermost once on error or completion.
 *   No periodic updates — call get_job_status if you need mid-flight status.
 *
 * Workspace is mounted at /workspace inside the container so scripts can read/write
 * files using the same paths as other NimbleCo workspace tools.
 * Scripts dir (agentic-osint/scripts/) is mounted read-only at /scripts.
 */

import { Tool, ToolContext } from '../base';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { getWorkspaceRoot } from '../workspace-helper';
import { writeJobStatus, readJobStatus } from './jobs';
import { randomUUID } from 'crypto';

const SCRIPTS_DIR = process.env.SCRIPTS_DIR ||
  path.resolve(process.cwd(), '../agentic-osint/agentic-osint/scripts');

const DOCKER_IMAGE = process.env.PYTHON_DOCKER_IMAGE || 'python:3.11-slim';

function buildDockerArgs(opts: {
  workspaceRoot: string;
  code?: string;
  scriptPath?: string;
  args?: Record<string, any>;
  packages?: string[];
  envVars?: Record<string, string>;
  outputFile?: string;
  detach?: boolean;
}): string[] {
  const dockerArgs: string[] = ['run'];

  if (opts.detach) dockerArgs.push('-d');
  else dockerArgs.push('--rm');

  // Mount workspace
  dockerArgs.push('-v', `${opts.workspaceRoot}:/workspace`);

  // Mount scripts dir read-only if it exists
  if (fs.existsSync(SCRIPTS_DIR)) {
    dockerArgs.push('-v', `${SCRIPTS_DIR}:/scripts:ro`);
  }

  // Set working dir to workspace
  dockerArgs.push('-w', '/workspace');

  // Pass args as JSON env var
  if (opts.args && Object.keys(opts.args).length > 0) {
    dockerArgs.push('-e', `ARGS=${JSON.stringify(opts.args)}`);
  }

  // Pass through any extra env vars
  if (opts.envVars) {
    for (const [k, v] of Object.entries(opts.envVars)) {
      dockerArgs.push('-e', `${k}=${v}`);
    }
  }

  dockerArgs.push(DOCKER_IMAGE);

  // Build the command
  const pipInstall = opts.packages && opts.packages.length > 0
    ? `pip install -q ${opts.packages.join(' ')} && `
    : '';

  if (opts.scriptPath) {
    const containerScriptPath = opts.scriptPath.startsWith('/scripts/')
      ? opts.scriptPath
      : `/scripts/${opts.scriptPath}`;
    dockerArgs.push('sh', '-c', `${pipInstall}python ${containerScriptPath}`);
  } else if (opts.code) {
    // Write code to a temp file to avoid shell escaping nightmares
    const tmpFile = path.join(opts.workspaceRoot, `.tmp_run_${Date.now()}.py`);
    fs.writeFileSync(tmpFile, opts.code, 'utf-8');
    dockerArgs.push('sh', '-c', `${pipInstall}python /workspace/${path.basename(tmpFile)}`);
  }

  return dockerArgs;
}

export const run_python: Tool = {
  name: 'run_python',
  description: `Execute Python code or a pre-written script via Docker.

For SHORT jobs (< ~2 min): omit background or set background: false. Waits for output and returns it inline.
For LONG jobs (processing large files, hash cracking, slow scrapers): set background: true. Returns a job ID immediately — you are free to respond to the user and handle other requests. The job posts to Mattermost automatically when it finishes or crashes. Use get_job_status to check mid-flight.

The container has full network access and the workspace mounted at /workspace (same files visible to read_workspace_file, write_workspace_file). Pre-written scripts are at /scripts/ inside the container.

OpenMeasures pipeline pattern: large JSON from an API call → write to /workspace/data.json → run_python reads it locally → returns analysis. Avoids context window bloat.`,
  category: 'compute',
  use_cases: [
    'Run LLM-generated Python code for custom analysis',
    'Process a large JSON or CSV file locally without sending to the LLM',
    'Run a pre-written OSINT script (use script parameter)',
    'Hash cracking or long-running computation (use background: true)',
    'Batch processing that needs Python libraries not available in TS tools',
    'Data science beyond what the built-in analytics tools cover',
  ],
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute. Use this for LLM-generated one-off scripts.',
      },
      script: {
        type: 'string',
        description: 'Filename of a pre-written script in the scripts library (e.g. "batch_dehashed.py"). Use list_scripts to see what\'s available.',
      },
      args: {
        type: 'object',
        description: 'Arguments passed to the script as JSON via the ARGS environment variable. Access in Python with: import os, json; args = json.loads(os.environ.get("ARGS", "{}"))',
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Python packages to pip install before running (e.g. ["requests", "pandas"]). Cached in Docker layer — first run may be slow.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds for synchronous jobs (default: 120). Ignored for background jobs.',
      },
      background: {
        type: 'boolean',
        description: 'Set true for long-running jobs. Returns job ID immediately; posts to Mattermost on completion or error. Default: false.',
      },
      output_file: {
        type: 'string',
        description: 'Workspace-relative path to capture stdout (e.g. "results/output.txt"). Useful for background jobs.',
      },
      description: {
        type: 'string',
        description: 'Human-readable label for the job (shown in Mattermost completion message).',
      },
    },
  },
  handler: async (input: {
    code?: string;
    script?: string;
    args?: Record<string, any>;
    packages?: string[];
    timeout?: number;
    background?: boolean;
    output_file?: string;
    description?: string;
  }, context: ToolContext) => {
    if (!input.code && !input.script) {
      return { success: false, error: 'Either code or script is required.' };
    }

    // Check Docker is available
    try {
      execSync('docker info', { stdio: 'ignore' });
    } catch {
      return { success: false, error: 'Docker is not running or not accessible. Start Docker and try again.' };
    }

    const workspaceRoot = getWorkspaceRoot();
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const dockerArgs = buildDockerArgs({
      workspaceRoot,
      code: input.code,
      scriptPath: input.script,
      args: input.args,
      packages: input.packages,
      detach: input.background,
    });

    // --- SYNCHRONOUS (short job) ---
    if (!input.background) {
      const timeoutMs = (input.timeout ?? 120) * 1000;
      try {
        const stdout = execSync(`docker ${dockerArgs.join(' ')}`, {
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB stdout buffer
          encoding: 'utf-8',
          cwd: workspaceRoot,
        });

        // Clean up temp script file if we wrote one
        cleanTempFiles(workspaceRoot);

        const output = stdout.trim();
        if (input.output_file) {
          const outPath = path.join(workspaceRoot, input.output_file);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, output, 'utf-8');
          return { success: true, output_file: input.output_file, preview: output.slice(0, 2000) };
        }
        return { success: true, output };
      } catch (err: any) {
        cleanTempFiles(workspaceRoot);
        return {
          success: false,
          error: err.stderr?.trim() || err.message,
          exit_code: err.status,
        };
      }
    }

    // --- BACKGROUND (long job) ---
    const jobId = randomUUID().slice(0, 8);

    // Start detached container
    let containerId: string;
    try {
      containerId = execSync(`docker ${dockerArgs.join(' ')}`, { encoding: 'utf-8' }).trim();
    } catch (err: any) {
      cleanTempFiles(workspaceRoot);
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
      tool: 'run_python',
      description: input.description,
      output_file: outputFile,
    });

    // Spawn detached watcher — posts to Mattermost on finish/error
    spawnWatcher({
      jobId,
      containerId,
      workspaceRoot,
      outputPath,
      outputFile,
      context,
      description: input.description,
    });

    // Post start notification if we have room context
    if (context.room_id && context.credentials.MATTERMOST_BOT_TOKEN) {
      postToMattermost(context, `⚙️ Job \`${jobId}\` started${input.description ? `: ${input.description}` : ''}. I'll post here when it finishes.`);
    }

    cleanTempFiles(workspaceRoot);

    return {
      success: true,
      job_id: jobId,
      message: `Background job started. Job ID: ${jobId}. Use get_job_status("${jobId}") to check status, or wait for the completion message.`,
    };
  },
};

function cleanTempFiles(workspaceRoot: string): void {
  try {
    const files = fs.readdirSync(workspaceRoot).filter(f => f.startsWith('.tmp_run_'));
    for (const f of files) {
      fs.unlinkSync(path.join(workspaceRoot, f));
    }
  } catch {
    // Ignore cleanup errors
  }
}

function spawnWatcher(opts: {
  jobId: string;
  containerId: string;
  workspaceRoot: string;
  outputPath: string;
  outputFile: string;
  context: ToolContext;
  description?: string;
}): void {
  // Inline watcher script — waits for container, captures logs, posts result
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

function jobsDir() {
  return path.join(workspaceRoot, '.jobs');
}

function updateStatus(patch) {
  const filePath = path.join(jobsDir(), jobId + '.json');
  try {
    const current = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    fs.writeFileSync(filePath, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
  } catch {}
}

function postMattermost(message) {
  if (!mattermostUrl || !botToken || !roomId) return;
  try {
    const body = JSON.stringify({ channel_id: roomId, message });
    spawnSync('curl', [
      '-s', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', \`Authorization: Bearer \${botToken}\`,
      '-d', body,
      \`\${mattermostUrl}/api/v4/posts\`,
    ], { stdio: 'ignore' });
  } catch {}
}

try {
  // Wait for container to finish (blocks until exit)
  const waitResult = spawnSync('docker', ['wait', containerId], { encoding: 'utf-8' });
  const exitCode = parseInt((waitResult.stdout || '1').trim(), 10);

  // Capture logs
  let logs = '';
  try {
    logs = execSync(\`docker logs \${containerId}\`, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
  } catch {}

  // Save stdout
  if (logs) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, logs, 'utf-8');
  }

  const finished = new Date().toISOString();
  const tail = logs.trim().split('\\n').slice(-10).join('\\n');

  if (exitCode === 0) {
    updateStatus({ status: 'done', finished, exit_code: 0, last_output: tail });
    const label = description ? \`: \${description}\` : '';
    postMattermost(\`✅ Job \\\`\${jobId}\\\`\${label} completed. Output saved to workspace/\${outputFile}.\${tail ? '\\n\`\`\`\\n' + tail.slice(0, 500) + '\\n\`\`\`' : ''}\`);
  } else {
    const errTail = logs.trim().split('\\n').slice(-20).join('\\n');
    updateStatus({ status: 'error', finished, exit_code: exitCode, last_output: errTail });
    const label = description ? \`: \${description}\` : '';
    postMattermost(\`❌ Job \\\`\${jobId}\\\`\${label} failed (exit \${exitCode}).\${errTail ? '\\n\`\`\`\\n' + errTail.slice(0, 800) + '\\n\`\`\`' : ''}\`);
  }

  // Remove container (already removed if --rm, safe to ignore error)
  try { execSync(\`docker rm -f \${containerId}\`, { stdio: 'ignore' }); } catch {}
} catch (err) {
  updateStatus({ status: 'error', error_message: err.message });
  postMattermost(\`❌ Job \\\`\${jobId}\\\` watcher error: \${err.message}\`);
}
`.trim();

  const watcher = spawn(process.execPath, ['-e', watcherCode], {
    detached: true,
    stdio: 'ignore',
  });
  watcher.unref();
}

async function postToMattermost(context: ToolContext, message: string): Promise<void> {
  if (!context.room_id || !context.credentials.MATTERMOST_URL || !context.credentials.MATTERMOST_BOT_TOKEN) return;
  try {
    await fetch(`${context.credentials.MATTERMOST_URL}/api/v4/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${context.credentials.MATTERMOST_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel_id: context.room_id, message }),
    });
  } catch {
    // Best-effort — don't fail the tool call if Mattermost is unreachable
  }
}
