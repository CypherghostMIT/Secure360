-- Category seed (task 5, db:seed): the reference data is written by s360_owner, which FORCE ROW LEVEL SECURITY
-- subjects to RLS like everyone else, and incident_categories had no INSERT policy for anyone. Both policies are
-- scoped to s360_owner, which is never used at runtime (L2 Table 13); s360_app and s360_worker gain nothing, and
-- their grants are unchanged. The seed sets app.role = 'ADMIN' with set_config(..., true) (WORKFLOW §3.4): RLS
-- and triggers are never disabled.

-- Same pattern as users_auth_lookup and organizations_auth_lookup: the seed reads every code to upsert and to
-- deactivate codes that left packages/shared, before any user exists.
CREATE POLICY incident_categories_owner_lookup ON public.incident_categories FOR SELECT TO s360_owner
  USING (true);

-- Updates (labels, deactivation) already go through incident_categories_update, which requires ADMIN.
CREATE POLICY incident_categories_owner_insert ON public.incident_categories FOR INSERT TO s360_owner
  WITH CHECK (public.app_role() = 'ADMIN');
