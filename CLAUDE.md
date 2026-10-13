# Claude Code — Secure360

The project rules for all AI agents are in AGENTS.md and apply in full:

@AGENTS.md

## Claude-specific notes

- Claude (Tier 1) is used for security-critical code and reviews: auth, tenant/RLS, uploads, crypto,
  token handling, the mobile sync engine, Nginx/infra security. See docs/AI_WORKFLOW.md.
- Task Master is connected through MCP: start from `task-master next` (or the MCP tool), work on that task only,
  and set its status when the PR is merged. Never invent tasks outside the PRD.
- For a security review, follow the prompt in docs/AI_WORKFLOW.md §4 and report findings by severity
  with file and line, before proposing any change.
- Run `npm run verify` after changes when the environment allows it, and report the result.
