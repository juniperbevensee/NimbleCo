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
import { Tool } from '../base';
export declare const run_python: Tool;
//# sourceMappingURL=python.d.ts.map