#!/usr/bin/env bash
# Stops the local services and deletes their volumes (all local PostgreSQL and Redis data).
# Usage: npm run dev:reset
set -euo pipefail

read -r -p "This deletes all local PostgreSQL and Redis data. Type 'yes' to continue: " answer
if [[ "$answer" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi
docker compose -f infra/compose.dev.yml down -v
