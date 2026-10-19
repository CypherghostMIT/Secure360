#!/usr/bin/env bash
# Generates the local Docker secrets for infra/compose.dev.yml and prints the .env connection lines.
# Existing files are never overwritten: the database roles are created once, with the passwords
# present on first start, so changing a file later would lock you out (use npm run dev:reset).
# Usage: npm run dev:secrets   (export POSTGRES_HOST_PORT / REDIS_HOST_PORT first if you changed the host ports)
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infra/secrets"
names=(pg_superuser_password db_owner_password db_app_password db_worker_password db_metrics_password redis_password)

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$dir"
umask 077

for name in "${names[@]}"; do
  file="$dir/$name"
  if [[ -e "$file" ]]; then
    echo "kept     infra/secrets/$name"
    continue
  fi
  # \r as well: openssl in Git Bash on Windows ends its output with CRLF.
  value="$(openssl rand -base64 36 | tr -d '/+=\r\n')"
  [[ -n "$value" ]] || { echo "empty value generated for $name" >&2; exit 1; }
  # noclobber: fail instead of overwriting if the file appeared in the meantime.
  (set -o noclobber; printf '%s' "$value" >"$file")
  chmod 600 "$file"
  echo "created  infra/secrets/$name"
done

app="$(<"$dir/db_app_password")"
owner="$(<"$dir/db_owner_password")"
redis="$(<"$dir/redis_password")"
# Same variables and defaults as the port mappings in infra/compose.dev.yml.
pg_port="${POSTGRES_HOST_PORT:-5432}"
redis_port="${REDIS_HOST_PORT:-6379}"

printf '\nPaste these lines into .env (git-ignored). Do not paste them anywhere else.\n\n'
echo "DATABASE_URL=postgresql://s360_app:${app}@127.0.0.1:${pg_port}/secure360"
echo "MIGRATION_DATABASE_URL=postgresql://s360_owner:${owner}@127.0.0.1:${pg_port}/secure360"
echo "REDIS_URL=redis://:${redis}@127.0.0.1:${redis_port}"
