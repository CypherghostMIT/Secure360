# Secure360 — instructions for AI coding agents

Read this file completely before writing code. It applies to every AI tool used on this repository
(Claude Code with Task Master, Gemini / Antigravity). Human rules are in `docs/`; this file is the short version.

## What this project is

Secure360 is a cybersecurity incident reporting platform for organisations in Cameroon, operated by
Security First Cameroon (SFC). Employees report incidents from an Android app (often offline); SFC analysts
triage them on a web dashboard. Data is personal and sensitive and is hosted in Cameroon (Law 2024/017).

Reference documents (local, git-ignored): `docs/reference/` — specification, L1 needs analysis (Decision Record
D1–D9), L2 architecture, L3 mockups. When a task conflicts with them, stop and say so instead of improvising.
The work plan is in Task Master (`.taskmaster/`); work on one task at a time and reference its id.

## Repository

| Path              | Content                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | Node.js 24 + Express 5 + TypeScript + Prisma (PostgreSQL 16) + Redis 8 + BullMQ. API and worker entry points.   |
| `apps/mobile`     | Expo SDK 57 (React Native), TypeScript, Expo Router, Redux Toolkit + RTK Query, MMKV, NativeWind.               |
| `apps/web`        | React 19 + Vite, TanStack Query v5, Zustand, React Router v7, shadcn/ui, Tailwind v4, Recharts.                 |
| `packages/shared` | Zod schemas (single source of truth), types, error codes, category codes, i18n keys, design tokens.             |
| `infra`           | Docker Compose, Nginx, Prometheus/Grafana, backup.                                                              |
| `design`          | Stitch HTML exports and PNG renders of the L3 screens — visual reference only, never copied as production code. |

Commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run verify` (everything CI runs).

## Non-negotiable rules

1. **Layers (API):** Router → Controller → Service → Repository. Controllers do HTTP only; services hold
   business rules and never import Express; repositories are the only place with Prisma calls. ESLint enforces this.
2. **Tenant isolation:** every tenant-scoped query runs inside the request's tenant transaction
   (`withTenant()` sets `app.org_id`, `app.user_id`, `app.role` with `set_config(..., true)`).
   Never use a client that bypasses Row-Level Security. Never add `organization_id` filters as a substitute for RLS.
3. **SQL:** Prisma queries or the `$queryRaw` tagged template only. Never `$queryRawUnsafe`, never string-built SQL.
4. **Validation:** every request body, query and param has a Zod schema with `.strict()`, defined in
   `packages/shared`. Infer TypeScript types from the schemas.
5. **Responses:** build them only through DTO mappers, in the envelope
   `{ success: true, data, message? }` / `{ success: false, error: { code, message, details? } }`.
   Confidential reports (`is_anonymous`) never expose the reporter to managers, technicians or admins.
6. **Secrets:** none in code, tests, fixtures or examples. Read them from `/run/secrets/*` (production) or `.env` (local).
7. **Randomness and crypto:** `crypto.randomUUID()` / `crypto.randomBytes()` (Node), `expo-crypto` (mobile).
   Never `Math.random()`. AES-256-GCM for data at rest; bcrypt cost 12 for passwords; SHA-256 hashes for stored tokens.
8. **Auth:** JWT HS256 with `algorithms` pinned in `jwt.verify`; access 1 h, refresh 7 d rotated on every use,
   reuse revokes the whole family; TOTP ±1 step with replay protection.
9. **Uploads:** `multer.memoryStorage()`, 2 MiB limit, magic-byte check (JPEG/PNG/WebP), re-encode with sharp
   (strips EXIF/GPS), encrypt, UUID file name. Never use the client file name in a path.
10. **Logging:** Pino only, structured, with `requestId`. No `console.*`. Never log tokens, passwords, codes,
    message bodies or personal data. Audit events are `noun.verb.outcome` and fire-and-forget.
11. **Mobile storage:** tokens in `expo-secure-store`; offline data in encrypted MMKV (key in SecureStore).
    Never AsyncStorage. Writes go through the offline mutation queue with an Idempotency-Key.
12. **Push payloads:** no personal data — only `notificationId`, `incidentId`, `type` and a generic localized text.
13. **i18n:** no hard-coded user-facing text. French is the default; every key exists in `fr` and `en`.
14. **Design tokens:** use the tokens in `packages/shared`. Text colours for Moderate and the offline banner use
    `#8F5600`, High uses `#B34700` (WCAG AA); the lighter amber/orange are for badge fills only.
15. **Dependencies:** do not add a dependency without saying why, its size impact (mobile APK < 50 MB),
    and its licence. Prefer what is already in the stack.

## How to work

- Small, focused changes. Functions under ~50 lines. Names: functions are verbs, booleans start with is/has/can,
  tables plural snake_case, TypeScript camelCase.
- Write or update tests with every change: Jest + Supertest (API), Jest + RNTL (mobile), Vitest + Playwright (web).
  Include failure cases: unauthenticated, wrong role, other tenant, invalid input.
- Comments explain _why_, not _what_.
- If you are unsure whether a library supports something, say so and propose how to verify it. Do not invent APIs.
- Never commit, push, or change CI, hooks, or security configuration unless explicitly asked.
- At the end, list: files changed, tests added, anything you could not verify, and open questions.
