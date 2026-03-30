# Agent Lifecycle System - Testing Guide

## Quick Start Testing

This guide will walk you through testing the newly implemented Agent Lifecycle Management System.

---

## Prerequisites

### 1. Install PM2 (Required for Phase 1)

```bash
npm install -g pm2
```

Verify installation:
```bash
pm2 --version
# Should output version number (e.g., 5.3.0)
```

### 2. Ensure Database is Running

The Swarm-Map database should be running with the agents schema already migrated.

---

## Step-by-Step Test

### Step 1: Start Both Services

From the Swarm-Map root (runs both gateway and admin-ui):

```bash
cd /Users/juniperbevensee/Documents/GitHub/Swarm-Map
pnpm dev
```

**Or start individually:**

Terminal 1 - Gateway:
```bash
cd /Users/juniperbevensee/Documents/GitHub/Swarm-Map/packages/gateway
pnpm dev
```

Terminal 2 - Admin UI:
```bash
cd /Users/juniperbevensee/Documents/GitHub/Swarm-Map/packages/admin-ui
pnpm dev
```

**Expected console output**:
```
[Gateway] ========================================
[Gateway] Starting on port 4000
[Gateway] ========================================
[Gateway] Initializing adapters...
[Gateway] Checking deployment prerequisites...
[Gateway] ✓ PM2 available (version: 5.3.0)
[Gateway] ⚠ Docker not available - OpenClaw agents will not work
[Gateway] [PortAllocator] Initializing...
[Gateway] [PortAllocator] Initialized with 0 allocated ports
[Gateway] [LifecycleManager] Registered adapter: pm2
[Gateway] Agent Lifecycle Management System initialized
[Gateway] Swarm-Map Gateway running on port 4000

============================================================
🚀 Admin UI: http://localhost:4001
   Login password: admin
============================================================
```

✅ If you see this, the lifecycle system is ready!

---

### Step 2: Open Admin UI

Open browser to: **http://localhost:4001**

(Note: Ports auto-increment if occupied, check console output for actual port)

---

### Step 3: Import a NimbleCo Agent

If you haven't already imported a NimbleCo agent:

1. Navigate to **Agent Fleet** page
2. Click **"Import Agent"** button
3. Select **"NimbleCo Export"**
4. Browse to: `/Users/juniperbevensee/Documents/GitHub/NimbleCo`
5. Select a profile (e.g., `nimbleco-personal`)
6. Click **Import**

The agent should appear in the list with status "stopped" ⚫

---

### Step 4: Test Starting an Agent

1. Find your imported NimbleCo agent in the list
2. Click the **Play button** (▶️)

**What should happen**:
- Button shows loading spinner
- Status changes: stopped → starting (🟡) → running (🟢)
- Agent row updates with running status

**Verify in terminal**:
```bash
pm2 list
```

You should see:
```
┌─────┬──────────────────┬─────────┬─────────┬──────────┐
│ id  │ name             │ status  │ restart │ uptime   │
├─────┼──────────────────┼─────────┼─────────┼──────────┤
│ 0   │ nimble-personal  │ online  │ 0       │ 5s       │
└─────┴──────────────────┴─────────┴─────────┴──────────┘
```

✅ If you see the process in PM2, the start operation worked!

---

### Step 5: Check Logs

View the agent's logs:

```bash
pm2 logs nimble-personal --lines 20
```

You should see the NimbleCo agent's initialization logs.

---

### Step 6: Check Status via API

```bash
# Replace {AGENT_ID} with your actual agent ID
curl -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/status | jq
```

**Expected response**:
```json
{
  "success": true,
  "agentId": "...",
  "runtimeInfo": {
    "status": "running",
    "pid": 12345,
    "uptime": 30,
    "startedAt": "2026-03-30T04:00:00.000Z",
    "metadata": {
      "pm2Id": 0,
      "restartCount": 0
    }
  }
}
```

---

### Step 7: Check Metrics

```bash
curl -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/metrics | jq
```

**Expected response**:
```json
{
  "success": true,
  "agentId": "...",
  "metrics": {
    "cpuPercent": 0.5,
    "memoryMb": 120,
    "uptimeSeconds": 45,
    "metadata": {
      "restartCount": 0
    }
  }
}
```

---

### Step 8: Test Stopping an Agent

1. In Admin UI, find your running agent
2. Click the **Stop button** (⏹️)

**What should happen**:
- Button shows loading spinner
- Status changes: running → stopping (🟠) → stopped (⚫)
- Agent row updates with stopped status

**Verify in terminal**:
```bash
pm2 list
```

The process should no longer be in the list.

✅ If the process is gone from PM2, the stop operation worked!

---

### Step 9: Test Restart

1. Start the agent again (Play button)
2. Wait for it to be running
3. Use the API to restart:

```bash
curl -X POST -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/restart
```

**What should happen**:
- Agent stops
- Wait 2 seconds
- Agent starts again
- New PID assigned

**Verify**:
```bash
pm2 list
```

The process should be there with restart count = 0 (it's a fresh start, not a PM2 restart).

---

### Step 10: Test Error Handling

#### Test 1: Try starting an already running agent

1. Ensure agent is running
2. Click Play button again

**Expected**: Error message in UI:
```
Failed to start agent: Agent nimbleco-personal is already running (PM2 name: nimble-personal)
```

#### Test 2: Try stopping a stopped agent

1. Ensure agent is stopped
2. Click Stop button

**Expected**: Operation succeeds silently (already stopped)

#### Test 3: Start with missing PM2

1. Stop PM2: `pm2 kill`
2. Try starting an agent

**Expected**: Error message:
```
Failed to start agent: Deployment method pm2 is not available. Please ensure it is installed.
```

3. Restart PM2: `pm2 resurrect` or restart gateway

---

## API Testing Examples

### Get Agent Status
```bash
# Gateway runs on port 4000 (check console for actual port)
curl -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/status
```

### Start Agent
```bash
curl -X POST -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/start
```

### Stop Agent (Graceful)
```bash
curl -X POST \
  -H "X-User-Id: admin" \
  -H "Content-Type: application/json" \
  -d '{"graceful": true}' \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/stop
```

### Restart Agent
```bash
curl -X POST -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/restart
```

### Get Health Check
```bash
curl -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/health
```

### Get Metrics
```bash
curl -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/metrics
```

### Get Logs (50 lines)
```bash
curl -H "X-User-Id: admin" \
  "http://localhost:4000/api/admin/agents/{AGENT_ID}/logs?lines=50"
```

---

## Troubleshooting

### Issue: PM2 not found

**Symptoms**:
```
[Gateway] ⚠ PM2 not available - NimbleCo agents will not work
```

**Solution**:
```bash
npm install -g pm2
# Restart gateway
```

---

### Issue: Agent stuck in "starting" state

**Symptoms**: Status shows starting (🟡) for > 10 seconds

**Debug steps**:
1. Check PM2: `pm2 list`
2. Check PM2 logs: `pm2 logs`
3. Check gateway logs for error messages
4. Verify NimbleCo path and .env file exist

**Common causes**:
- NimbleCo script not found at `coordinator/dist/main.js`
- .env file missing for profile
- Script crashed immediately after start

---

### Issue: Database status doesn't match PM2

**Symptoms**: UI shows "running" but `pm2 list` shows nothing

**Solution**: The lifecycle manager syncs on every operation. Try:
1. Click Stop button (will sync state)
2. Click Start button (will start correctly)

Or call the status endpoint:
```bash
curl -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents/{AGENT_ID}/status
```

---

### Issue: "Agent not found" error

**Symptoms**: API returns 500 with "Agent not found: {ID}"

**Cause**: Invalid agent ID

**Solution**:
1. List all agents:
```bash
curl -H "X-User-Id: admin" \
  http://localhost:4000/api/admin/agents | jq '.agents[].id'
```

2. Use the correct UUID

---

### Issue: Environment variables not injected

**Symptoms**: Agent starts but has no API keys

**Debug steps**:
1. Check if swarm is assigned to agent (check database)
2. Check if keys are bound to agent (agentKeyBindings table)
3. Check gateway logs for decryption errors
4. Verify swarm password is set in environment

**Solution**:
- Ensure agent has a swarmId
- Bind required keys via Admin UI (API Keys page)
- Set SWARM_{SLUG}_PASSWORD in gateway environment

---

## Expected Behavior Summary

| Action | Initial Status | Expected Transition | Final Status | PM2 Status |
|--------|---------------|---------------------|--------------|------------|
| Start  | stopped       | stopped → starting → running | running | online |
| Stop   | running       | running → stopping → stopped | stopped | (not in list) |
| Restart| running       | running → stopping → stopped → starting → running | running | online |
| Start (already running) | running | (error) | running | online |
| Stop (already stopped) | stopped | (no-op) | stopped | (not in list) |

---

## Success Criteria Checklist

After testing, verify:

- [ ] ✅ Play button starts NimbleCo agent
- [ ] ✅ Process appears in PM2: `pm2 list`
- [ ] ✅ Status updates to "running" in UI
- [ ] ✅ Green status icon (🟢) shown
- [ ] ✅ Stop button stops agent
- [ ] ✅ Process disappears from PM2
- [ ] ✅ Status updates to "stopped" in UI
- [ ] ✅ Loading spinner shows during operations
- [ ] ✅ Clear error messages for failures
- [ ] ✅ No crashes when starting already running agent
- [ ] ✅ No crashes when stopping already stopped agent
- [ ] ✅ API endpoints return correct data
- [ ] ✅ Metrics show CPU and memory usage
- [ ] ✅ Logs can be retrieved via API

If all checkboxes are ✅, Phase 1 MVP is working correctly!

---

## Performance Testing

### Test Multiple Agents

1. Import multiple NimbleCo profiles
2. Start all agents concurrently
3. Verify all start successfully
4. Check port allocation (no conflicts)
5. Stop all agents

**Expected**: All agents start/stop cleanly, no port conflicts

---

### Test Rapid Start/Stop

1. Start an agent
2. Immediately stop it
3. Immediately start it again

**Expected**: Operations queue properly, final state is correct

---

### Stress Test

Start/stop 10 agents in rapid succession:

```bash
for i in {1..10}; do
  curl -X POST -H "X-User-Id: admin" \
    http://localhost:4000/api/admin/agents/{AGENT_ID}/start
  sleep 5
  curl -X POST -H "X-User-Id: admin" \
    http://localhost:4000/api/admin/agents/{AGENT_ID}/stop
done
```

**Expected**: No crashes, all operations complete successfully

---

## Next Steps

After successful testing:

1. **Report Results**: Document any issues found
2. **Phase 2 Planning**: Prepare for Docker Compose adapter (OpenClaw)
3. **Phase 3 Planning**: Design monitoring and health check services
4. **Production Deployment**: Plan rollout strategy

---

## Getting Help

If you encounter issues:

1. Check gateway logs
2. Check PM2 logs: `pm2 logs`
3. Review implementation summary: `LIFECYCLE_IMPLEMENTATION_SUMMARY.md`
4. Review adapter README: `/packages/gateway/src/adapters/deployment/README.md`

---

## Test Report Template

Use this template to document your test results:

```markdown
# Agent Lifecycle System - Test Report

**Date**: 2026-03-30
**Tester**: [Your Name]
**Environment**: Development

## Test Results

### Prerequisites
- [ ] PM2 installed and available
- [ ] Gateway starts without errors
- [ ] Admin UI accessible

### Core Functionality
- [ ] Agent import works
- [ ] Start agent works
- [ ] Stop agent works
- [ ] Restart agent works
- [ ] Status endpoint works
- [ ] Metrics endpoint works
- [ ] Logs endpoint works

### Error Handling
- [ ] Handles "already running" correctly
- [ ] Handles "already stopped" correctly
- [ ] Shows clear error messages
- [ ] Database stays in sync on errors

### UI
- [ ] Play button updates correctly
- [ ] Stop button updates correctly
- [ ] Loading states work
- [ ] Status icons correct
- [ ] Error messages display

## Issues Found

1. [Issue description]
   - Severity: High/Medium/Low
   - Steps to reproduce
   - Expected vs Actual behavior

## Performance

- Agent start time: [X] seconds
- Agent stop time: [X] seconds
- Concurrent agents tested: [X]

## Recommendations

[Any recommendations for improvements]

## Conclusion

[Pass/Fail with summary]
```

---

**Ready to test!** Follow the steps above and report any issues. Phase 1 MVP should be fully functional.
