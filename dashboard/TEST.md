# Dashboard Testing Guide

## Prerequisites

1. Docker and Docker Compose running
2. PostgreSQL container running (`nimble-postgres`)
3. NATS container running (`nimble-nats`)
4. Environment file configured (`.env` with `DATABASE_URL`)

## Start Infrastructure

```bash
# From project root
docker-compose up -d nats postgres
```

## Build Dashboard

```bash
# From project root
cd dashboard
npm install
npm run build
```

This will:
- Build the React UI (`dist/index.html` and assets)
- Build the Express API server (`dist/server.js`)

## Start Dashboard

### Option 1: Via PM2 (Recommended)

```bash
# From project root
pm2 start ecosystem.config.js

# Check status
pm2 list
pm2 logs dashboard-ui
pm2 logs dashboard-server
```

### Option 2: Manual Start

Terminal 1 - API Server:
```bash
cd /path/to/NimbleCo
node dashboard/dist/server.js
```

Terminal 2 - UI Dev Server:
```bash
cd /path/to/NimbleCo/dashboard
npm run dev
```

## Access Dashboard

- UI: http://localhost:5173
- API: http://localhost:3001

## Test API Endpoints

```bash
# Health check
curl http://localhost:3001/api/health

# System metrics
curl http://localhost:3001/api/system/metrics

# Invocation stats (last 7 days)
curl http://localhost:3001/api/invocations/stats?days=7

# Per-user stats
curl http://localhost:3001/api/invocations/users?days=7

# Agent status
curl http://localhost:3001/api/agents/status

# Tool usage stats
curl http://localhost:3001/api/tools/stats?days=7

# LLM usage stats
curl http://localhost:3001/api/llm/stats?days=7

# Recent invocations
curl http://localhost:3001/api/invocations/recent?limit=10
```

## Troubleshooting

### Server won't start

Check `.env` file has correct `DATABASE_URL`:
```bash
grep DATABASE_URL .env
```

Test database connection:
```bash
docker exec nimble-postgres psql -U agent -d nimbleco -c "SELECT COUNT(*) FROM invocations;"
```

### UI shows loading forever

1. Check API server is running: `curl http://localhost:3001/api/health`
2. Check browser console for CORS errors
3. Verify proxy configuration in `vite.config.ts`

### No data displayed

1. Ensure you have invocations in the database:
   ```bash
   docker exec nimble-postgres psql -U agent -d nimbleco -c "SELECT COUNT(*) FROM invocations;"
   ```

2. If no data, run some test invocations or use the coordinator to create sample data

### Port conflicts

If ports 3001 or 5173 are already in use:

```bash
# Check what's using the ports
lsof -i :3001
lsof -i :5173

# Kill the processes if needed
kill <PID>
```

## Dashboard Features

### Dashboard Tab
- System overview with key metrics
- Total invocations (all time and today)
- Active agents count
- Cost tracking (today's total)
- Average response time
- 7-day invocation trend chart
- 7-day cost trend chart

### Invocations Tab
- Per-user breakdown with bar charts
- User statistics table (requests, completion rate, costs)
- Recent invocations list with status indicators
- Rate limit tracking

### Agents Tab
- Agent health cards with status indicators
  - Green (●): Healthy (seen < 5 minutes ago)
  - Orange (◐): Warning (seen 5-30 minutes ago)
  - Gray (○): Offline (seen > 30 minutes ago)
- Last 24h execution statistics per agent
- Average duration and cost per agent

### Tools & LLMs Tab
- Tool usage pie chart
- Tool success/failure breakdown
- LLM usage statistics by provider and model
- Token consumption and costs
- Average execution times

## Architecture

```
┌─────────────────────────────────────────────┐
│  Dashboard UI (React + Vite)                │
│  Port: 5173                                 │
│  - Dashboard.tsx (overview)                 │
│  - InvocationStats.tsx (rate limits)        │
│  - AgentStatus.tsx (agent health)           │
│  - ToolUsage.tsx (tools & LLMs)             │
└─────────────────┬───────────────────────────┘
                  │ /api proxy
                  ↓
┌─────────────────────────────────────────────┐
│  Dashboard API Server (Express)             │
│  Port: 3001                                 │
│  - /api/system/metrics                      │
│  - /api/invocations/*                       │
│  - /api/agents/status                       │
│  - /api/tools/stats                         │
│  - /api/llm/stats                           │
└─────────────────┬───────────────────────────┘
                  │ PostgreSQL queries
                  ↓
┌─────────────────────────────────────────────┐
│  PostgreSQL Database                        │
│  Port: 5432                                 │
│  Tables:                                    │
│  - invocations (agent invocations)          │
│  - agents (agent registry)                  │
│  - tool_calls (tool execution logs)         │
│  - llm_calls (LLM API calls)                │
│  - agent_executions (legacy)                │
│  - daily_costs (cost aggregation)           │
└─────────────────────────────────────────────┘
```

## Development

To modify the dashboard:

1. Edit React components in `src/pages/`
2. Edit API endpoints in `server.ts`
3. Update styles in `src/App.css`
4. Rebuild: `npm run build`
5. Restart PM2: `pm2 restart dashboard-server dashboard-ui`

Hot reload is enabled for UI development with `npm run dev`.
