# Secure360

Cybersecurity incident management is one of the fundamental pillars of any IT security strategy. In the Cameroonian
context, organisations face security incidents every day — phishing, Mobile Money fraud, SIM swap, malware,
unauthorised access — that they do not know how to report, document and track. Secure360 gives employees a simple,
fast, offline-capable way to report them from their phone, and gives the analysts of Security First Cameroon (SFC)
the tools to triage, resolve and account for them.

Internship project at Security First Cameroon SARL U. Mobile app (Expo / React Native), web dashboard (React),
API (Node.js, PostgreSQL).

## Start here

| Document                                             | For                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| [docs/WORKFLOW.md](docs/WORKFLOW.md)                 | Setup, daily loop, commits, branch protection, releases, secrets |
| [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md)           | Review passes and checklists (API, mobile, web, infra)           |
| [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md)           | AI tiers, security-critical areas, prompts, safe-use rules       |
| [docs/BUILD_CHECKLIST.md](docs/BUILD_CHECKLIST.md)   | Decisions from L1–L3 to apply during the build                   |
| [AGENTS.md](AGENTS.md)                               | Rules every AI coding tool must follow                           |
| [SECURITY.md](SECURITY.md)                           | How to report a vulnerability                                    |
| [.taskmaster/docs/prd.txt](.taskmaster/docs/prd.txt) | Build-phase requirements used by Task Master                     |
| [design/README.md](design/README.md)                 | L3 screen exports and renders                                    |

## Quick start

```bash
nvm use            # Node 24
npm install        # installs dependencies and Git hooks
npm run verify     # every check CI runs
```

## Structure

```
apps/api        Express API + worker
apps/mobile     Expo app
apps/web        React dashboard
packages/shared Zod schemas, types, i18n keys, design tokens
infra/          Docker Compose, Nginx, monitoring, backups
design/         Stitch exports and renders of the L3 screens
docs/           Workflow, review, AI usage; reference/ holds local-only specifications
.taskmaster/    Task Master PRD and tasks
```

## Licence

MIT — see [LICENSE](LICENSE).
