"use strict";
/**
 * Background job tracking for long-running Docker processes.
 *
 * Jobs write their state to WORKSPACE/.jobs/<job_id>.json.
 * The get_job_status tool reads this file — no polling, no DB required.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_job_status = void 0;
exports.getJobsDir = getJobsDir;
exports.writeJobStatus = writeJobStatus;
exports.readJobStatus = readJobStatus;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const workspace_helper_1 = require("../workspace-helper");
function getJobsDir() {
    return path.join((0, workspace_helper_1.getWorkspaceRoot)(), '.jobs');
}
function writeJobStatus(status) {
    const dir = getJobsDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${status.job_id}.json`), JSON.stringify(status, null, 2), 'utf-8');
}
function readJobStatus(jobId) {
    const filePath = path.join(getJobsDir(), `${jobId}.json`);
    if (!fs.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
exports.get_job_status = {
    name: 'get_job_status',
    description: 'Check the status of a background job started with run_python or run_shell (background: true). Returns current status, elapsed time, and any captured output. Jobs post to Mattermost automatically on completion or error — only call this if you need to check mid-flight.',
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
    handler: async (input, _context) => {
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
//# sourceMappingURL=jobs.js.map