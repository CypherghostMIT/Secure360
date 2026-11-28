#!/usr/bin/env bash
# Generates the local Docker secrets for infra/compose.dev.yml and prints which file fills each .env variable.
# Existing files are never overwritten: the database roles are created once, with the passwords
# present on first start, so changing a file later would lock you out (use npm run dev:reset).
# Changing data_encryption_keys would also make data encrypted with the old keys unreadable.
# No secret value is ever printed (database and Redis passwords, JWT secret, data-encryption keys, rate-limit
# HMAC key): values only go to infra/secrets/ (git-ignored, mode 600), and the output names the file to copy
# each value from.
# Usage: npm run dev:secrets   (export POSTGRES_HOST_PORT / REDIS_HOST_PORT first if you changed the host ports)
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infra/secrets"
passwords=(pg_superuser_password db_owner_password db_app_password db_worker_password db_metrics_password redis_password)
# AES-256-GCM needs exactly 32 bytes (DATA_ENCRYPTION_KEYS, apps/api/src/platform/crypto/keyring.ts).
key_bytes=32
# HMAC-SHA256 key: at least 32 bytes (RATE_LIMIT_HMAC_KEY, apps/api/src/config/config.schema.ts).
hmac_bytes=32

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$dir"
umask 077

# URL-safe passwords: they go inside connection URLs, so / + = are removed.
# \r as well: openssl in Git Bash on Windows ends its output with CRLF.
password() { openssl rand -base64 36 | tr -d '/+=\r\n'; }
# Base64 values must stay valid base64: strip only the line ending, never / + =.
base64_random() { openssl rand -base64 "$1" | tr -d '\r\n'; }
# First keyring entry. The key of the former single-key file (data_encryption_key) becomes id 1, so data
# already encrypted locally stays readable.
initial_keyring() {
  if [[ -s "$dir/data_encryption_key" ]]; then
    printf '1:%s' "$(tr -d '\r\n' <"$dir/data_encryption_key")"
  else
    printf '1:%s' "$(base64_random "$key_bytes")"
  fi
}

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

# decoded_length <base64>: number of bytes it decodes to (0 when it is not base64).
decoded_length() { printf '%s' "$1" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' \r\n'; }

# Also checks a kept file: an old or hand-edited key would otherwise only fail when the API starts.
# Messages name the file and the line number, never the value.
key_count=0
last_id=""
check_keyring() {
  local file="$dir/data_encryption_keys" line number=0 id
  while IFS= read -r line || [[ -n "$line" ]]; do
    number=$((number + 1))
    line="${line%$'\r'}"
    [[ -z "$line" ]] && continue
    id="${line%%:*}"
    if [[ ! "$id" =~ ^[1-9][0-9]{0,4}$ ]] || ((id > 65535)) \
      || [[ "$(decoded_length "${line#*:}")" != "$key_bytes" ]]; then
      echo "infra/secrets/data_encryption_keys line $number must be <id 1-65535>:<base64 of exactly $key_bytes bytes>." >&2
      exit 1
    fi
    key_count=$((key_count + 1))
    last_id="$id"
  done <"$file"
  ((key_count > 0)) || { echo "infra/secrets/data_encryption_keys contains no key." >&2; exit 1; }
  echo "checked  infra/secrets/data_encryption_keys ($key_count key(s) of $key_bytes bytes)"
}

check_hmac_key() {
  local length
  length="$(decoded_length "$(tr -d '\r\n' <"$dir/rate_limit_hmac_key")")"
  if ((length < hmac_bytes)); then
    echo "infra/secrets/rate_limit_hmac_key must be base64 of at least $hmac_bytes bytes." >&2
    exit 1
  fi
  echo "checked  infra/secrets/rate_limit_hmac_key ($length bytes)"
}

for name in "${passwords[@]}"; do
  generate "$name" password
done
generate jwt_secret base64_random 48
generate data_encryption_keys initial_keyring
generate rate_limit_hmac_key base64_random "$hmac_bytes"
check_keyring
check_hmac_key

# Same variables and defaults as the port mappings in infra/compose.dev.yml.
pg_port="${POSTGRES_HOST_PORT:-5432}"
redis_port="${REDIS_HOST_PORT:-6379}"

# Passwords are not printed either (terminal scrollback, shared screens, pasted logs): the URLs keep the
# CHANGE_ME placeholder of .env.example, and the next block names the file whose content replaces it.
printf '\nIn .env (git-ignored), set these lines:\n\n'
echo "DATABASE_URL=postgresql://s360_app:CHANGE_ME@127.0.0.1:${pg_port}/secure360"
echo "MIGRATION_DATABASE_URL=postgresql://s360_owner:CHANGE_ME@127.0.0.1:${pg_port}/secure360"
# Integration tests only: bootstrap superuser on the throw-away secure360_test database (dropped on every run).
echo "TEST_DATABASE_ADMIN_URL=postgresql://postgres:CHANGE_ME@127.0.0.1:${pg_port}/secure360_test"
echo "REDIS_URL=redis://:CHANGE_ME@127.0.0.1:${redis_port}"
# The active key id is not a secret. With several keys the script cannot know which one is active mid-rotation.
if ((key_count == 1)); then
  echo "DATA_ENCRYPTION_ACTIVE_KEY_ID=${last_id}"
fi

printf '\nThen replace CHANGE_ME in each URL with the content of its file:\n\n'
echo "  DATABASE_URL             infra/secrets/db_app_password"
echo "  MIGRATION_DATABASE_URL   infra/secrets/db_owner_password"
echo "  TEST_DATABASE_ADMIN_URL  infra/secrets/pg_superuser_password"
echo "  REDIS_URL                infra/secrets/redis_password"

printf '\nKey material is not printed. In .env, set each variable to the content of its file:\n\n'
echo "  JWT_SECRET            infra/secrets/jwt_secret"
echo "  DATA_ENCRYPTION_KEYS  infra/secrets/data_encryption_keys (several lines: join them with commas)"
echo "  RATE_LIMIT_HMAC_KEY   infra/secrets/rate_limit_hmac_key"
if ((key_count != 1)); then
  echo "  DATA_ENCRYPTION_ACTIVE_KEY_ID  the id of the key that encrypts new data"
fi
if [[ -e "$dir/data_encryption_key" ]]; then
  printf '\ninfra/secrets/data_encryption_key is no longer read: its key is id 1 in data_encryption_keys.\n'
  echo "Replace DATA_ENCRYPTION_KEY in .env as described above, then delete that file."
fi
