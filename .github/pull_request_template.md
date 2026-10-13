## What and why

<!-- One or two sentences: what changes, and which requirement / user story it serves (e.g. BF07, US-10). -->

Closes #

## How it was built

- Task Master task: <!-- id -->
- AI tier used: <!-- None / Tier 1 Claude Code / Tier 2 Antigravity + Gemini -->
- Security-critical area touched? <!-- No / Yes: auth, tenant/RLS, uploads, crypto, tokens, sync engine, infra -->

## How to test

<!-- Steps or commands a reviewer can run. -->

## Checklist (docs/CODE_REVIEW.md)

### Always

- [ ] `npm run verify` passes locally
- [ ] Tests added or updated for the new behaviour (happy path + at least one failure path)
- [ ] I re-read the full diff myself before requesting review — including every line written by AI
- [ ] No secrets, real personal data, or `console.log` in the diff
- [ ] User-facing text goes through i18n (French and English keys)

### If the API changed

- [ ] Every new body / query / param has a Zod schema with `.strict()`
- [ ] Responses go through a DTO mapper (no entity serialised directly; confidential reporter masked)
- [ ] Data access runs inside the tenant transaction (no bypass of RLS)
- [ ] Audit event added for significant actions (`noun.verb.outcome`)
- [ ] OpenAPI documentation updated

### If security-critical code changed

- [ ] Tier 1 security review done (docs/AI_WORKFLOW.md §5.2) and findings addressed
- [ ] Negative tests: unauthenticated, wrong role, other tenant, malformed input

### If mobile / web UI changed

- [ ] Works offline / shows the right offline state
- [ ] Contrast tokens respected (Moderate/offline text #8F5600, High text #B34700)
- [ ] Checked in French (no truncated labels)
