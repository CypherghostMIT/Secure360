# Secure360 — Code review

Working alone, review is done in three passes on every pull request. Automated tools catch patterns;
these passes catch logic, design and security mistakes that tools miss.

| Pass           | Who                                                                                              | When              | Focus                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------- |
| 1. Automated   | CI                                                                                               | Every push        | Format, lint, types, tests, secrets, known vulnerability patterns |
| 2. Self-review | You                                                                                              | After CI is green | The diff on GitHub, with the checklists below                     |
| 3. AI review   | Tier 1 (Claude Code) for security-critical areas; Tier 2 (Gemini) for large cross-module changes | Before merging    | Independent second reading (docs/AI_WORKFLOW.md §5)               |

## How to self-review

1. **Read the diff on GitHub, not in your editor.** A different view breaks the "I know what I meant" bias.
2. **Wait.** Review at least an hour after writing, ideally the next morning.
3. **Read tests first.** Do they describe the requirement? Would they fail if the code were wrong?
4. **Then read the code against the checklists.** Leave review comments on your own PR for anything you
   want to fix — they become a record of decisions for the internship report.
5. **For AI-written code, assume nothing.** Check every import exists, every API call matches the library's
   real documentation, and every security claim in a comment is true.

## Finding severity

| Severity | Meaning                                                 | Action                   |
| -------- | ------------------------------------------------------- | ------------------------ |
| Blocker  | Security flaw, data leak, data loss, broken requirement | Fix before merge         |
| Major    | Bug, missing test for a risky path, layer violation     | Fix before merge         |
| Minor    | Readability, naming, small duplication                  | Fix now or open an issue |
| Note     | Idea or question                                        | Optional                 |

## Checklist — every pull request

- [ ] The change does what the issue / user story asks, nothing more.
- [ ] Names say what things are (functions = verbs, booleans = is/has/can).
- [ ] Functions are short and do one thing; no dead code; no commented-out code.
- [ ] Errors are handled; no empty `catch`; no swallowed promise.
- [ ] Tests: happy path + failure paths; they assert behaviour, not implementation details.
- [ ] No secrets, personal data, `console.*`, or debug leftovers.
- [ ] User-facing text in i18n (fr + en); tone is plain and non-judgmental.

## Checklist — API (apps/api)

**Layers and data**

- [ ] Controller → service → repository respected (lint passes, but also check logic placement).
- [ ] Every tenant-scoped query uses the request's tenant transaction; nothing bypasses RLS.
- [ ] New tables: RLS enabled **and forced**, policies written, grants for `s360_app` / `s360_worker` only as needed, integration tests per role (User, Manager, Technician, Admin, other tenant).
- [ ] Migrations are expand-only (no column drop/rename in the same release as the code that stops using it).

**Input and output**

- [ ] Zod schema with `.strict()` on body, query and params.
- [ ] Response through a DTO; no internal fields (password hashes, TOTP secrets, `organization_id` of others).
- [ ] Confidential reports: reporter masked for Manager, Technician and Admin responses — with a test.
- [ ] Objects the caller cannot see return **404**, not 403.
- [ ] Response envelope and error codes follow L2 Table 7.

**Security**

- [ ] Authentication middleware on every non-public route; role guard where needed; service re-checks ownership rules.
- [ ] No SQL built from strings; no `$queryRawUnsafe`.
- [ ] Secrets read from configuration, never hard-coded.
- [ ] Random values from `crypto`; tokens stored as hashes; comparisons of secrets in constant time.
- [ ] Rate limiting considered for new public or expensive endpoints.
- [ ] Significant actions produce an audit event (`noun.verb.outcome`); logs contain no personal data or secrets.
- [ ] Timeouts on every outbound call (FCM, SMTP); retries only in workers.

**Events and async**

- [ ] State change and its outbox event in the same transaction.
- [ ] Consumers idempotent (job id = event id); failure path ends in the dead-letter set, with a metric.
- [ ] Real-time events are thin (ids only).

## Checklist — mobile (apps/mobile)

- [ ] Works offline: reads from the store, writes through the mutation queue with an Idempotency-Key.
- [ ] Tokens only in SecureStore; nothing sensitive in plain storage or logs.
- [ ] Deep-link parameters validated (Zod) before use.
- [ ] Lists virtualised; images compressed; no heavy new dependency (APK < 50 MB).
- [ ] Every screen state designed: loading, empty, error, offline (L3 M21).
- [ ] Contrast tokens respected; touch targets ≥ 48 px; French text not truncated.

## Checklist — web (apps/web)

- [ ] Server data through TanStack Query with the feature's query keys; no copies in Zustand.
- [ ] Filters in the URL; real-time events invalidate the right queries.
- [ ] No `dangerouslySetInnerHTML` with user content; CSP not weakened.
- [ ] Route and action guards match server roles (UI hiding is not security).
- [ ] Confidential reporter never displayed.

## Checklist — infrastructure (infra/, CI)

- [ ] No secret in Compose files, images, or workflow files.
- [ ] Containers run as non-root with memory limits; data services not exposed on host ports.
- [ ] Nginx: TLS settings, rate limits and body limits unchanged or deliberately changed.
- [ ] Workflow permissions minimal (`contents: read` by default).
