#!/usr/bin/env bash
# Starts a disposable PostgreSQL for `npm run test:integration` (port 54329).
# The integration suite creates its own database, applies a Supabase-compatible shim and every
# migration, runs the RLS tests as separate users, then drops the database.
set -euo pipefail
NAME=kjchat-test-db
if docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "${NAME} already running on 127.0.0.1:54329"
  exit 0
fi
docker run -d --rm --name "${NAME}" -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 >/dev/null
for _ in $(seq 1 30); do
  if docker exec "${NAME}" pg_isready -U postgres >/dev/null 2>&1; then
    echo "PostgreSQL ready: TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres"
    exit 0
  fi
  sleep 1
done
echo "PostgreSQL did not become ready" >&2
exit 1
