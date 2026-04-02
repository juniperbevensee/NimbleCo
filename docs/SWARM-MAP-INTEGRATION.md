# Swarm-Map Integration

This document describes how NimbleCo integrates with Swarm-Map for tool access control and policy enforcement.

## Overview

NimbleCo can optionally integrate with [Swarm-Map](https://github.com/yourusername/Swarm-Map) to enforce fine-grained tool access policies. This enables:

- **Tool-level access control**: Restrict which tools users can access
- **Group-based permissions**: Organize users into groups with different access tiers
- **Audit trail**: Track all tool access attempts and policy decisions
- **Centralized management**: Configure policies in Swarm-Map UI, enforced across all agents

## Architecture

### Two-Way Integration

```
┌─────────────┐                  ┌─────────────┐
│             │  Start/Stop      │             │
│  Swarm-Map  │ ────────────────>│  NimbleCo   │
│   Gateway   │                  │  Coordinator│
│             │  Inject Secrets  │             │
│             │ ────────────────>│             │
└─────────────┘                  └─────────────┘
       ^                                 │
       │         Policy Checks           │
       └─────────────────────────────────┘
```

### Policy Enforcement Flow

1. **Schema Filtering** (Before LLM):
   - NimbleCo calls `/api/policy/filter-tools` with all available tools
   - Swarm-Map checks user group membership and tool tiers
   - Returns allowed tool list
   - Only allowed tools shown in LLM's tool schema (reduces context window)

2. **Execution Guard** (Before Tool Execution):
   - User requests tool execution via LLM
   - NimbleCo calls `/api/policy/check` before executing tool
   - Swarm-Map validates access based on real-time policy
   - Tool executes only if allowed

## Configuration

### Environment Variables

Add these to your `.env` file to enable policy enforcement:

```bash
# Policy Enforcement (optional)
POLICY_CHECK_URL=http://localhost:4000  # Swarm-Map gateway URL (default port)
POLICY_CHECK_TIMEOUT=5000               # Timeout in ms (default: 5000)
POLICY_CHECK_DEBUG=false                # Enable debug logging (default: false)
```

### Standalone Mode (Default)

If `POLICY_CHECK_URL` is **not set** or **empty**, NimbleCo runs in **standalone mode**:
- All tools allowed for all users
- No external policy service calls
- No group-based restrictions
- Suitable for single-user or fully-trusted environments

### Policy-Enforced Mode

If `POLICY_CHECK_URL` is set, NimbleCo connects to Swarm-Map for policy checks:
- Tools filtered based on user group membership
- Real-time access control enforcement
- Audit trail in Swarm-Map database
- Fail-open behavior: if Swarm-Map is unreachable, allows access (configurable)

## Swarm-Map Setup

### 1. Install and Start Swarm-Map

```bash
# Clone Swarm-Map repository
git clone https://github.com/yourusername/Swarm-Map.git
cd Swarm-Map

# Install dependencies
npm install

# Configure database
cp .env.example .env
# Edit .env with PostgreSQL credentials

# Start gateway
npm run gateway
```

Swarm-Map gateway will start on `http://localhost:4000` by default (configurable via `GATEWAY_PORT` environment variable).

### 2. Import NimbleCo Agent

1. Open Swarm-Map UI: `http://localhost:3000`
2. Navigate to **Agents** → **Import Agent**
3. Enter NimbleCo connection details:
   - **Agent ID**: `nimble-personal` (or your bot ID)
   - **NATS URL**: `nats://localhost:4222`
   - **Subjects**: `tasks.nimble-personal`, `tasks.orchestrator`

### 3. Configure Tool Tiers

1. Navigate to **Tools** in Swarm-Map UI
2. Assign tools to tiers:
   - **High**: Sensitive tools (bash, file write, database access)
   - **Medium**: Standard tools (GitHub, Notion, web search)
   - **Low**: Read-only tools (file read, web fetch)

### 4. Create User Groups

1. Navigate to **Groups**
2. Create groups with different access levels:
   - **Admins**: High + Medium + Low tier access
   - **Developers**: Medium + Low tier access
   - **Viewers**: Low tier access only

3. Add users to groups:
   - Use Mattermost user IDs (e.g., `abc123def456ghi789jkl012mn`)

## Usage Examples

### Example 1: Admin User (Full Access)

User `alice` is in the **Admins** group with access to all tiers.

**Request**: "Execute `ls -la` in the project directory"

**Flow**:
1. NimbleCo receives message from Alice
2. Calls `/api/policy/filter-tools` → returns all tools including `bash`
3. LLM sees `bash` tool in schema
4. LLM generates `bash` tool call
5. Calls `/api/policy/check` for `bash` tool → **allowed**
6. Executes bash command
7. Returns results to Alice

### Example 2: Developer User (Limited Access)

User `bob` is in the **Developers** group with Medium + Low tier access (no High tier).

**Request**: "Execute `rm -rf /` to clean up"

**Flow**:
1. NimbleCo receives message from Bob
2. Calls `/api/policy/filter-tools` → returns tools excluding `bash` (High tier)
3. LLM does **not** see `bash` tool in schema
4. LLM responds: "I don't have access to bash execution tools"
5. No execution attempted

### Example 3: Policy Change (Real-time)

Admin changes policy in Swarm-Map to deny Bob access to `github_create_issue` tool.

**Bob's next request**: "Create a GitHub issue"

**Flow**:
1. NimbleCo receives message from Bob
2. Calls `/api/policy/filter-tools` → returns tools excluding `github_create_issue`
3. LLM does **not** see tool in schema
4. LLM responds with alternative suggestions

**Note**: Policy changes take effect immediately (health check cache expires after 30s max).

## Testing

### Unit Tests

Test policy client configuration:

```bash
cd coordinator
npm test -- policy-configuration.test.ts
```

### Integration Tests

Test policy filtering and execution guards with mocks:

```bash
npm test -- policy-integration.test.ts
```

### E2E Tests

Test full HTTP integration with mock Swarm-Map server:

```bash
npm test -- policy-e2e.test.ts
```

### Manual Testing

1. Start Swarm-Map gateway:
   ```bash
   cd /path/to/Swarm-Map
   npm run gateway
   ```

2. Configure NimbleCo:
   ```bash
   cd /path/to/NimbleCo
   echo "POLICY_CHECK_URL=http://localhost:4000" >> .env
   echo "POLICY_CHECK_DEBUG=true" >> .env
   ```

3. Start NimbleCo:
   ```bash
   npm start
   ```

4. Send test messages in Mattermost as different users

5. Check logs for policy decisions:
   ```
   🔐 Policy enforcement enabled: http://localhost:4000
   [HttpPolicyClient] checkBatchAccess(15 tools): 15 results, 12 allowed
   🔐 Policy filtering applied (12 tools allowed)
   ```

## Troubleshooting

### Policy Service Unreachable

**Symptom**: Logs show `Policy service unavailable (fail-open)`

**Causes**:
- Swarm-Map gateway not running
- Wrong `POLICY_CHECK_URL` configured
- Network connectivity issues

**Resolution**:
1. Verify Swarm-Map is running: `curl http://localhost:4000/api/policy/health`
2. Check `POLICY_CHECK_URL` matches gateway URL
3. NimbleCo will **fail-open** (allow all tools) until service is reachable

### Tools Not Filtered

**Symptom**: Users see tools they shouldn't have access to

**Causes**:
- Policy client in standalone mode (no `POLICY_CHECK_URL` set)
- User not in any groups (defaults to allow-all)
- Tool not assigned to any tier (defaults to allow-all)

**Resolution**:
1. Verify `POLICY_CHECK_URL` is set: `echo $POLICY_CHECK_URL`
2. Check user group membership in Swarm-Map UI
3. Verify tools are assigned to tiers

### All Tools Denied

**Symptom**: LLM says it has no tools available

**Causes**:
- User in group with no tier access
- All tools in restricted tiers
- Policy service returning incorrect results

**Resolution**:
1. Check user's group tier access in Swarm-Map UI
2. Verify tools are correctly tiered
3. Enable debug logging: `POLICY_CHECK_DEBUG=true`
4. Review policy check responses in logs

### Performance Issues

**Symptom**: Slow response times when using tools

**Causes**:
- Policy service taking too long to respond
- Network latency to Swarm-Map
- Too many tools being checked

**Resolution**:
1. Increase timeout: `POLICY_CHECK_TIMEOUT=10000`
2. Deploy Swarm-Map on same host/network as NimbleCo
3. Health check caches availability for 30s to reduce overhead
4. Use batch API (`/api/policy/filter-tools`) instead of individual checks

## Security Considerations

### Fail-Open Behavior

By default, if Swarm-Map is unreachable, NimbleCo **allows all tool access**. This prioritizes availability over security.

To change to **fail-closed** (deny all on service failure), modify `HttpPolicyClient`:

```typescript
// In shared/tools/src/policy/http-client.ts
async checkAccess(request: PolicyCheckRequest): Promise<PolicyCheckResult> {
  try {
    // ... existing code ...
  } catch (error) {
    // Change this:
    return { allowed: true, reason: 'Policy service unavailable (fail-open)' };

    // To this:
    return { allowed: false, reason: 'Policy service unavailable (fail-closed)' };
  }
}
```

**Trade-off**: Fail-closed is more secure but reduces availability. If Swarm-Map goes down, all tool access is blocked.

### Credential Isolation

NimbleCo **never sends credentials** to Swarm-Map during policy checks. Only metadata is sent:
- User ID
- Tool name
- Platform context

Credentials remain local to NimbleCo and are injected at tool execution time.

### Audit Trail

All policy checks are logged in Swarm-Map's database:
- Timestamp
- User ID
- Tool name
- Decision (allowed/denied)
- Reason

This provides accountability and helps debug access issues.

## Advanced Configuration

### Per-Bot Policy URLs

Use different policy services for different bot personas:

```bash
# .env.personal
POLICY_CHECK_URL=http://localhost:4000

# .env.osint
POLICY_CHECK_URL=http://localhost:4001

# .env.cryptid (no policy enforcement)
# POLICY_CHECK_URL not set
```

### Custom Health Check Interval

Modify health check cache duration in `HttpPolicyClient`:

```typescript
// shared/tools/src/policy/http-client.ts
private healthCheckInterval: number = 30000; // 30 seconds

// Change to:
private healthCheckInterval: number = 60000; // 60 seconds
```

Longer intervals reduce API calls but delay detection of service outages.

### Policy-Aware Error Messages

When tools are denied, customize error messages shown to users:

```typescript
// In coordinator/src/main.ts
try {
  await guardToolExecution(toolName, context, this.policyClient);
} catch (error) {
  // Custom message for user
  return {
    success: false,
    error: `⛔ Access denied: You don't have permission to use this tool. Contact your admin to request access.`
  };
}
```

## API Reference

### Swarm-Map Policy API

#### `GET /api/policy/health`

Check if policy service is available.

**Response**:
```json
{
  "available": true
}
```

#### `POST /api/policy/check`

Check if user can access a specific tool.

**Request**:
```json
{
  "userId": "user123",
  "toolName": "bash",
  "metadata": {
    "platform": "mattermost",
    "teamId": "team456"
  }
}
```

**Response**:
```json
{
  "allowed": true,
  "tier": "high",
  "groups": ["admins"]
}
```

#### `POST /api/policy/filter-tools`

Batch check tool access for schema filtering.

**Request**:
```json
{
  "userId": "user123",
  "tools": [
    { "name": "bash", "category": "compute" },
    { "name": "github_create_issue", "category": "integrations" }
  ],
  "metadata": {
    "platform": "mattermost",
    "teamId": "team456"
  }
}
```

**Response**:
```json
{
  "results": [
    {
      "name": "bash",
      "allowed": false,
      "reason": "Tool requires High tier, user has Medium+Low",
      "tier": "high"
    },
    {
      "name": "github_create_issue",
      "allowed": true,
      "tier": "medium"
    }
  ]
}
```

## Related Documentation

- [Swarm-Map README](../../../Swarm-Map/README.md)
- [NimbleCo Architecture](./ARCHITECTURE.md)
- [Tool Development Guide](./TOOL-DEVELOPMENT.md)
- [Security Best Practices](./SECURITY.md)

## Support

For issues or questions:
- NimbleCo: [GitHub Issues](https://github.com/yourusername/NimbleCo/issues)
- Swarm-Map: [GitHub Issues](https://github.com/yourusername/Swarm-Map/issues)
- Documentation updates: Submit PRs to respective repositories
