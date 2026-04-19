/**
 * Background job tracking for long-running Docker processes.
 *
 * Jobs write their state to WORKSPACE/.jobs/<job_id>.json.
 * The get_job_status tool reads this file — no polling, no DB required.
 */
import { Tool } from '../base';
export interface JobStatus {
    job_id: string;
    container_id: string;
    status: 'running' | 'done' | 'error';
    started: string;
    finished?: string;
    elapsed_seconds?: number;
    exit_code?: number;
    last_output?: string;
    error_message?: string;
    output_file?: string;
    tool: string;
    description?: string;
}
export declare function getJobsDir(): string;
export declare function writeJobStatus(status: JobStatus): void;
export declare function readJobStatus(jobId: string): JobStatus | null;
export declare const get_job_status: Tool;
//# sourceMappingURL=jobs.d.ts.map