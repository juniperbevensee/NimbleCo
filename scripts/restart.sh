#!/bin/bash
#
# Quick restart after code or .env changes
#
# Usage: ./scripts/restart.sh
#
# This kills any running coordinator, rebuilds, and restarts.
# Use this after making code changes OR editing .env.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "🔄 Restarting NimbleCo..."

# Kill existing processes (coordinator and universal agent)
echo "🧹 Stopping current processes..."

# Kill PM2 managed processes if any
pm2 delete all 2>/dev/null || true

# Kill ALL Node processes running from this project directory (aggressive cleanup)
# This catches processes started from any terminal
PROJECT_DIR_PATTERN="$(pwd)"
ps aux | grep node | grep "$PROJECT_DIR_PATTERN" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

# Also kill by common process patterns (belt and suspenders)
pkill -9 -f "tsx.*coordinator.*src/main" 2>/dev/null || true
pkill -9 -f "tsx.*universal.*src/main" 2>/dev/null || true
pkill -9 -f "node.*NimbleCo.*coordinator" 2>/dev/null || true
pkill -9 -f "node.*NimbleCo.*universal" 2>/dev/null || true
pkill -9 -f "vite.*NimbleCo" 2>/dev/null || true

echo "   ✅ All processes killed"
sleep 2

# Clear database post claims (prevent stale "already claimed" errors)
echo "🧹 Clearing stale post claims..."
docker exec nimble-postgres psql -U agent -d nimbleco -c "DELETE FROM processed_posts;" > /dev/null 2>&1 || echo "   ⚠️  Could not clear post claims (DB might not be ready)"

# Rebuild
echo "🔨 Rebuilding..."
npm run build --workspaces --if-present 2>/dev/null || npm run build

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Restart NATS to clear stale subscriptions
echo "🔄 Clearing NATS subscriptions..."
docker restart nimble-nats > /dev/null 2>&1 || true
sleep 2

# Start services (picks up any .env changes)
echo ""
echo "✅ Restarting services (env reloaded)..."
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
echo "   Dashboard server PID: $!"

# Start dashboard UI in background
cd "$PROJECT_ROOT/dashboard" && npm run dev > "$PROJECT_ROOT/logs/dashboard-ui.log" 2>&1 &
BG_PIDS="$BG_PIDS $!"
echo "   Dashboard UI PID: $!"

# Start coordinator in foreground
echo "🎯 Starting coordinator..."
cd "$PROJECT_ROOT/coordinator"
npm run dev

# Cleanup background processes on exit
for pid in $BG_PIDS; do
  kill $pid 2>/dev/null
done
