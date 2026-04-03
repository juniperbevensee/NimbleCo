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

### 7. ✅ DM Access Control

Block direct messages (DMs) with optional user whitelist. Forces public accountability while allowing specific trusted users.

**Configuration** (per bot via `.env.*` files):
```bash
# Block all DMs except whitelisted users (default: true)
MATTERMOST_BLOCK_DMS=true

# Comma-separated list of Mattermost user IDs allowed to DM this bot
MATTERMOST_ALLOWED_USERS=user_id_1,user_id_2,user_id_3
```

**Behavior**:
- **DMs from non-whitelisted users**: Politely rejected with message directing to public channels
- **DMs from whitelisted users**: Processed normally
- **Public channels**: Always allowed (all users)
- **Private channels**: Allowed if bot is a member

**Logging**:
```bash
🚫 Blocked DM from non-whitelisted user: abc123xyz
✅ Allowed DM from whitelisted user: trusted_user_id
```

**Use Cases**:
- Personal bots: Only owner can DM
- Team bots: Public interactions required (transparency, shared knowledge)
- Private bots: Specific users whitelisted for sensitive operations

**Example**:
```bash
# .env.personal (audrey_personal bot)
MATTERMOST_BLOCK_DMS=true
MATTERMOST_ALLOWED_USERS=juniper_user_id

# .env.cryptid (team bot)
MATTERMOST_BLOCK_DMS=true
MATTERMOST_ALLOWED_USERS=juniper_user_id,trusted_dev_id
```

**To disable** (allow all DMs):
```bash
MATTERMOST_BLOCK_DMS=false
```

**Security Benefits**:
- Prevents unauthorized private access to personal bots
- Encourages public channel usage (shared learning, transparency)
- Admin bypass built-in (admins automatically whitelisted if needed)

## Remaining Recommendations

### ~~VM Sandbox Replacement~~ ✅ COMPLETED

**Update (April 2, 2026)**: This has been implemented!

**Current Implementation**: `isolated-vm` with true V8 isolation
- See `shared/tools/src/compute/javascript.ts`
- Separate V8 isolate (cannot access parent process)
- Configurable memory limits (default 128MB)
- CPU timeout protection (default 30s)
- Safe for untrusted code execution
- Provides sandboxed `fs.readFileSync()` for workspace/storage only

**Status**: ✅ Complete - `isolated-vm` provides production-grade isolation for code execution.

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

## 7. ✅ Prompt Injection Sanitization

All web and social media content is sanitized before being passed to the LLM to prevent prompt injection attacks.

**Location**: `shared/tools/src/sanitization/index.ts`

**Protected Tools**:
- `web_search` - Brave Search results
- `fetch_webpage` - Web page content
- `search_social_media` - OpenMeasures social posts (CRITICAL - user-generated adversarial content)

**Sanitization Layers**:
1. **Unicode normalization** - NFC normalization to prevent homograph attacks
2. **Zero-width character removal** - Strips invisible Unicode (U+200B-U+2064)
3. **HTML/control character stripping** - Removes tags and control chars
4. **Suspicious pattern detection** - 25+ regex patterns for jailbreaks, system markers, encoding indicators
5. **Injection scoring** - 0-1 confidence score for attack likelihood

**Monitored Patterns**:
- Direct instruction attempts: "ignore previous instructions"
- System prompt manipulation: `[INST]`, `<|im_start|>`, `<system>`
- Role-playing jailbreaks: "act as DAN", "unrestricted mode"
- Encoding obfuscation: "base64", "decode", "rot13"
- Boundary escapes: `</untrusted_web_content>`, `</system>`

**Logging**:
```bash
# Suspicious content is logged to console with flags
🚨 Suspicious web search result: ['Suspicious pattern detected: /ignore\s+previous/']
🚨 HIGH RISK social media content detected: Score: 0.78, Platform: telegram
```

High-risk content (score >0.6) automatically logged with platform, flags, and preview.

**Based on**: Digital-Cryptids implementation + OWASP LLM Top 10 (2025) research

### Future Enhancements (Roadmap)

**Medium Priority**:
- **Homograph detection**: Map Cyrillic/Greek lookalikes (а→a, е→e, etc.)
- **RTL/LTR override protection**: Strip U+202E/U+202D directional marks
- **Boundary validation**: Checksum/signing of `<untrusted_web_content>` wrapper
- **Encoding detection**: Flag Base64/hex obfuscation attempts

**Low Priority**:
- **Monitoring dashboard**: View injection attempts, top sources, pattern frequency
- **Rate limiting**: Slow down repeated injection attempts from same source
- **ML-based detection**: Catch novel attacks not covered by regex patterns

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
| Input | Prompt injection sanitization | ✅ Implemented |
| Access | DM blocking with whitelist | ✅ Implemented |
| Code Execution | isolated-vm isolation | ✅ Implemented |

## Notes

- Security is an ongoing process - review and update regularly
- Monitor audit logs for suspicious patterns
- Rate limits can be adjusted in `shared/tools/src/rate-limit/limiter.ts`
- Add security@yourdomain.com to receive reports
