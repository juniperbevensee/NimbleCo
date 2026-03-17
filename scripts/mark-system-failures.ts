#!/usr/bin/env ts-node
/**
 * Mark System Failures - Training Data Cleanup
 *
 * Use this to manually mark invocations as system failures after bugs occur.
 * These get excluded from training data so bad system behavior doesn't get learned.
 *
 * Usage:
 *   # Mark specific invocations
 *   npm run mark-failures -- --invocation-id abc123 --type recursion
 *
 *   # Mark all from a conversation in a time range
 *   npm run mark-failures -- --channel red-team --after "2026-03-16 18:00" --type recursion
 *
 *   # Auto-detect retry clusters
 *   npm run mark-failures -- --detect-retries
 */

import { Pool } from 'pg';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://agent:change-this-password@localhost:5432/nimbleco',
});

async function markInvocationAsFailure(invocationId: string, failureType: string) {
  await db.query(
    'UPDATE invocations SET is_system_failure = true, failure_type = $1 WHERE id = $2',
    [failureType, invocationId]
  );
  console.log(`✓ Marked ${invocationId.substring(0, 8)} as ${failureType}`);
}

async function markChannelFailures(channel: string, after: string, failureType: string) {
  const result = await db.query(
    `SELECT i.id
     FROM invocations i
     JOIN conversations c ON i.conversation_id = c.id
     WHERE c.room_id LIKE $1
     AND i.started_at > $2
     AND i.is_system_failure = false`,
    [`%${channel}%`, after]
  );

  console.log(`Found ${result.rows.length} invocations to mark as ${failureType}`);

  for (const row of result.rows) {
    await markInvocationAsFailure(row.id, failureType);
  }
}

async function detectAndMarkRetryClusters() {
  const result = await db.query('SELECT * FROM detect_retry_clusters()');

  console.log(`Found ${result.rows.length} retry clusters`);

  for (const cluster of result.rows) {
    // Record the cluster
    await db.query(
      `INSERT INTO retry_clusters
       (user_id, conversation_id, first_invocation_id, last_invocation_id,
        retry_count, time_span_seconds, is_system_bug)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (user_id, first_invocation_id) DO NOTHING`,
      [
        cluster.user_id,
        cluster.conversation_id,
        cluster.invocation_ids[0],
        cluster.invocation_ids[cluster.invocation_ids.length - 1],
        cluster.retry_count,
        cluster.time_span_seconds
      ]
    );

    // Mark all invocations in cluster
    for (const invId of cluster.invocation_ids) {
      await markInvocationAsFailure(invId, 'error_loop');
    }

    console.log(`✓ Marked retry cluster: ${cluster.retry_count} attempts over ${cluster.time_span_seconds}s`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--detect-retries')) {
    await detectAndMarkRetryClusters();
  } else if (args.includes('--invocation-id')) {
    const idIndex = args.indexOf('--invocation-id');
    const typeIndex = args.indexOf('--type');
    const id = args[idIndex + 1];
    const type = args[typeIndex + 1] || 'unknown';
    await markInvocationAsFailure(id, type);
  } else if (args.includes('--channel')) {
    const channelIndex = args.indexOf('--channel');
    const afterIndex = args.indexOf('--after');
    const typeIndex = args.indexOf('--type');
    const channel = args[channelIndex + 1];
    const after = args[afterIndex + 1];
    const type = args[typeIndex + 1] || 'unknown';
    await markChannelFailures(channel, after, type);
  } else {
    console.log(`
Usage:
  npm run mark-failures -- --invocation-id <id> --type <type>
  npm run mark-failures -- --channel <channel> --after "2026-03-16 18:00" --type <type>
  npm run mark-failures -- --detect-retries

Failure types: recursion, timeout, error_loop, crash, unknown
    `);
  }

  await db.end();
}

main().catch(console.error);
