#!/usr/bin/env bash
# Builds the app with placeholder configuration (no backend) and runs the Playwright smoke suite.
# The Supabase URL points at a closed local port so network-failure handling is exercised.
# Server secrets are set to recognisable canary values so the bundle scan can prove they never
# reach client JavaScript.
set -euo pipefail
export NEXT_DIST_DIR=.next-smoke
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_smoke_placeholder
export NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100
export SUPABASE_SECRET_KEY=SECRET_CANARY_supabase_secret_key
export LIVEKIT_URL=wss://smoke.invalid
export LIVEKIT_API_KEY=SECRET_CANARY_livekit_key
export LIVEKIT_API_SECRET=SECRET_CANARY_livekit_secret_value
export VAPID_PRIVATE_KEY=SECRET_CANARY_vapid_private
export CRON_SECRET=SECRET_CANARY_cron
npx next build
node scripts/scan-client-bundle.mjs .next-smoke
PW_SMOKE_SERVER=1 npx playwright test --project=smoke "$@"
