#!/usr/bin/env bash
# Pull the latest code and restart. Rooms are saved to data/rooms.json, so nights in progress carry on.
# Run from inside the repo on the server:   bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull
npm ci --omit=dev
STATS_KEY="$(cat "$HOME/.12pubs-stats-key" 2>/dev/null || true)" pm2 restart 12pubs --update-env
echo "Updated. $(curl -s localhost:3000/healthz)"
