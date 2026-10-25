-- Secure360 tenant isolation, functions and privileges (L2 §7.4, Tables 13 and 14; L1 D1).
-- Hand-written; runs as s360_owner after the init migration. The roles are created outside migrations
-- (infra/postgres/init/01-roles.sh, or the integration test setup).
--
-- Model: each request runs in one transaction that sets app.org_id, app.user_id and app.role with
-- set_config(..., true). Policies read them through the helpers below. With no context every helper returns
-- NULL, every predicate is false or NULL, and no row is visible or writable: the system fails closed.

-- ---------------------------------------------------------------------------------------------------------------
-- 0. Default privileges
-- ---------------------------------------------------------------------------------------------------------------
-- Objects s360_owner creates from here on grant nothing to anyone until a grant says so. Functions are the case
-- that matters: PostgreSQL grants EXECUTE to PUBLIC by default. (Functions of extensions created later by
-- s360_owner are affected too; grant them explicitly if needed.)
ALTER DEFAULT PRIVILEGES FOR ROLE s360_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE s360_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE s360_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Context helpers
-- ---------------------------------------------------------------------------------------------------------------
-- NULLIF: once a transaction-local setting has gone out of scope, current_setting(..., true) returns '' rather
-- than NULL on that connection. Plain SQL (no SET clause) so the planner can inline them into policies.
-- A malformed app.org_id or app.user_id raises an error on the uuid cast, which also fails closed.

CREATE FUNCTION public.app_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION public.app_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid $$;

-- text, not the user_role enum: an unknown value simply matches no policy instead of raising.
CREATE FUNCTION public.app_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(pg_catalog.current_setting('app.role', true), '') $$;

-- SFC staff are identified by role, never by organisation type (L2 Table 12).
CREATE FUNCTION public.app_is_staff() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(public.app_role() IN ('TECHNICIAN', 'ADMIN'), false) $$;

-- Incident visibility (L2 Table 14) in one place: the incidents policy and app_can_notify() both use it, so the
-- two can never disagree.
CREATE FUNCTION public.app_can_see_incident(p_organization_id uuid, p_reporter_id uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT COALESCE(
      public.app_is_staff()
      OR (
        p_organization_id = public.app_org_id()
        AND (public.app_role() = 'MANAGER' OR p_reporter_id = public.app_user_id())
      ),
      false)
  $$;

-- Notification recipient check (used by both notifications insert policies). SECURITY DEFINER because the
-- recipient is usually invisible to the actor under RLS (a reporter cannot see the analyst's row); it returns a
-- boolean only, and only about an incident the caller can already see. A recipient qualifies when they can see the incident too: its
-- reporter, a MANAGER of its organisation, or SFC staff (staff role in the PROVIDER organisation).
CREATE FUNCTION public.app_can_notify(p_recipient uuid, p_incident uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM public.incidents i
        JOIN public.users r ON r.id = p_recipient
        JOIN public.organizations ro ON ro.id = r.organization_id
       WHERE i.id = p_incident
         AND public.app_can_see_incident(i.organization_id, i.reporter_id)
         AND (
           r.id = i.reporter_id
           OR (r.organization_id = i.organization_id AND r.role = 'MANAGER')
           OR (r.role IN ('TECHNICIAN', 'ADMIN') AND ro.type = 'PROVIDER')
         )
    )
  $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Row-Level Security: enabled and forced on every table (the owner is subject to it too)
-- ---------------------------------------------------------------------------------------------------------------

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incident_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incident_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incident_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incident_reference_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_reference_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.report_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_jobs FORCE ROW LEVEL SECURITY;

-- organizations: staff see all; everyone else sees their own row. Only an ADMIN creates or edits them.
CREATE POLICY organizations_select ON public.organizations FOR SELECT
  USING (public.app_is_staff() OR id = public.app_org_id());
CREATE POLICY organizations_insert ON public.organizations FOR INSERT
  WITH CHECK (public.app_role() = 'ADMIN');
CREATE POLICY organizations_update ON public.organizations FOR UPDATE
  USING (public.app_role() = 'ADMIN')
  WITH CHECK (public.app_role() = 'ADMIN');

-- users: self; a MANAGER sees their organisation; staff see all. Only an ADMIN creates users; a user updates
-- their own row (password, language, TOTP), an ADMIN any row. users_guard_update restricts which columns.
CREATE POLICY users_select ON public.users FOR SELECT
  USING (
    id = public.app_user_id()
    OR (public.app_role() = 'MANAGER' AND organization_id = public.app_org_id())
    OR public.app_is_staff()
  );
CREATE POLICY users_insert ON public.users FOR INSERT
  WITH CHECK (public.app_role() = 'ADMIN');
CREATE POLICY users_update ON public.users FOR UPDATE
  USING (id = public.app_user_id() OR public.app_role() = 'ADMIN')
  WITH CHECK (id = public.app_user_id() OR public.app_role() = 'ADMIN');

-- incident_categories: reference data readable by any authenticated context; tuned by an ADMIN (L1 §7).
CREATE POLICY incident_categories_select ON public.incident_categories FOR SELECT
  USING (public.app_user_id() IS NOT NULL);
CREATE POLICY incident_categories_update ON public.incident_categories FOR UPDATE
  USING (public.app_role() = 'ADMIN')
  WITH CHECK (public.app_role() = 'ADMIN');

-- incidents (L2 Table 14): staff all; MANAGER their organisation; USER their own reports.
-- A report is always created by its reporter in their own organisation; only staff update incidents.
CREATE POLICY incidents_select ON public.incidents FOR SELECT
  USING (public.app_can_see_incident(organization_id, reporter_id));
CREATE POLICY incidents_insert ON public.incidents FOR INSERT
  WITH CHECK (organization_id = public.app_org_id() AND reporter_id = public.app_user_id());
CREATE POLICY incidents_update ON public.incidents FOR UPDATE
  USING (public.app_is_staff())
  WITH CHECK (public.app_is_staff());

-- Child tables: same visibility as the parent incident. The EXISTS subquery on incidents is itself filtered by
-- the incidents policy for the current context, so the two can never disagree. The organisation predicate in
-- front lets the planner discard other tenants' rows by index before the subquery runs; the composite foreign
-- key (incident_id, organization_id) guarantees the denormalised value matches the parent.

-- incident_status_history: append-only (no UPDATE grant); the actor is always the current user. Only staff
-- record transitions; the reporter records the creation entry (NULL -> NEW) of their own incident, nothing else,
-- so the timeline (BF06) cannot be forged from the client side.
CREATE POLICY incident_status_history_select ON public.incident_status_history FOR SELECT
  USING (
    (public.app_is_staff() OR organization_id = public.app_org_id())
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_status_history.incident_id)
  );
CREATE POLICY incident_status_history_insert ON public.incident_status_history FOR INSERT
  WITH CHECK (
    changed_by = public.app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.incidents i
       WHERE i.id = incident_status_history.incident_id
         AND (
           public.app_is_staff()
           OR (
             incident_status_history.from_status IS NULL
             AND incident_status_history.to_status = 'NEW'
             AND i.reporter_id = public.app_user_id()
           )
         )
    )
  );

-- incident_messages: internal notes are visible to, and written by, staff only.
CREATE POLICY incident_messages_select ON public.incident_messages FOR SELECT
  USING (
    (NOT is_internal OR public.app_is_staff())
    AND (public.app_is_staff() OR organization_id = public.app_org_id())
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_messages.incident_id)
  );
CREATE POLICY incident_messages_insert ON public.incident_messages FOR INSERT
  WITH CHECK (
    sender_id = public.app_user_id()
    AND (NOT is_internal OR public.app_is_staff())
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_messages.incident_id)
  );

-- attachments: append-only evidence.
CREATE POLICY attachments_select ON public.attachments FOR SELECT
  USING (
    (public.app_is_staff() OR organization_id = public.app_org_id())
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = attachments.incident_id)
  );
CREATE POLICY attachments_insert ON public.attachments FOR INSERT
  WITH CHECK (
    uploaded_by = public.app_user_id()
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = attachments.incident_id)
  );

-- incident_reference_counters: global per year (L2 §7.3), shared by every tenant, so no runtime role touches it
-- directly (one tenant could otherwise exhaust or rewind the sequence for all). next_incident_reference() is the
-- only way in; it runs as s360_owner, which this policy admits.
CREATE POLICY incident_reference_counters_owner ON public.incident_reference_counters FOR ALL TO s360_owner
  USING (true)
  WITH CHECK (true);

-- notifications: read and marked read by their recipient only. They are written in the transaction of the
-- change that causes them (L2 §5, risk R02), so by the actor, for another user: app_can_notify() requires that
-- the actor sees the incident and that the recipient is related to it. The composite foreign key
-- (user_id, organization_id) makes organization_id the recipient's organisation. incident_id keeps a plain foreign
-- key: a staff recipient belongs to the PROVIDER organisation, not the incident's, so (incident_id,
-- organization_id) cannot reference incidents.
CREATE POLICY notifications_select ON public.notifications FOR SELECT
  USING (user_id = public.app_user_id());
CREATE POLICY notifications_update ON public.notifications FOR UPDATE
  USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());
-- A reporter or a manager only ever causes NEW_INCIDENT and NEW_MESSAGE; ASSIGNMENT, STATUS_UPDATE and SLA_BREACH
-- come from staff actions or from the worker's jobs (L2 Table 11), so the worker has its own policy.
CREATE POLICY notifications_app_insert ON public.notifications FOR INSERT TO s360_app
  WITH CHECK (
    public.app_user_id() IS NOT NULL
    AND incident_id IS NOT NULL
    AND public.app_can_notify(user_id, incident_id)
    AND (public.app_is_staff() OR type IN ('NEW_INCIDENT', 'NEW_MESSAGE'))
  );
CREATE POLICY notifications_worker_insert ON public.notifications FOR INSERT TO s360_worker
  WITH CHECK (
    public.app_user_id() IS NOT NULL
    AND incident_id IS NOT NULL
    AND public.app_can_notify(user_id, incident_id)
  );

-- Per-user tables: only the owning user, for every command.
CREATE POLICY device_tokens_own ON public.device_tokens FOR ALL
  USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());

-- Token and idempotency tables. Looking a token up by hash before authentication (refresh, password reset) has
-- no context: it will go through SECURITY DEFINER functions added by the auth task, like the e-mail lookup.
CREATE POLICY refresh_tokens_own ON public.refresh_tokens FOR ALL
  USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());
CREATE POLICY password_reset_tokens_own ON public.password_reset_tokens FOR ALL
  USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());
CREATE POLICY idempotency_keys_own ON public.idempotency_keys FOR ALL
  USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());

-- report_jobs: the requester and staff. Non-staff reports are limited to the requester's organisation, in every
-- WITH CHECK. The API only creates jobs; the worker records their outcome under the requester's context (column
-- grant below: never organization_id, so a job can never be widened to another tenant).
CREATE POLICY report_jobs_select ON public.report_jobs FOR SELECT
  USING (requested_by = public.app_user_id() OR public.app_is_staff());
CREATE POLICY report_jobs_insert ON public.report_jobs FOR INSERT
  WITH CHECK (
    requested_by = public.app_user_id()
    AND (public.app_is_staff() OR organization_id = public.app_org_id())
  );
CREATE POLICY report_jobs_worker_update ON public.report_jobs FOR UPDATE TO s360_worker
  USING (requested_by = public.app_user_id() OR public.app_is_staff())
  WITH CHECK (
    (requested_by = public.app_user_id() OR public.app_is_staff())
    AND (public.app_is_staff() OR organization_id = public.app_org_id())
  );

-- outbox_events (L2 §6.2): the API appends events for what it may act on; the relay reads every tenant's
-- pending events and marks them published, so its policies are scoped to s360_worker only.
CREATE POLICY outbox_events_app_insert ON public.outbox_events FOR INSERT TO s360_app
  WITH CHECK (
    public.app_user_id() IS NOT NULL
    AND (public.app_is_staff() OR organization_id = public.app_org_id())
  );
CREATE POLICY outbox_events_worker_select ON public.outbox_events FOR SELECT TO s360_worker
  USING (true);
CREATE POLICY outbox_events_worker_update ON public.outbox_events FOR UPDATE TO s360_worker
  USING (true)
  WITH CHECK (true);

-- audit_logs: the audit.write consumer inserts; no policy lets anyone read, update or delete.
CREATE POLICY audit_logs_worker_insert ON public.audit_logs FOR INSERT TO s360_worker
  WITH CHECK (true);

-- ---------------------------------------------------------------------------------------------------------------
-- 3. users: columns RLS cannot protect
-- ---------------------------------------------------------------------------------------------------------------
-- RLS decides which rows a role may update, not which columns or values. Column grants (section 5) keep the
-- credential columns out of s360_app's reach; this trigger guards the values of the rest, and also applies to
-- the SECURITY DEFINER auth functions that will change credentials (tasks 12–15).
-- SECURITY INVOKER: it reads the caller's context and needs no extra privilege.

CREATE FUNCTION public.users_guard_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  is_admin boolean := COALESCE(public.app_role() = 'ADMIN', false);
  is_self boolean := COALESCE(OLD.id = public.app_user_id(), false);
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'users.id cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT is_admin AND (
    NEW.role IS DISTINCT FROM OLD.role
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.email IS DISTINCT FROM OLD.email
  ) THEN
    RAISE EXCEPTION 'only an ADMIN may change role, organization_id, is_active or email'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A lower session_version would make revoked access tokens valid again (L2 §8.2).
  IF NEW.session_version < OLD.session_version THEN
    RAISE EXCEPTION 'session_version cannot decrease' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.session_version > OLD.session_version AND NOT (is_admin OR is_self) THEN
    RAISE EXCEPTION 'session_version may only be raised by the user or an ADMIN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Replay protection (L2 §8.2): TOTP steps are absolute time counters, so the last accepted one never goes back,
  -- not even when 2FA is re-enrolled.
  IF OLD.totp_last_step IS NOT NULL
     AND (NEW.totp_last_step IS NULL OR NEW.totp_last_step < OLD.totp_last_step) THEN
    RAISE EXCEPTION 'totp_last_step cannot decrease' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- These changes must invalidate every outstanding access token at once (L2 §8.2), whatever code made them.
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.session_version := GREATEST(NEW.session_version, OLD.session_version + 1);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_guard_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_guard_update();

-- A new user starts without 2FA, on the first session version, and must change the password the ADMIN set.
-- Prisma always sends these three columns with their @default values, so s360_app holds INSERT on them (column
-- grants, section 5) and this trigger, not the grant, fixes their values. The other credential columns
-- (totp_secret_enc, totp_last_step, locked_until, last_login_at) are outside the INSERT grant altogether.
CREATE FUNCTION public.users_guard_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  NEW.is_2fa_enabled := false;
  NEW.must_change_password := true;
  NEW.session_version := 1;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_guard_insert
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_guard_insert();

-- Staff see every tenant (app_is_staff() is role-based, L2 Table 12), so a staff role outside the PROVIDER
-- organisation would open all tenants to a client employee. SECURITY DEFINER: the organisation row may be
-- invisible to the caller. Trigger functions cannot be called directly, so this exposes nothing callable.
CREATE FUNCTION public.users_guard_staff_org() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF NEW.role IN ('TECHNICIAN', 'ADMIN') AND NOT EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = NEW.organization_id AND o.type = 'PROVIDER'
  ) THEN
    RAISE EXCEPTION 'TECHNICIAN and ADMIN users must belong to the PROVIDER organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_guard_staff_org
  BEFORE INSERT OR UPDATE OF role, organization_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_guard_staff_org();

-- The same rule seen from the organisation: the PROVIDER cannot change type while it has staff.
CREATE FUNCTION public.organizations_guard_type() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF OLD.type = 'PROVIDER' AND NEW.type IS DISTINCT FROM OLD.type AND EXISTS (
    SELECT 1 FROM public.users u WHERE u.organization_id = OLD.id AND u.role IN ('TECHNICIAN', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'TECHNICIAN and ADMIN users must belong to the PROVIDER organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER organizations_guard_type
  BEFORE UPDATE OF type ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_guard_type();

-- ---------------------------------------------------------------------------------------------------------------
-- 3b. incidents: columns RLS cannot protect
-- ---------------------------------------------------------------------------------------------------------------
-- Staff may update any incident (RLS), but identity, provenance and the confidentiality flag are fixed at
-- creation: flipping is_anonymous would expose a confidential reporter to their manager (AGENTS rule 5). A
-- reporter creates an incident in its initial state only, stamped by the database clock; triage fields are the
-- analysts' (L2 §7.5, §8.3). The reference is always drawn here, whatever the caller supplied: a reference chosen
-- by a caller could take a number the counter hands out later, and every later creation would then fail.
-- The assignee must be an active staff user at assignment (insert, or a change of assigned_to). Deactivating an
-- analyst who still has open incidents is refused by the admin service (task 30), not here.
-- SECURITY DEFINER: the assignee's row is generally invisible to the caller, and the counter is the owner's.

CREATE FUNCTION public.incidents_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT public.app_is_staff() THEN
    NEW.status := 'NEW';
    NEW.assigned_to := NULL;
    NEW.acknowledged_at := NULL;
    NEW.resolved_at := NULL;
    NEW.closed_at := NULL;
    NEW.resolution_notes := NULL;
    NEW.version := 1;
    -- updated_at follows: a client clock behind the database would otherwise trip chk_incidents_updated_at.
    NEW.created_at := now();
    NEW.updated_at := NEW.created_at;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.reference IS DISTINCT FROM OLD.reference
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
    OR NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous
    OR NEW.severity_initial IS DISTINCT FROM OLD.severity_initial
    OR NEW.severity_answers IS DISTINCT FROM OLD.severity_answers
    OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'incidents identity, provenance and confidentiality columns cannot change'
      USING ERRCODE = 'insufficient_privilege',
            DETAIL = 'id, reference, organization_id, reporter_id, is_anonymous, severity_initial, '
                     || 'severity_answers, client_request_id, created_at';
  END IF;
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
     AND NOT EXISTS (
       SELECT 1 FROM public.users u
        WHERE u.id = NEW.assigned_to AND u.role IN ('TECHNICIAN', 'ADMIN') AND u.is_active
     ) THEN
    RAISE EXCEPTION 'incidents.assigned_to must be an active staff user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.reference := public.next_incident_reference();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER incidents_guard
  BEFORE INSERT OR UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.incidents_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- 3c. incident_status_history: the timeline (BF06) is stamped by the database clock
-- ---------------------------------------------------------------------------------------------------------------
-- The policy fixes who may record what; this fixes when, so no transition can be back-dated. One creation entry
-- per incident: unique index incident_status_history_one_creation_key (init migration).

CREATE FUNCTION public.incident_status_history_stamp() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  NEW.changed_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER incident_status_history_stamp
  BEFORE INSERT ON public.incident_status_history
  FOR EACH ROW EXECUTE FUNCTION public.incident_status_history_stamp();

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Pre-authentication e-mail lookup (L2 Table 14)
-- ---------------------------------------------------------------------------------------------------------------
-- Login has no tenant context yet, so RLS hides every user. This function runs as its owner and returns only
-- what the login path needs: never names, phone, e-mail or other users' rows. Fixed search_path so no object
-- planted elsewhere can be resolved; public is writable only by s360_owner. text parameter because there is
-- no implicit text -> citext cast for function resolution; the comparison is case-insensitive through citext.

CREATE FUNCTION public.auth_find_user_by_email(p_email text)
  RETURNS TABLE (
    id uuid,
    organization_id uuid,
    role public.user_role,
    password_hash text,
    totp_secret_enc bytea,
    totp_last_step bigint,
    is_2fa_enabled boolean,
    must_change_password boolean,
    locked_until timestamptz,
    is_active boolean,
    session_version integer,
    organization_is_active boolean
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT u.id, u.organization_id, u.role, u.password_hash, u.totp_secret_enc, u.totp_last_step,
           u.is_2fa_enabled, u.must_change_password, u.locked_until, u.is_active, u.session_version,
           o.is_active
      FROM public.users u
      JOIN public.organizations o ON o.id = u.organization_id
     WHERE u.email = p_email::public.citext
  $$;

-- FORCE ROW LEVEL SECURITY applies to the owner as well, so the SECURITY DEFINER functions and guard triggers
-- need these read policies (the e-mail lookup, app_can_notify, users_guard_staff_org, organizations_guard_type,
-- incidents_guard). They grant nothing new: s360_owner owns the tables and is never used at runtime (L2 Table 13).
CREATE POLICY users_auth_lookup ON public.users FOR SELECT TO s360_owner USING (true);
CREATE POLICY organizations_auth_lookup ON public.organizations FOR SELECT TO s360_owner USING (true);
CREATE POLICY incidents_owner_lookup ON public.incidents FOR SELECT TO s360_owner USING (true);

-- ---------------------------------------------------------------------------------------------------------------
-- 4b. Incident references SFC-YYYY-NNNNNN (L2 §7.3)
-- ---------------------------------------------------------------------------------------------------------------
-- Called only by incidents_guard, inside the incident creation transaction: the counter row stays locked until
-- COMMIT, so references are gap-free and unique under concurrency, and a rolled-back creation gives its number
-- back. No runtime role may execute it or touch the counter (policy incident_reference_counters_owner), so no
-- caller can draw numbers without creating an incident, or choose the year. SECURITY INVOKER: it runs as
-- s360_owner inside the SECURITY DEFINER guard. The year is the calendar year in Cameroon, where SFC operates.

CREATE FUNCTION public.next_incident_reference() RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  current_year integer := EXTRACT(YEAR FROM now() AT TIME ZONE 'Africa/Douala')::integer;
  next_value integer;
BEGIN
  -- The six-digit limit is enforced by the CHECK constraints on the counter.
  INSERT INTO public.incident_reference_counters AS c (year, last_value) VALUES (current_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = c.last_value + 1
    RETURNING c.last_value INTO next_value;
  RETURN 'SFC-' || to_char(current_year, 'FM0000') || '-' || to_char(next_value, 'FM000000');
END
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Privileges (L2 Table 13)
-- ---------------------------------------------------------------------------------------------------------------

-- Default privileges are set at the top of this file (section 0), so no function above has a PUBLIC EXECUTE;
-- the explicit REVOKE keeps that true even if this file is reordered. Extension functions (citext) keep theirs:
-- the citext operators that s360_app uses for e-mail comparisons need them.

-- Clean slate, then explicit grants only.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, s360_app, s360_worker, s360_metrics;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, s360_app, s360_worker, s360_metrics;
REVOKE EXECUTE ON FUNCTION
  public.app_org_id(), public.app_user_id(), public.app_role(), public.app_is_staff(),
  public.app_can_see_incident(uuid, uuid), public.app_can_notify(uuid, uuid),
  public.users_guard_update(), public.users_guard_insert(), public.users_guard_staff_org(),
  public.organizations_guard_type(),
  public.incidents_guard(), public.incident_status_history_stamp(), public.auth_find_user_by_email(text),
  public.next_incident_reference()
  FROM PUBLIC;

-- Policies run with the caller's privileges, so both runtime roles need the helpers. app_can_notify() is also
-- the worker's: it writes notifications for the jobs of L2 Table 11 (SLA breach) under the same policy.
GRANT EXECUTE ON FUNCTION
  public.app_org_id(), public.app_user_id(), public.app_role(), public.app_is_staff(),
  public.app_can_see_incident(uuid, uuid), public.app_can_notify(uuid, uuid)
  TO s360_app, s360_worker;
GRANT EXECUTE ON FUNCTION public.auth_find_user_by_email(text) TO s360_app;

-- users: column grants. password_hash and totp_secret_enc are never readable by a runtime role (the login path
-- reads them through auth_find_user_by_email); the Prisma client omits them globally. Credentials, 2FA state,
-- lockout and session_version are not updatable: they change only through the SECURITY DEFINER auth functions of
-- tasks 12–15. updated_at is in the UPDATE list because Prisma sets @updatedAt on every update. An ADMIN creates a
-- user with a password and a profile only: TOTP secret and step, lockout and last login are not insertable;
-- is_2fa_enabled, must_change_password and session_version are (Prisma sends them) but users_guard_insert fixes
-- their values.
GRANT SELECT (
    id, organization_id, first_name, last_name, email, phone, role, preferred_language, totp_last_step,
    is_2fa_enabled, must_change_password, session_version, locked_until, last_login_at, is_active, created_at,
    updated_at
  ) ON public.users TO s360_app, s360_worker;
GRANT INSERT (
    id, organization_id, first_name, last_name, email, phone, password_hash, role, preferred_language, is_active,
    is_2fa_enabled, must_change_password, session_version, created_at, updated_at
  ) ON public.users TO s360_app;
GRANT UPDATE (
    first_name, last_name, phone, preferred_language, role, is_active, organization_id, email, updated_at
  ) ON public.users TO s360_app;

-- s360_app (API): DML on business tables, always under RLS. DELETE only where the domain removes rows.
GRANT SELECT, INSERT, UPDATE ON public.organizations TO s360_app;
GRANT SELECT, UPDATE ON public.incident_categories TO s360_app;
GRANT SELECT, INSERT, UPDATE ON public.incidents TO s360_app;
GRANT SELECT, INSERT ON public.incident_status_history TO s360_app;
GRANT SELECT, INSERT ON public.incident_messages TO s360_app;
GRANT SELECT, INSERT ON public.attachments TO s360_app;
-- incident_reference_counters: nothing; incidents_guard draws the references.
GRANT SELECT, INSERT ON public.notifications TO s360_app;
GRANT UPDATE (is_read) ON public.notifications TO s360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO s360_app;
-- Token tables: issue, look up, delete (logout). Rotation and revocation are SECURITY DEFINER functions
-- (tasks 13–14), so a request can never un-revoke a token or extend its expiry.
GRANT SELECT, INSERT, DELETE ON public.refresh_tokens TO s360_app;
GRANT SELECT, INSERT ON public.password_reset_tokens TO s360_app;
GRANT SELECT, INSERT, DELETE ON public.idempotency_keys TO s360_app;
GRANT SELECT, INSERT ON public.report_jobs TO s360_app;
-- Append-only: no SELECT, so INSERT ... RETURNING is not possible either (use createMany or $executeRaw).
GRANT INSERT ON public.outbox_events TO s360_app;
GRANT USAGE ON SEQUENCE public.outbox_events_id_seq TO s360_app;
-- audit_logs: nothing for s360_app.

-- s360_worker: outbox relay, audit writer and the jobs of L2 Table 11, under RLS with a job-supplied context.
GRANT SELECT ON public.outbox_events TO s360_worker;
GRANT UPDATE (published_at) ON public.outbox_events TO s360_worker;
GRANT INSERT ON public.audit_logs TO s360_worker;
GRANT USAGE ON SEQUENCE public.audit_logs_id_seq TO s360_worker;
GRANT SELECT ON public.incidents TO s360_worker;
GRANT SELECT ON public.incident_categories TO s360_worker;
GRANT SELECT, DELETE ON public.device_tokens TO s360_worker;
GRANT INSERT ON public.notifications TO s360_worker;
GRANT SELECT ON public.report_jobs TO s360_worker;
GRANT UPDATE (status, storage_key, error_code, completed_at) ON public.report_jobs TO s360_worker;

-- s360_metrics: no table privileges at all (pg_monitor only, granted at role creation).
