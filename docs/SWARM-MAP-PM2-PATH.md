# Swarm-Map Integration: PM2 Script Path

## The Issue

The PM2 script path (where the compiled main.js file is located) must be consistent across:

1. **NimbleCo**: `pm2.config.js` script path
2. **Swarm-Map**: `PM2Adapter.ts` and `agent-import.ts` scriptPath

If these get out of sync, Swarm-Map won't be able to start/restart NimbleCo agents.

## Current Configuration

**Path:** `coordinator/dist/coordinator/src/main.js`

This path comes from TypeScript compiling `coordinator/src/main.ts` without a `rootDir` set, which preserves the source directory structure in the output.

## Where This Path is Used

### In NimbleCo

- **File:** `pm2.config.js` (line ~125)
- **Purpose:** Tells PM2 where to find the compiled coordinator script

### In Swarm-Map

- **File:** `packages/gateway/src/adapters/deployment/PM2Adapter.ts` (line ~390)
- **Purpose:** Default fallback if agent metadata doesn't specify scriptPath
- **File:** `packages/gateway/src/api/agent-import.ts` (line ~1797)
- **Purpose:** Sets scriptPath in agent metadata during import

## If You Change the Build Output

If you change `coordinator/tsconfig.json` (e.g., add `rootDir: "./src"`), you must:

1. Update `pm2.config.js` script path in NimbleCo
2. Update `agent-import.ts` default scriptPath in Swarm-Map (line ~1797)
3. Update `PM2Adapter.ts` fallback path in Swarm-Map (line ~390)
4. Re-import all NimbleCo agents in Swarm-Map to update their metadata

## Better Approach (Future)

The path is now stored in agent metadata, so it can be customized per-agent. The priority is:

1. **Agent metadata** (`metadata.scriptPath`) - highest priority
2. **Default for nimbleco** - hardcoded fallback
3. **Fallback** - 'index.js' for other agent types

To make this more robust:
- Store scriptPath in NimbleCo's export file
- Or read it from package.json "main" field
- Or detect it automatically by checking which files exist
