/**
 * Background job tracking for long-running Docker processes.
 *
 * Jobs write their state to WORKSPACE/.jobs/<job_id>.json.
 * The get_job_status tool reads this file — no polling, no DB required.
 */

import { Tool, ToolContext } from '../base';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot } from '../workspace-helper';

export interface JobStatus {
  job_id: string;
  container_id: string;
  status: 'running' | 'done' | 'error';
  started: string;           // ISO timestamp
  finished?: string;
  elapsed_seconds?: number;
  exit_code?: number;
  last_output?: string;      // tail of stdout
  error_message?: string;
  output_file?: string;      // workspace path of full stdout capture
  tool: string;              // 'run_python' | 'run_shell'
  description?: string;      // human label from the tool call
}

export function getJobsDir(): string {
  return path.join(getWorkspaceRoot(), '.jobs');
}

export function writeJobStatus(status: JobStatus): void {
  const dir = getJobsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${status.job_id}.json`),
    JSON.stringify(status, null, 2),
    'utf-8'
  );
}

export function readJobStatus(jobId: string): JobStatus | null {
  const filePath = path.join(getJobsDir(), `${jobId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as JobStatus;
  } catch {
    return null;
  }
}

export const get_job_status: Tool = {
  name: 'get_job_status',
  description:
    'Check the status of a background job started with run_python or run_shell (background: true). Returns current status, elapsed time, and any captured output. Jobs post to Mattermost automatically on completion or error — only call this if you need to check mid-flight.',
  category: 'compute',
  use_cases: [
    'Check if a long-running Python script has finished',
    'See the output of a background job',
    'Check if a background process errored out',
  ],
  parameters: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The job ID returned when starting a background job',
      },
    },
    required: ['job_id'],
  },
  handler: async (input: { job_id: string }, _context: ToolContext) => {
    const status = readJobStatus(input.job_id);

    if (!status) {
      return {
        success: false,
        error: `Job '${input.job_id}' not found. Check the job ID or the job may have been cleaned up.`,
      };
    }

    const elapsed = status.finished
      ? status.elapsed_seconds
      : Math.floor((Date.now() - new Date(status.started).getTime()) / 1000);

    return {
      job_id: status.job_id,
      status: status.status,
      started: status.started,
      finished: status.finished,
      elapsed_seconds: elapsed,
      exit_code: status.exit_code,
      last_output: status.last_output,
      error_message: status.error_message,
      output_file: status.output_file,
      description: status.description,
    };
  },
};
