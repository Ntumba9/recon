#!/bin/sh
set -e

echo "[entrypoint] applying migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting app in background..."
npm run start -- -p "${PORT:-3000}" &
APP_PID=$!

echo "[entrypoint] waiting for app to become ready..."
for i in $(seq 1 60); do
  if wget -q -O /dev/null "http://localhost:${PORT:-3000}/api/health"; then
    break
  fi
  sleep 1
done

echo "[entrypoint] waiting for mock provider to become ready..."
for i in $(seq 1 60); do
  if wget -q -O /dev/null "${MOCK_PROVIDER_URL:-http://localhost:4000}/health"; then
    break
  fi
  sleep 1
done

echo "[entrypoint] running demo reconciliation..."
npx tsx scripts/demo.ts || echo "[entrypoint] demo script reported a mismatch - see output above"

echo "[entrypoint] app is running. Findings UI: http://localhost:${PORT:-3000}/findings"
wait "$APP_PID"
