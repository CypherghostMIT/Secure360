#!/usr/bin/env bash
# Generates the local Docker secrets for infra/compose.dev.yml and prints which file fills each .env variable.
# Existing files are never overwritten: the database roles are created once, with the passwords
# present on first start, so changing a file later would lock you out (use npm run dev:reset).
# Changing data_encryption_keys would also make data encrypted with the old keys unreadable.
# No secret value is ever printed (database and Redis passwords, JWT signing keys, data-encryption keys, rate-limit
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
# JWT HS256 signing keys: 32 to 64 bytes each (JWT_SIGNING_KEYS, HMAC_SHA256_KEY_SIZE in keyring.ts); 256-bit by
# default (L2 §8.2).
jwt_min_bytes=32
jwt_max_bytes=64

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$dir"
umask 077

# URL-safe passwords: they go inside connection URLs, so / + = are removed.
# \r as well: openssl in Git Bash on Windows ends its output with CRLF.
password() { openssl rand -base64 36 | tr -d '/+=\r\n'; }
# Base64 values must stay valid base64: strip only the line ending, never / + =.
base64_random() { openssl rand -base64 "$1" | tr -d '\r\n'; }
# First JWT signing key, id 1.
initial_jwt_keyring() { printf '1:%s' "$(base64_random "$jwt_min_bytes")"; }
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
# check_keyring <file name> <min bytes> <max bytes>: sets ring_count and ring_last_id.
ring_count=0
ring_last_id=""
check_keyring() {
  local name="$1" min="$2" max="$3" line number=0 id length
  ring_count=0
  ring_last_id=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    number=$((number + 1))
    line="${line%$'\r'}"
    [[ -z "$line" ]] && continue
    id="${line%%:*}"
    length="$(decoded_length "${line#*:}")"
    if [[ ! "$id" =~ ^[1-9][0-9]{0,4}$ ]] || ((id > 65535)) || ((length < min || length > max)); then
      if ((min == max)); then
        echo "infra/secrets/$name line $number must be <id 1-65535>:<base64 of exactly $min bytes>." >&2
      else
        echo "infra/secrets/$name line $number must be <id 1-65535>:<base64 of $min to $max bytes>." >&2
      fi
      exit 1
    fi
    ring_count=$((ring_count + 1))
    ring_last_id="$id"
  done <"$dir/$name"
  ((ring_count > 0)) || { echo "infra/secrets/$name contains no key." >&2; exit 1; }
  echo "checked  infra/secrets/$name ($ring_count key(s))"
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
generate jwt_signing_keys initial_jwt_keyring
generate data_encryption_keys initial_keyring
generate rate_limit_hmac_key base64_random "$hmac_bytes"
check_keyring jwt_signing_keys "$jwt_min_bytes" "$jwt_max_bytes"
jwt_key_count=$ring_count
jwt_last_id=$ring_last_id
check_keyring data_encryption_keys "$key_bytes" "$key_bytes"
key_count=$ring_count
last_id=$ring_last_id
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
if ((jwt_key_count == 1)); then
  echo "JWT_ACTIVE_KEY_ID=${jwt_last_id}"
fi

printf '\nThen replace CHANGE_ME in each URL with the content of its file:\n\n'
echo "  DATABASE_URL             infra/secrets/db_app_password"
echo "  MIGRATION_DATABASE_URL   infra/secrets/db_owner_password"
echo "  TEST_DATABASE_ADMIN_URL  infra/secrets/pg_superuser_password"
echo "  REDIS_URL                infra/secrets/redis_password"

printf '\nKey material is not printed. In .env, set each variable to the content of its file:\n\n'
echo "  JWT_SIGNING_KEYS      infra/secrets/jwt_signing_keys (several lines: join them with commas)"
echo "  DATA_ENCRYPTION_KEYS  infra/secrets/data_encryption_keys (several lines: join them with commas)"
echo "  RATE_LIMIT_HMAC_KEY   infra/secrets/rate_limit_hmac_key"
if ((key_count != 1)); then
  echo "  DATA_ENCRYPTION_ACTIVE_KEY_ID  the id of the key that encrypts new data"
fi
if ((jwt_key_count != 1)); then
  echo "  JWT_ACTIVE_KEY_ID              the id of the key that signs new tokens"
fi
if [[ -e "$dir/data_encryption_key" ]]; then
  printf '\ninfra/secrets/data_encryption_key is no longer read: its key is id 1 in data_encryption_keys.\n'
  echo "Replace DATA_ENCRYPTION_KEY in .env as described above, then delete that file."
fi
if [[ -e "$dir/jwt_secret" ]]; then
  printf '\ninfra/secrets/jwt_secret is no longer read: infra/secrets/jwt_signing_keys replaces it.\n'
  echo "Remove JWT_SECRET from .env, add JWT_SIGNING_KEYS and JWT_ACTIVE_KEY_ID, then delete that file."
fi
