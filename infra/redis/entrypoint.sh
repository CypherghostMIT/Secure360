#!/bin/sh
# Starts Redis with the password from the Docker secret (L2 §8.6).
# The password goes into a config file generated at start inside the container (not the data volume),
# not into a command-line flag, so it is not visible in `ps`, the container config or `docker inspect`.
set -eu

secret=/run/secrets/redis_password
if [ ! -s "$secret" ]; then
  echo "redis-entrypoint: $secret is missing or empty (run npm run dev:secrets)" >&2
  exit 1
fi
password="$(cat "$secret")"

# Generated passwords are alphanumeric; refuse anything that could break the config line.
case "$password" in
  *[!A-Za-z0-9]*)
    echo "redis-entrypoint: $secret must contain only letters and digits" >&2
    exit 1
    ;;
esac

umask 077
conf_dir=/tmp/redis-conf
mkdir -p "$conf_dir"
printf 'requirepass "%s"\n' "$password" >"$conf_dir/auth.conf"
# The official entrypoint drops privileges to the redis user, which must still read the file.
chown -R redis:redis "$conf_dir"
unset password

exec docker-entrypoint.sh redis-server "$conf_dir/auth.conf" "$@"
