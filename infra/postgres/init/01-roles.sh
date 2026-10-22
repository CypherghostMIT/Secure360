#!/usr/bin/env bash
# Creates the least-privilege database roles (L2 §7.4, Table 13). Runs once, when the data volume is empty.
# Passwords come from Docker secrets and are bound as psql variables (:'name'), never spliced into SQL text.
# Table grants are added by the Prisma migrations (task 4), not here.
set -euo pipefail

for name in db_owner_password db_app_password db_worker_password db_metrics_password; do
  if [[ ! -s "/run/secrets/$name" ]]; then
    echo "01-roles.sh: /run/secrets/$name is missing or empty (run npm run dev:secrets)" >&2
    exit 1
  fi
done

# psql reads each secret itself (\set with backticks), so no password appears in a process's argv.
psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\set owner_pw `tr -d '\r\n' < /run/secrets/db_owner_password`
\set app_pw `tr -d '\r\n' < /run/secrets/db_app_password`
\set worker_pw `tr -d '\r\n' < /run/secrets/db_worker_password`
\set metrics_pw `tr -d '\r\n' < /run/secrets/db_metrics_password`

-- Migrations only: owns the database and the schema, never used by the running API or worker.
CREATE ROLE s360_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'owner_pw';

-- Runtime roles: always subject to Row-Level Security.
CREATE ROLE s360_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'app_pw';
CREATE ROLE s360_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'worker_pw';

-- postgres_exporter: monitoring views only.
CREATE ROLE s360_metrics LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'metrics_pw';
GRANT pg_monitor TO s360_metrics;

\unset owner_pw
\unset app_pw
\unset worker_pw
\unset metrics_pw

ALTER DATABASE secure360 OWNER TO s360_owner;
ALTER SCHEMA public OWNER TO s360_owner;

-- Only the owner may create objects in public (PUBLIC keeps USAGE).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- No runtime role needs temporary objects; the owner keeps TEMP through its own ownership privileges.
REVOKE TEMPORARY ON DATABASE secure360 FROM PUBLIC;

-- A request stalled inside its tenant transaction must not hold a pooled connection (L2 §7.4).
ALTER ROLE s360_app SET statement_timeout = '5s';
ALTER ROLE s360_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE s360_worker SET statement_timeout = '5s';
ALTER ROLE s360_worker SET idle_in_transaction_session_timeout = '10s';
SQL
