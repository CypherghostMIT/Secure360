# Secure360 — Build checklist (carried over from L1, L2, L3)

Items decided during design that must not be forgotten during the build. Tick them in the PR that implements them.

## From L3 (UI/UX)

- [ ] **Contrast tokens (WCAG AA)** — badge fills keep their colours; text colours change: Moderate and offline-banner
      text `#8F5600`, High text `#B34700`. Put them in `packages/shared` design tokens at the start of S8; used by mobile and web.
- [ ] **Web login** — the "Sign in" button and "Forgot password?" link must be visible (Stitch exported them with
      opacity 0). Check in S11; fix in Stitch at the next export.
- [ ] **Confidential conversation** — the analyst greets a confidential reporter with "Hello," and never by name
      (M13, M14 and the web conversation). Fix in Stitch and in the real app; add a test that the API never returns
      the reporter's name to staff for confidential reports.
- [ ] **French variants** — M06, M08a, M08b (Fraud & scams, My phone), M09, M10, M11a, M11b, W04, W06;
      check that no French label or button is truncated.
- [ ] Re-render tall mobile mockups with the viewport at full page height (fixed bottom bars).
- [ ] Figma file if the supervisor requires it.

## From L2 (architecture) — open items

- [ ] **O1** (S8 day 1) Choose and verify certificate-pinning and root-detection libraries for Expo SDK 57 (development build).
- [ ] **O2** (S8 day 1) Verify `@react-native-firebase/messaging` and `react-native-mmkv` v4 on SDK 57; fallback to Expo Notifications needs supervisor approval.
- [ ] **O3** (before S6) SFC SMTP relay and sender domain (SPF/DKIM).
- [ ] **O4** (before S12) Off-host backup target in Cameroon.
- [ ] **O5** (before S12) Final domain names and DNS.
- [ ] **O6** (optional) Host RAM upgrade to 8 GB.
- [ ] **O7** Retention periods and SLA targets aligned with SFC contracts and Law 2024/017.
- [ ] **O8** (S5 spike) Measure the overhead of one Prisma interactive transaction per request; tune the pool.
- [ ] **O8 pool tuning:** set `connectionTimeoutMillis` before deployment (the pool currently waits forever); the
      pool-timeout → 503 mapping depends on it.

## Task 7 — Error handling

- [x] Replace Express default HTML error pages (413 and others) with the JSON envelope; never expose stack traces.
- [ ] **Prisma upgrades:** `tests/integration/db-errors.test.ts` must stay green (P2039/P2010 +
      `meta.driverAdapterError` shape).

## Task 9 — Redis and rate limiting

- [x] **Task 10:** switch rate-limit e-mail keys to HMAC-SHA256 with a server key (`hashEmailKey` in
      `apps/api/src/platform/cache/rate-limit-policies.ts`). An unkeyed hash of an e-mail can be reversed by trying
      known e-mail addresses.
- [ ] **Task 32:** add the Redis check to `/health/ready` (no health routes existed in task 9). Redis down must not
      make the API unready on its own: the rate limiter falls back in-process (L2 §9.2).
- [ ] **Every route mounting a rate-limit policy:** the key field must be REQUIRED in its Zod schema, with a test
      proving a request without it gets 400 and cannot bypass the limit (the middleware lets a keyless request
      through to the validator). Use `emailKey` / `deviceIdKey` from `apps/api/src/http/rate-limit.ts` for client
      values. Flag-mode routes (password.forgot, client.errors) must test that `req.context.rateLimited` skips the work.
- [ ] **BullMQ task:** use bullmq 6.x (ioredis optional peer) so ioredis stays a single copy (`npm ls ioredis`);
      keep `protocol: 2`; BullMQ workers get their own connection with `maxRetriesPerRequest: null`, never the
      limiter connection.

## Task 49 — Production Docker Compose

- [ ] **Production secrets:** ensure secret files are readable by the container users (postgres uid 70, redis uid 999)
      on Linux — mode 600 with host ownership will not work; use a root init step or matching ownership.
- [ ] API behind Nginx: `TRUST_PROXY=1`.
- [ ] **Task 49 (from task 10):** production compose uses the secrets `data_encryption_keys` and `rate_limit_hmac_key`
      (the old `data_encryption_key` is removed); `DATA_ENCRYPTION_ACTIVE_KEY_ID` is set for the api AND the worker;
      rotation = deploy the new key everywhere first, then switch the active id.
- [ ] **Task 49 (from task 11):** production compose adds the secret `jwt_signing_keys` (`<id>:<base64 of 32–64 bytes>`
      per line) and sets `JWT_ACTIVE_KEY_ID` for the api; `jwt_secret` / `JWT_SECRET` no longer exist. Rotation (yearly,
      L2 §8.6) = deploy the ring with the new key to every replica, switch the active id, remove the old key after 1 h.
- [ ] Prisma schema-engine binary: install scripts are not approved, so the binary downloads on first CLI use; the production migrate step needs it available (no internet on the server, or pre-fetched in the image).

## Task 4 — Database schema and RLS

- [x] Prisma 7.10.1 installed before min-release-age (security fix for GHSA-ggr8-5vv4-36mx, GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3); provenance: @prisma/client and @prisma/adapter-pg attested (prisma/orm publish workflow); prisma CLI registry signature only, no attestation (dev-only tool, never shipped).
- [x] body-parser <version> and fast-uri <version> installed before min-release-age (security fixes GHSA-27r3-jxmh-p828 high, GHSA-w74x-v6f9-j3xg and related moderate); registry signatures verified. Zod 4.6.7 (GHSA-mrhx-c7xc-m3w5) installed normally.
- [x] npm override: effect 3.22.4, unscoped (its only consumer is @prisma/config) — GHSA-7589-6fvf-x4pw (ReDoS, high). No stable Prisma 7.x ships a fixed effect (7.10.1 pins 3.20.0; 7.11 only dev, 8.x only RC). Same major (3.x); validated by prisma generate, migrate deploy, drift check and 240 integration tests. A scoped override under @prisma/config was not applied by npm with an existing lock file. Remove the override when a stable Prisma 7.x ships effect > 3.22.0.

## Task 10 — Crypto utilities

- [ ] **Attachments task:** the AAD for encrypted files binds the attachment id (`aadFor('attachments.file', id)`);
      consider binding the organization id too.

## Task 11 — JWT utilities and authenticate

- [x] JWT signing secrets held as KeyObjects with kid (two valid during rotation, L2 §8.2); no plain secret string in config.
- [ ] **Residual risk (accepted, L2 §9.2):** while Redis is down, `authenticate` trusts the token's sv and skips the
      deny-list, so a logged-out or revoked access token stays valid until Redis returns or the token expires (≤ 1 h).
      Refresh still checks the database. Record it in the security report.

## Task 12 — Authentication

- [ ] Password hashing uses bcryptjs (pure JS, bcrypt $2b$ hashes, async API) to avoid native install scripts; measure hash time at cost 12 on the target server during task 12 and switch to native bcrypt if login latency exceeds the BNF01 budget.
- [ ] Supply the `SessionVersionLoader` (withTenant + set-if-greater write-back). `createAuthenticate` cannot be built
      without it (required in `AuthenticateDeps`, checked at runtime too), so `authenticate` cannot be mounted before
      it exists; a cache miss always reads the database. (`apps/api/src/http/authenticate.ts`)
- [ ] The `SessionVersionLoader` reads the caller's own row via RLS in `withTenant(claims)` (`users_select` allows
      `id = app_user_id()`; `session_version` and `is_active` are in the SELECT grant) and returns sv + is_active.
      Every `sv:{userId}` write, everywhere, uses one set-if-greater Lua script; build keys with `sessionVersionKey()`.
- [ ] Login seeds `sv:{userId}` (set-if-greater) from the `auth_find_user_by_email` row.
- [ ] Login timing: the unknown-e-mail path must match the known-e-mail path end-to-end (lookup + dummy bcrypt), not only bcrypt; add a test.

## Task 13 — Refresh rotation

- [ ] Refresh re-reads role, organization, sv and is_active from the DB before issuing an access token (never copies
      them from the old token); inactive → revoke the family. A stale-sv access token answers TOKEN_EXPIRED so the
      client refreshes into the new role/sv; refresh is where a revoked session ends.
- [ ] Reuse detection deny-lists with `denyListKey(jti)` (value "1", TTL = token exp − now) if it can know the live
      jtis; the sv increment of "revoke all the user's sessions" already invalidates them.

## Task 14 / Task 30 — Credential and account changes

- [ ] Password reset, password change, deactivation and role change increment `session_version` AND update
      `sv:{userId}` (set-if-greater, after commit); reset and deactivation also revoke all refresh families; role change
      keeps them (the client refreshes into the new role).
- [ ] Logout deny-lists the presented access token: `denyListKey(req.context.tokenId)`, value "1", PX = exp − now.

## 2FA verification task

- [ ] MFA token jti single use (Redis `SET NX` until exp); at most 5 code attempts per MFA token, then the token is
      burned; TOTP step replay check (L2 §8.2: reject any step not greater than the last accepted one).

## Repository and publication

- [ ] Ask the supervisor whether the specification and the deliverables (L1–L3) may be published in this public
      repository. Until then they stay in `docs/reference/` (git-ignored).

## From L1 (needs analysis)

- [ ] Supervisor sign-off on Decision Record D1–D9; issue specification v1.2 with the adopted stack.
- [ ] Week 2 interviews (Appendix A) — integrate findings.
- [ ] Verify operator hotline numbers before showing them in Help (M20), or remove them.
- [ ] S12 load test: confirm synchronous stdout logging (pino.destination sync:true, PR #44) has no measurable p99 latency impact at L2 peak load (~50 req/s); if it does, switch to async + awaited flush before exit.
