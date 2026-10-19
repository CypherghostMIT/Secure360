#!/usr/bin/env bash
# Generates the local Docker secrets for infra/compose.dev.yml and prints the .env lines.
# Existing files are never overwritten: the database roles are created once, with the passwords
# present on first start, so changing a file later would lock you out (use npm run dev:reset).
# Changing data_encryption_key would also make data encrypted with the old key unreadable.
# Usage: npm run dev:secrets   (export POSTGRES_HOST_PORT / REDIS_HOST_PORT first if you changed the host ports)
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infra/secrets"
passwords=(pg_superuser_password db_owner_password db_app_password db_worker_password db_metrics_password redis_password)
# AES-256-GCM needs exactly 32 bytes (DATA_ENCRYPTION_KEY in apps/api/src/config/config.schema.ts).
key_bytes=32

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$dir"
umask 077

# URL-safe passwords: they go inside connection URLs, so / + = are removed.
# \r as well: openssl in Git Bash on Windows ends its output with CRLF.
password() { openssl rand -base64 36 | tr -d '/+=\r\n'; }
# Base64 values must stay valid base64: strip only the line ending, never / + =.
base64_random() { openssl rand -base64 "$1" | tr -d '\r\n'; }

# generate <name> <generator> [args...]: runs the generator only when the file does not exist yet.
generate() {
  local name="$1" file="$dir/$1" value
  shift
  if [[ -e "$file" ]]; then
    echo "kept     infra/secrets/$name"
    return
  fi
  value="$("$@")"
  [[ -n "$value" ]] || { echo "empty value generated for $name" >&2; exit 1; }
  # noclobber: fail instead of overwriting if the file appeared in the meantime.
  (set -o noclobber; printf '%s' "$value" >"$file")
  chmod 600 "$file"
  echo "created  infra/secrets/$name"
}

for name in "${passwords[@]}"; do
  generate "$name" password
done
generate jwt_secret base64_random 48
generate data_encryption_key base64_random "$key_bytes"

app="$(<"$dir/db_app_password")"
owner="$(<"$dir/db_owner_password")"
redis="$(<"$dir/redis_password")"
jwt="$(<"$dir/jwt_secret")"
key="$(<"$dir/data_encryption_key")"

# Also checks a kept file: an old or hand-edited key would otherwise only fail when the API starts.
decoded_bytes="$(printf '%s' "$key" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' \r\n')"
if [[ "$decoded_bytes" != "$key_bytes" ]]; then
  echo "infra/secrets/data_encryption_key must be base64 of exactly $key_bytes bytes (decodes to $decoded_bytes)." >&2
  echo "Delete it and run npm run dev:secrets again, only if no data was encrypted with it." >&2
  exit 1
fi
echo "checked  infra/secrets/data_encryption_key decodes to $key_bytes bytes"

# Same variables and defaults as the port mappings in infra/compose.dev.yml.
pg_port="${POSTGRES_HOST_PORT:-5432}"
redis_port="${REDIS_HOST_PORT:-6379}"

printf '\nPaste these lines into .env (git-ignored). Do not paste them anywhere else.\n\n'
echo "DATABASE_URL=postgresql://s360_app:${app}@127.0.0.1:${pg_port}/secure360"
echo "MIGRATION_DATABASE_URL=postgresql://s360_owner:${owner}@127.0.0.1:${pg_port}/secure360"
echo "REDIS_URL=redis://:${redis}@127.0.0.1:${redis_port}"
echo "JWT_SECRET=${jwt}"
echo "DATA_ENCRYPTION_KEY=${key}"
