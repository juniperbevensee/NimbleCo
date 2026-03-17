/**
 * Database analytics tools for querying agent performance, costs, and execution logs
 *
 * These tools require admin permissions as they expose system-wide metrics
 */

import { Tool } from '../base';
import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Get or create database connection pool
 */
function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// All deprecated - these tools query empty legacy tables that are no longer used.
// Use invocation analytics tools instead (view_recent_invocations, etc.)
export const analyticsTools: Tool[] = [];
