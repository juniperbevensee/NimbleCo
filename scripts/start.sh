#!/bin/bash
#
# Start NimbleCo services
# Ensures Docker infrastructure is running before starting PM2
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Check if Docker is running, start it if not
if ! docker info > /dev/null 2>&1; then
  echo "🐳 Docker is not running. Starting Docker Desktop..."
  open -a Docker

  # Wait for Docker to be ready
  while ! docker info > /dev/null 2>&1; do
    sleep 1
  done
  echo "   ✅ Docker is ready"
fi

# Clean up any existing PM2 processes (clears "errored" state)
echo "🧹 Cleaning up PM2 processes..."
pm2 delete all 2>/dev/null || true

# Start infrastructure (Postgres + NATS)
echo "🐳 Starting infrastructure (Postgres, NATS)..."
docker-compose up -d --remove-orphans postgres nats 2>/dev/null

# Wait for NATS to be ready
echo "⏳ Waiting for services..."
until curl -s http://localhost:8222/healthz > /dev/null 2>&1; do
  sleep 1
done
echo "   ✅ NATS ready"

# Wait for Postgres to be ready
until docker exec nimble-postgres pg_isready -U agent > /dev/null 2>&1; do
  sleep 1
done
echo "   ✅ Postgres ready"

# Start PM2 services
echo "🚀 Starting PM2 services..."
pm2 start pm2.config.js

echo ""
echo "✅ NimbleCo started successfully!"
echo ""
pm2 logs
