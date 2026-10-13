# Secure360 — AI-assisted development

AI tools speed up the work; they do not lower the bar. Every AI change goes through the same branch, hooks,
CI and review as hand-written code. All tools read the same project rules in `AGENTS.md`
(Claude Code loads it through `CLAUDE.md`; Gemini CLI through `.gemini/settings.json`; in Antigravity, add
`AGENTS.md` as a workspace rule or reference it at the start of a session if it is not picked up automatically).

## 1. Tiers

| Tier                         | Tools                                | Use it for                                                                                                                                                                           | Do not use it for                                      |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **1 — Strategic**            | Claude Code (Opus) + **Task Master** | Security-critical code, security reviews of sensitive modules, architecture decisions, hard debugging; project planning and task tracking with Task Master                           | Routine CRUD, boilerplate, UI layout work              |
| **2 — Production + context** | Antigravity + Gemini                 | Scaffolding modules, routine CRUD, UI components, unit tests (the daily driver); large-context work: consistency reviews across many files, architecture summaries, finding patterns | Writing security-critical code without a Tier 1 review |

Use Tier 1 sparingly — for roughly the hardest 40 % of the work, where a mistake is expensive.

## 2. Security-critical areas (Tier 1 writes, or Tier 1 reviews before merge)

| Area                             | Paths                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Authentication, tokens, 2FA      | `apps/api/src/modules/auth/**`, `apps/api/src/platform/crypto/**`                                 |
| Tenant isolation                 | `apps/api/src/platform/db/**`, `apps/api/prisma/migrations/**` (RLS policies, roles, grants)      |
| Uploads and files                | `apps/api/src/modules/attachments/**`                                                             |
| Confidential reporting           | DTO mappers of `incidents`, `messaging`, `users`                                                  |
| Mobile security and offline sync | `apps/mobile/src/core/security/**`, `apps/mobile/src/core/sync/**`, `apps/mobile/src/core/api/**` |
| Edge and infrastructure          | `infra/nginx/**`, `infra/docker-compose*.yml`, `.github/workflows/**`                             |

## 3. Task Master — planning and tracking

Task Master turns the product requirements (`.taskmaster/docs/prd.txt`) into a dependency-ordered task list
that Claude Code can read and update through MCP. One Task Master task ≈ one GitHub issue ≈ one branch ≈ one PR.

```bash
task-master list                      # all tasks and their status
task-master next                      # the next task whose dependencies are done
task-master show <id>                 # details, test strategy, subtasks
task-master expand --id=<id>          # break a large task into subtasks
task-master set-status --id=<id> --status=in-progress   # then: done
```

Rules: tasks are created from the PRD, never invented by the agent mid-session; when the plan changes, update the
PRD or the task explicitly (`task-master update-task`), and commit `.taskmaster/tasks/` with the work.

## 4. Which tier for which task — the build plan

| Week   | Task                                                                        | Tier                                     |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| S5     | Monorepo workspaces, Docker Compose, Prisma schema                          | 2 scaffold → 1 review                    |
| S5     | RLS policies, database roles, `withTenant()`                                | **1**                                    |
| S5     | Auth: login, TOTP, refresh rotation, password reset                         | **1**                                    |
| S5     | Middleware chain (request id, helmet, rate limit, validation, errors)       | 1                                        |
| S6     | Incidents CRUD, categories, severity rule                                   | 2 → 1 review of severity and DTO masking |
| S6     | Upload pipeline                                                             | **1**                                    |
| S6     | Messaging, notifications, outbox, BullMQ consumers                          | 2 → 1 review of outbox and idempotency   |
| S6–S7  | Unit and integration tests                                                  | 2 (RLS tests reviewed by 1)              |
| S7     | OpenAPI generation, statistics, PDF                                         | 2                                        |
| S7     | Consistency review of the whole backend                                     | 2 (large context)                        |
| S8     | Mobile foundation, navigation, design tokens, i18n                          | 2                                        |
| S8     | Secure storage, API client + refresh single-flight, pinning, root detection | **1**                                    |
| S9     | Offline sync engine (queue, backoff, idempotency, dependencies)             | **1**                                    |
| S9–S10 | Mobile screens                                                              | 2                                        |
| S11    | Web dashboard screens, charts                                               | 2                                        |
| S11    | Web auth (cookie refresh, CSP), real-time client                            | 1                                        |
| S12    | Security hardening review, OWASP checklist                                  | **1**, with a Tier 2 whole-repo sweep    |

## 5. Prompts

Always reference the files involved and the Task Master task id.

### 5.1 Implement a task (Tier 1 or 2)

```
Read AGENTS.md first. Task Master task <id>: <title>.
Acceptance criteria: <from the task / user story US-xx>.
Relevant design: <L2 section / L3 screen id> (docs/reference/deliverables).
Constraints: follow the layers; Zod .strict() schemas in packages/shared; DTO responses; tenant transaction;
tests for success + unauthenticated + wrong role + other tenant + invalid input.
Before coding, list the files you will create or change and any question. Then implement.
At the end: files changed, tests added, what you could not verify. Do not commit.
```

### 5.2 Security review (Tier 1, mandatory for security-critical PRs)

```
Act as a senior application security reviewer. Review this diff of Secure360 (context: AGENTS.md).
Check specifically: authentication and authorisation (including other-tenant access and confidential reporter
leaks), RLS bypass, injection (SQL, header, path), input validation (.strict()), secrets and logging of personal
data, token and crypto handling, race conditions and idempotency, error messages leaking information,
dependency risk, and OWASP API Top 10 / Mobile Top 10 where relevant.
Report findings first, by severity (Blocker/Major/Minor), each with file:line, the attack or failure scenario,
and the fix. Say explicitly what you could not assess. Do not rewrite the code unless asked.
```

### 5.3 Tests (Tier 2)

```
Read AGENTS.md. Write tests for <file/module>. Cover: the acceptance criteria, error paths, boundary values,
and for API routes: 401 without token, 403/404 for wrong role or other tenant, 400 for unknown fields.
Use the existing test helpers; no new dependencies. Tests must fail if the behaviour breaks.
```

### 5.4 Consistency review (Tier 2, large context)

```
Read AGENTS.md and docs/reference/deliverables (L2). Across apps/api/src, find: layer violations, endpoints
missing .strict() schemas, responses not using DTO mappers, queries outside the tenant transaction, inconsistent
error codes, missing audit events, naming inconsistencies. Output a table: file, issue, rule, suggested fix.
Do not change code.
```

## 6. Rules for using AI safely

1. **No secrets, no personal data in prompts.** Never paste `.env` files, tokens, keys, database dumps, logs with
   user data, or real incident reports. Use the fictitious personas (Aimé Kamga, Kamdem Distribution SARL…).
   Check each provider's data-retention policy; assume prompts may be kept.
2. **Agents do not commit or push.** You stage and commit yourself after reading the diff.
3. **Agents do not change security configuration** (hooks, CI, `.semgrep.yml`, ESLint security rules, Nginx)
   unless that is the explicit task — and then in its own PR.
4. **Verify claims.** If the AI says a library supports something, check the official documentation or run a test.
5. **Check new dependencies** the AI adds against docs/WORKFLOW.md §5.2.
6. **Log the tier** in each PR (template field) — real data for the internship report and the defence.
