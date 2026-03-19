#!/bin/bash
#
# NimbleCo Development Script
#
# Usage: ./scripts/dev.sh
#
# This script starts everything you need for local development:
# 1. Infrastructure (Postgres, NATS) via Docker
# 2. Coordinator (runs locally for hot reload)
#
# Prerequisites:
# - Docker running
# - npm install completed (run `npm run setup` first time)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "🚀 Starting NimbleCo Development Environment"
echo ""

# Step 1: Kill any zombie processes
echo "🧹 Cleaning up zombie processes..."
# Kill PM2 managed processes if any
pm2 delete all 2>/dev/null || true
# Kill tsx dev processes
pkill -f "tsx.*src/main" 2>/dev/null || true
pkill -f "node.*dist/main.*NimbleCo" 2>/dev/null || true
sleep 1

# Step 2: Start infrastructure (Postgres + NATS only)
echo "🐳 Starting infrastructure (Postgres, NATS)..."
docker-compose up -d --remove-orphans postgres nats 2>/dev/null

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 3

# Check postgres
until docker exec nimble-postgres pg_isready -U agent > /dev/null 2>&1; do
  echo "   Waiting for Postgres..."
  sleep 2
done
echo "   ✅ Postgres ready"

# Check NATS
until curl -s http://localhost:8222/healthz > /dev/null 2>&1; do
  echo "   Waiting for NATS..."
  sleep 2
done
echo "   ✅ NATS ready"

# Step 3: Run any pending migrations (silently)
echo "📦 Running database migrations..."
for migration in infrastructure/postgres/migrations/*.sql; do
  if [ -f "$migration" ]; then
    # Pipe SQL directly to postgres, suppress output
    cat "$migration" | docker exec -i nimble-postgres psql -U agent -d nimbleco > /dev/null 2>&1 || true
  fi
done
echo "   ✅ Migrations complete"

# Step 4: Build the code
echo "🔨 Building TypeScript..."
npm run build --workspaces --if-present 2>/dev/null || npm run build

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Step 5: Start the services
echo ""
echo "=========================================="
echo "✅ Infrastructure ready!"
echo "=========================================="
echo ""
echo "Starting services... (Ctrl+C to stop)"
echo ""

# Start 3 universal agents in background (for parallel swarm processing)
echo "🤖 Starting universal agents (3 instances)..."
BG_PIDS=""
for i in 1 2 3; do
  cd "$PROJECT_ROOT/agents/universal" && npm run dev > "$PROJECT_ROOT/logs/universal-agent-$i.log" 2>&1 &
  PID=$!
  BG_PIDS="$BG_PIDS $PID"
  echo "   Universal agent $i PID: $PID"
done

# Start dashboard server in background
echo "📊 Starting dashboard..."
cd "$PROJECT_ROOT/dashboard" && node dist/server.js > "$PROJECT_ROOT/logs/dashboard-server.log" 2>&1 &
BG_PIDS="$BG_PIDS $!"
echo "   Dashboard API server PID: $!"
echo "   Dashboard API: http://localhost:3001"

# Start dashboard UI in background
cd "$PROJECT_ROOT/dashboard" && npm run dev > "$PROJECT_ROOT/logs/dashboard-ui.log" 2>&1 &
BG_PIDS="$BG_PIDS $!"
echo "   Dashboard UI PID: $!"
echo "   Dashboard UI: http://localhost:5173"
echo ""

# Start coordinator in foreground
echo "🎯 Starting coordinator..."
cd "$PROJECT_ROOT/coordinator"
npm run dev

# Cleanup background processes on exit
for pid in $BG_PIDS; do
  kill $pid 2>/dev/null
done
