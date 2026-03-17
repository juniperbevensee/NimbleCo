/**
 * Audit Logger
 *
 * Logs destructive and sensitive operations to database for security auditing
 */

import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export interface AuditLogEntry {
  userId?: string;
  agentId?: string;
  operation: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, any>;
  result: 'success' | 'failure';
  errorMessage?: string;
  invocationId?: string;
}

/**
 * Log an operation to the audit trail
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const db = getPool();

    await db.query(
      `
      INSERT INTO audit_log
        (user_id, agent_id, operation, resource_type, resource_id, details, result, error_message, invocation_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        entry.userId,
        entry.agentId,
        entry.operation,
        entry.resourceType,
        entry.resourceId,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.result,
        entry.errorMessage,
        entry.invocationId,
      ]
    );
  } catch (error) {
    // Don't throw - audit logging failure shouldn't break operations
    console.error('⚠️  Failed to write audit log:', error);
  }
}

/**
 * Operations that should be audited
 */
export const AuditOperations = {
  DELETE_FILE: 'delete_file',
  DELETE_DIRECTORY: 'delete_directory',
  RECURSIVE_DELETE: 'recursive_delete',
  READ_ANALYTICS: 'read_analytics',
  READ_CONVERSATION: 'read_conversation',
  EXPORT_DATA: 'export_data',
  EXECUTE_CODE: 'execute_code',
  WEB_FETCH: 'web_fetch',
} as const;
