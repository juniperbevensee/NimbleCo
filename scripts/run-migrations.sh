#!/bin/bash
# Run all PostgreSQL migrations
set -e

echo "Running database migrations..."

# Check if PostgreSQL is running
if ! docker exec nimble-postgres pg_isready -U agent > /dev/null 2>&1; then
    echo "Error: PostgreSQL is not running"
    exit 1
fi

# Run each migration file in order
for migration in infrastructure/postgres/migrations/*.sql; do
    echo "Running: $(basename $migration)"
    docker exec -i nimble-postgres psql -U agent -d nimbleco < "$migration" 2>&1 | grep -v "already exists" || true
done

echo "✓ Migrations complete!"
