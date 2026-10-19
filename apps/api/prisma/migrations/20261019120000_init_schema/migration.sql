-- Secure360 initial schema (L2 §7.2–7.3). Tables, enums, indexes and foreign keys are generated from
-- prisma/schema.prisma (`prisma migrate diff --from-empty`); the extension and CHECK constraints are hand-written.
-- Runs as s360_owner. Row-Level Security, functions and grants are in the next migration.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- citext is a trusted extension (PostgreSQL 13+): the database owner can create it without superuser.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

-- CreateEnum
CREATE TYPE "organization_type" AS ENUM ('COMPANY', 'ADMINISTRATION', 'NGO', 'PROVIDER');

-- CreateEnum
CREATE TYPE "subscription_plan" AS ENUM ('BASIC', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('USER', 'MANAGER', 'TECHNICIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "language" AS ENUM ('fr', 'en');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "incident_status" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('STATUS_UPDATE', 'NEW_MESSAGE', 'ASSIGNMENT', 'NEW_INCIDENT', 'SLA_BREACH');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "report_job_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "organization_type" NOT NULL,
    "sector" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "contact_email" CITEXT NOT NULL,
    "subscription_plan" "subscription_plan" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "preferred_language" "language" NOT NULL DEFAULT 'fr',
    "totp_secret_enc" BYTEA,
    "totp_last_step" BIGINT,
    "is_2fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_categories" (
    "code" TEXT NOT NULL,
    "group_code" TEXT NOT NULL,
    "label_fr" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "default_severity" "severity" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "incident_categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "category_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "severity" NOT NULL,
    "severity_initial" "severity" NOT NULL,
    "severity_answers" JSONB NOT NULL,
    "status" "incident_status" NOT NULL DEFAULT 'NEW',
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "device_affected" TEXT,
    "assigned_to" UUID,
    "sla_due_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_notes" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "client_request_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_status_history" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_status" "incident_status",
    "to_status" "incident_status" NOT NULL,
    "changed_by" UUID NOT NULL,
    "note" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_messages" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "client_message_id" UUID,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_reference_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "incident_reference_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID,
    "type" "notification_type" NOT NULL,
    "title_key" TEXT NOT NULL,
    "body_key" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "platform" "device_platform" NOT NULL,
    "locale" "language" NOT NULL DEFAULT 'fr',
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "user_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_id" UUID,
    "organization_id" UUID,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entity_id" UUID,
    "details" JSONB,
    "ip" INET,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "organization_id" UUID,
    "params" JSONB NOT NULL,
    "status" "report_job_status" NOT NULL DEFAULT 'QUEUED',
    "storage_key" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_single_provider_key" ON "organizations"("type") WHERE (type = 'PROVIDER');

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_organization_id_key" ON "users"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_reference_key" ON "incidents"("reference");

-- CreateIndex
CREATE INDEX "incidents_org_status_created_idx" ON "incidents"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_reporter_created_idx" ON "incidents"("reporter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_assigned_status_idx" ON "incidents"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "incidents_category_code_idx" ON "incidents"("category_code");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_id_organization_id_key" ON "incidents"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_reporter_id_client_request_id_key" ON "incidents"("reporter_id", "client_request_id");

-- CreateIndex
CREATE INDEX "incident_status_history_incident_id_changed_at_idx" ON "incident_status_history"("incident_id", "changed_at");

-- CreateIndex
CREATE INDEX "incident_status_history_changed_by_idx" ON "incident_status_history"("changed_by");

-- CreateIndex
CREATE INDEX "incident_messages_incident_sent_idx" ON "incident_messages"("incident_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "incident_messages_sender_id_client_message_id_key" ON "incident_messages"("sender_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_incident_id_created_at_idx" ON "attachments"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments"("uploaded_by");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_incident_id_idx" ON "notifications"("incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_fcm_token_key" ON "device_tokens"("fcm_token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_key" ON "refresh_tokens"("replaced_by");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events"("id") WHERE (published_at IS NULL);

-- CreateIndex
CREATE INDEX "outbox_events_organization_id_idx" ON "outbox_events"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "report_jobs_requested_by_created_at_idx" ON "report_jobs"("requested_by", "created_at" DESC);

-- CreateIndex
CREATE INDEX "report_jobs_organization_id_idx" ON "report_jobs"("organization_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reporter_fkey" FOREIGN KEY ("reporter_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "incident_categories"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_status_history" ADD CONSTRAINT "incident_status_history_incident_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_status_history" ADD CONSTRAINT "incident_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_messages" ADD CONSTRAINT "incident_messages_incident_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_messages" ADD CONSTRAINT "incident_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_incident_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "refresh_tokens"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------------------------
-- CHECK constraints (hand-written). Enumerated columns use native enum types, so they need no CHECK.
-- Maximum lengths equal the Zod schemas in packages/shared. Minimums only require visible text: Zod counts
-- UTF-16 units and PostgreSQL counts code points, so a stricter minimum here could reject valid input (500).
-- ---------------------------------------------------------------------------------------------------------------

-- organizations (CreateOrgInputSchema)
ALTER TABLE "organizations"
  ADD CONSTRAINT "chk_organizations_name" CHECK (btrim("name") <> '' AND char_length("name") <= 150),
  ADD CONSTRAINT "chk_organizations_sector" CHECK (btrim("sector") <> '' AND char_length("sector") <= 100),
  ADD CONSTRAINT "chk_organizations_city" CHECK (btrim("city") <> '' AND char_length("city") <= 100),
  ADD CONSTRAINT "chk_organizations_contact_email"
    CHECK (char_length("contact_email") <= 254 AND position('@' IN "contact_email") > 1),
  ADD CONSTRAINT "chk_organizations_updated_at" CHECK ("updated_at" >= "created_at");

-- users (CreateUserInputSchema; L2 §8.2)
ALTER TABLE "users"
  ADD CONSTRAINT "chk_users_first_name" CHECK (btrim("first_name") <> '' AND char_length("first_name") <= 100),
  ADD CONSTRAINT "chk_users_last_name" CHECK (btrim("last_name") <> '' AND char_length("last_name") <= 100),
  ADD CONSTRAINT "chk_users_email" CHECK (char_length("email") <= 254 AND position('@' IN "email") > 1),
  ADD CONSTRAINT "chk_users_phone" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$'),
  -- Only a bcrypt hash can be stored, never a plaintext password or another algorithm's output.
  ADD CONSTRAINT "chk_users_password_hash" CHECK ("password_hash" ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  ADD CONSTRAINT "chk_users_totp_last_step" CHECK ("totp_last_step" >= 0),
  ADD CONSTRAINT "chk_users_2fa_has_secret" CHECK (NOT "is_2fa_enabled" OR "totp_secret_enc" IS NOT NULL),
  ADD CONSTRAINT "chk_users_session_version" CHECK ("session_version" >= 1),
  ADD CONSTRAINT "chk_users_updated_at" CHECK ("updated_at" >= "created_at");

-- incident_categories (L1 Table 12 codes, e.g. MOB-02)
ALTER TABLE "incident_categories"
  ADD CONSTRAINT "chk_incident_categories_code" CHECK ("code" ~ '^[A-Z]{3}-[0-9]{2}$'),
  ADD CONSTRAINT "chk_incident_categories_group_code" CHECK ("group_code" ~ '^[A-Z][A-Z_]{0,49}$'),
  ADD CONSTRAINT "chk_incident_categories_label_fr"
    CHECK (btrim("label_fr") <> '' AND char_length("label_fr") <= 150),
  ADD CONSTRAINT "chk_incident_categories_label_en"
    CHECK (btrim("label_en") <> '' AND char_length("label_en") <= 150),
  ADD CONSTRAINT "chk_incident_categories_sort_order" CHECK ("sort_order" >= 0);

-- incidents (CreateIncidentInputSchema, UpdateIncidentInputSchema; L2 §7.3)
ALTER TABLE "incidents"
  ADD CONSTRAINT "chk_incidents_reference" CHECK ("reference" ~ '^SFC-[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT "chk_incidents_title" CHECK (btrim("title") <> '' AND char_length("title") <= 150),
  ADD CONSTRAINT "chk_incidents_description"
    CHECK (btrim("description") <> '' AND char_length("description") <= 5000),
  ADD CONSTRAINT "chk_incidents_location" CHECK (btrim("location") <> '' AND char_length("location") <= 200),
  ADD CONSTRAINT "chk_incidents_device_affected"
    CHECK (btrim("device_affected") <> '' AND char_length("device_affected") <= 200),
  ADD CONSTRAINT "chk_incidents_resolution_notes"
    CHECK (btrim("resolution_notes") <> '' AND char_length("resolution_notes") <= 5000),
  ADD CONSTRAINT "chk_incidents_severity_answers" CHECK (jsonb_typeof("severity_answers") = 'object'),
  ADD CONSTRAINT "chk_incidents_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "chk_incidents_resolved_at" CHECK ("resolved_at" >= "created_at"),
  ADD CONSTRAINT "chk_incidents_closed_at" CHECK ("closed_at" >= "created_at"),
  ADD CONSTRAINT "chk_incidents_acknowledged_at" CHECK ("acknowledged_at" >= "created_at"),
  ADD CONSTRAINT "chk_incidents_sla_due_at" CHECK ("sla_due_at" >= "created_at"),
  ADD CONSTRAINT "chk_incidents_updated_at" CHECK ("updated_at" >= "created_at");

-- incident_status_history: a transition always changes the status.
ALTER TABLE "incident_status_history"
  ADD CONSTRAINT "chk_incident_status_history_transition" CHECK ("from_status" IS DISTINCT FROM "to_status"),
  ADD CONSTRAINT "chk_incident_status_history_note" CHECK (btrim("note") <> '' AND char_length("note") <= 5000);

-- incident_messages (CreateMessageInputSchema)
ALTER TABLE "incident_messages"
  ADD CONSTRAINT "chk_incident_messages_body" CHECK (btrim("body") <> '' AND char_length("body") <= 2000);

-- attachments (L2 §7.6, §8.5): re-encoded images only, server-generated {organization_id}/{yyyy}/{uuid}.bin key.
ALTER TABLE "attachments"
  ADD CONSTRAINT "chk_attachments_mime" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "chk_attachments_storage_key" CHECK (
    "storage_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]bin$'
  ),
  ADD CONSTRAINT "chk_attachments_size_bytes" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "chk_attachments_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_attachments_dimensions" CHECK ("width" > 0 AND "height" > 0);

-- incident_reference_counters: NNNNNN has six digits.
ALTER TABLE "incident_reference_counters"
  ADD CONSTRAINT "chk_incident_reference_counters_year" CHECK ("year" BETWEEN 2024 AND 9999),
  ADD CONSTRAINT "chk_incident_reference_counters_last_value" CHECK ("last_value" BETWEEN 0 AND 999999);

-- notifications: translation keys, never rendered text (L2 Table 12).
ALTER TABLE "notifications"
  ADD CONSTRAINT "chk_notifications_title_key" CHECK ("title_key" ~ '^[a-z][A-Za-z0-9_.]{0,99}$'),
  ADD CONSTRAINT "chk_notifications_body_key" CHECK ("body_key" ~ '^[a-z][A-Za-z0-9_.]{0,99}$'),
  ADD CONSTRAINT "chk_notifications_params" CHECK (jsonb_typeof("params") = 'object');

-- device_tokens
ALTER TABLE "device_tokens"
  ADD CONSTRAINT "chk_device_tokens_fcm_token"
    CHECK (btrim("fcm_token") <> '' AND char_length("fcm_token") <= 4096);

-- Token tables: SHA-256 digests only (32 bytes), never the token itself (L2 §7.6).
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "chk_refresh_tokens_token_hash" CHECK (octet_length("token_hash") = 32),
  ADD CONSTRAINT "chk_refresh_tokens_expires_at" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "chk_refresh_tokens_replaced_by" CHECK ("replaced_by" <> "id");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "chk_password_reset_tokens_token_hash" CHECK (octet_length("token_hash") = 32),
  ADD CONSTRAINT "chk_password_reset_tokens_expires_at" CHECK ("expires_at" > "created_at");

-- idempotency_keys (L2 §4.4)
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "chk_idempotency_keys_method" CHECK ("method" IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  ADD CONSTRAINT "chk_idempotency_keys_path" CHECK (left("path", 1) = '/' AND char_length("path") <= 2048),
  ADD CONSTRAINT "chk_idempotency_keys_request_hash" CHECK (octet_length("request_hash") = 32),
  ADD CONSTRAINT "chk_idempotency_keys_status_code" CHECK ("status_code" BETWEEN 100 AND 599),
  ADD CONSTRAINT "chk_idempotency_keys_expires_at" CHECK ("expires_at" > "created_at");

-- outbox_events: domain event names of L2 Table 10 (e.g. incident.status_changed).
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "chk_outbox_events_event_type"
    CHECK ("event_type" ~ '^[a-z][a-z_]*([.][a-z][a-z_]*)+$' AND char_length("event_type") <= 100),
  ADD CONSTRAINT "chk_outbox_events_payload" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "chk_outbox_events_published_at" CHECK ("published_at" >= "created_at");

-- audit_logs: noun.verb.outcome (AGENTS.md rule 10).
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "chk_audit_logs_action"
    CHECK ("action" ~ '^[a-z][a-z_]*[.][a-z][a-z_]*[.][a-z][a-z_]*$' AND char_length("action") <= 100),
  ADD CONSTRAINT "chk_audit_logs_entity" CHECK ("entity" ~ '^[a-z][a-z_]{0,49}$'),
  ADD CONSTRAINT "chk_audit_logs_request_id" CHECK (char_length("request_id") <= 128),
  ADD CONSTRAINT "chk_audit_logs_details" CHECK (jsonb_typeof("details") = 'object');

-- report_jobs
ALTER TABLE "report_jobs"
  ADD CONSTRAINT "chk_report_jobs_params" CHECK (jsonb_typeof("params") = 'object'),
  ADD CONSTRAINT "chk_report_jobs_storage_key" CHECK ("status" <> 'SUCCEEDED' OR "storage_key" IS NOT NULL),
  ADD CONSTRAINT "chk_report_jobs_error_code" CHECK (char_length("error_code") <= 100),
  ADD CONSTRAINT "chk_report_jobs_completed_at" CHECK ("completed_at" >= "created_at");
