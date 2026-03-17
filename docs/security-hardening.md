# Security Hardening

Security measures implemented in NimbleCo to protect against malicious operations and abuse.

## Implemented Protections

### 1. ✅ Audit Logging

All destructive and sensitive operations are logged to the database for security auditing.

**Database Table**: `audit_log`

**Logged Operations**:
- File deletions (`delete_file`)
- Directory deletions (`delete_directory`)
- Recursive deletes (`recursive_delete`)
- Analytics queries (`read_analytics`)
- Code execution (`execute_code`)
- Web fetches (`web_fetch`)

**Query audit logs**:
```sql
-- Recent destructive operations
SELECT * FROM audit_log
WHERE operation IN ('delete_file', 'recursive_delete')
ORDER BY timestamp DESC
LIMIT 50;

-- Failed operations (potential attacks)
SELECT * FROM audit_log
WHERE result = 'failure'
ORDER BY timestamp DESC;

-- Operations by user
SELECT operation, COUNT(*) as count
FROM audit_log
WHERE user_id = 'user_id_here'
GROUP BY operation;
```

### 2. ✅ Rate Limiting

In-memory rate limiting prevents abuse of filesystem and compute operations.

**Limits** (per user, per minute):
- Filesystem operations: 100 requests
- Code execution: 20 requests
- Web fetching: 30 requests
- Analytics queries: 50 requests

**Behavior**:
- Returns clear error message when exceeded
- Automatic reset after window expires
- Non-breaking: Only enforced when `user_id` is available

**Error Example**:
```
⚠️ Rate limit exceeded. Try again in 42 seconds. (0 requests remaining in window)
```

### 3. ✅ Recursive Delete Protection

Multiple safeguards prevent accidental workspace destruction:

**Protections**:
- ❌ Cannot delete workspace root (`.`, `/`, empty path)
- ✅ Counts files before recursive delete (for audit logging)
- ✅ Clear warning in tool description
- ✅ Audit log includes file count and result

**Blocked Example**:
```javascript
delete_directory({ path: ".", recursive: true })
// Returns: "Safety: Cannot delete workspace root. Specify a subdirectory."
```

### 4. ✅ Web Fetch SSRF Protection

Prevents Server-Side Request Forgery attacks against internal services.

**Blocked Targets**:
- `localhost`, `127.0.0.1`, `::1`
- Private IP ranges: `192.168.x.x`, `10.x.x.x`, `172.x.x.x`
- AWS metadata endpoint: `169.254.169.254`
- Explicit GET-only (no POST data exfiltration)
- 10-second timeout
- Only HTML/text content types

**Error Example**:
```
Failed to fetch http://localhost:5432: Access to internal/private networks is blocked for security
```

### 5. ✅ Filesystem Sandbox

All filesystem operations are restricted to `./workspace` directory.

**Protections**:
- Path validation prevents directory traversal (`../`)
- Symlink resolution checks boundaries
- Clear error messages for violations

**Memory Tools Exception**:
- `read_agent_memory`, `append_agent_memory`, `update_session_notes`
- Hardcoded access to `storage/memory.md` only
- Privileged tools for agent self-management

### 6. ✅ Tool Permission System

Fine-grained access control for sensitive operations.

**Permission Types**:
- **Public tools**: Available to everyone (default)
- **Admin-only**: Requires admin privileges
- **Context-restricted**: Non-admins limited to current room or public channels

**Example**: Analytics tools
- Non-admins: Can analyze current room or any public channel
- Admins: Can analyze any channel from DMs (prevents leaking into shared rooms)

See [Tool Permissions](./tool-permissions.md) for details.

## Remaining Recommendations

### VM Sandbox Replacement (Future Work)

**Current**: Node's `vm` module is NOT a security boundary
- Known escape vectors via constructor manipulation
- Can potentially access `process`, `require`, `child_process`

**Options**:
1. **isolated-vm** - Real V8 isolate with secure boundary
2. **Docker containers** - Full OS-level isolation
3. **WebAssembly** - Limited but secure execution

**Trade-offs**:
- Breaking change for existing code execution
- Increased complexity and resource usage
- May affect performance

**Status**: Deferred - `vm` module is acceptable for trusted users, but should be upgraded for multi-tenant deployments.

## Testing Security

### Stress Tests

Safe tests to verify security boundaries:

```bash
# 1. Test filesystem sandbox
"Read the file at ../../../etc/passwd"
# Expected: Access denied error

# 2. Test workspace root protection
"Delete everything in your workspace recursively"
# Expected: "Cannot delete workspace root"

# 3. Test SSRF protection
"Fetch http://localhost:5432"
# Expected: "Access to internal networks blocked"

# 4. Test rate limiting (spam 101 file writes)
for i in {1..101}; do
  "Write 'test' to file test$i.txt"
done
# Expected: Rate limit error after 100

# 5. Test permission system
# (As non-admin) "Analyze logs for [private channel]"
# Expected: Permission denied
```

### Audit Log Analysis

Check for suspicious patterns:

```sql
-- High-frequency operations (potential spam)
SELECT user_id, operation, COUNT(*) as count
FROM audit_log
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY user_id, operation
HAVING COUNT(*) > 50
ORDER BY count DESC;

-- Failed permission checks (potential attacks)
SELECT *
FROM audit_log
WHERE details->>'blocked' = 'true'
ORDER BY timestamp DESC;

-- Recursive deletes (potentially dangerous)
SELECT *
FROM audit_log
WHERE operation = 'recursive_delete'
AND result = 'success'
ORDER BY timestamp DESC;
```

## Security Reporting

Found a security issue? Please report responsibly:

1. **Do not** open public GitHub issues
2. Email: [security contact - add your email]
3. Include: Description, reproduction steps, impact assessment

## Defense in Depth Summary

| Layer | Protection | Status |
|-------|------------|--------|
| Network | SSRF blocking | ✅ Implemented |
| Filesystem | Sandbox boundary | ✅ Implemented |
| Operations | Rate limiting | ✅ Implemented |
| Deletions | Root protection | ✅ Implemented |
| Permissions | Role-based access | ✅ Implemented |
| Audit | Operation logging | ✅ Implemented |
| Code Execution | VM isolation | ⚠️ Limited (future) |

## Notes

- Security is an ongoing process - review and update regularly
- Monitor audit logs for suspicious patterns
- Rate limits can be adjusted in `shared/tools/src/rate-limit/limiter.ts`
- Add security@yourdomain.com to receive reports
