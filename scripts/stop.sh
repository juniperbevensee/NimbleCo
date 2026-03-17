#!/bin/bash
#
# Stop all NimbleCo services (emergency stop)
#
# Usage: ./scripts/stop.sh
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "🛑 Stopping NimbleCo..."

# Kill all NimbleCo node processes aggressively
echo "   Killing coordinator and agents..."
pkill -9 -f "tsx.*coordinator.*src/main" 2>/dev/null || true
pkill -9 -f "tsx.*universal.*src/main" 2>/dev/null || true
pkill -9 -f "tsx.*agents.*src/main" 2>/dev/null || true
pkill -9 -f "node.*NimbleCo.*dist/main" 2>/dev/null || true

# Also kill any npm run dev processes for NimbleCo
pkill -9 -f "npm.*run.*dev.*NimbleCo" 2>/dev/null || true

echo "✅ All stopped"
echo ""
echo "Note: Docker infrastructure (Postgres, NATS) still running."
echo "To stop those too: docker-compose stop"
