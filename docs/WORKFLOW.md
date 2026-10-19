# Secure360 — Development workflow

One developer, thirteen weeks, security-critical software. This workflow replaces the team you do not have:
every change passes the same automatic gates and the same review checklist, whether you or an AI wrote it.

```
 Issue ──► branch ──► code (+ AI tier) ──► commit ──► push ──► pull request ──► CI gates ──► review ──► squash merge
              │                              │          │                          │             │
              │                    pre-commit hook  pre-push hook        lint · types · tests   self-review
              │                    gitleaks + lint  types + tests        audit · gitleaks       + Tier 1 review
              │                    commit-msg hook                       Semgrep · CodeQL       if security-critical
              └── one issue = one branch = one pull request (small)
```

## 1. Principles

- **Small pull requests.** One user story or less. A PR you can review in 15 minutes is a PR you actually review.
- **Main is always releasable.** Nothing reaches `main` without passing CI. No direct pushes.
- **Same rules for AI code.** AI output is a draft from a fast junior colleague: you read every line before it is merged.
- **Automate what can be automated** (format, lint, secrets, known vulnerability patterns) so that review time goes to logic and security design.

## 2. One-time setup

### 2.1 Tools to install

| Tool                                   | Why                                                              | Install                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 24 LTS                         | Runtime for all three apps                                       | nodejs.org, or `nvm install 24` (reads `.nvmrc`)                                                                                    |
| Git ≥ 2.40                             | Version control, SSH commit signing                              | git-scm.com                                                                                                                         |
| Docker Desktop (with WSL 2 on Windows) | PostgreSQL, Redis, Nginx locally; Semgrep without Python         | docker.com                                                                                                                          |
| gitleaks                               | Blocks commits containing secrets                                | Windows: `winget install gitleaks` or `scoop install gitleaks` · macOS: `brew install gitleaks` · Linux: release binary from GitHub |
| Semgrep (optional locally)             | Static analysis; `npm run verify` falls back to Docker           | `pipx install semgrep` or `brew install semgrep`                                                                                    |
| GitHub CLI `gh` (optional)             | Create PRs and issues from the terminal                          | cli.github.com                                                                                                                      |
| VS Code                                | Editor; recommended extensions are suggested on opening the repo | code.visualstudio.com                                                                                                               |

**Windows:** two workable setups. _Native Windows + Git Bash_ (recommended here: Android Studio, the emulator and
Expo run natively, and the Git hooks run in Git Bash) — use Git Bash or VS Code's Git Bash terminal for repository
commands. _WSL 2_ is closer to the Ubuntu server but needs extra work to reach the Android emulator. Docker Desktop
uses the WSL 2 backend in both cases. Do not mix: one clone, one environment.

### 2.2 Repository

```bash
git init secure360 && cd secure360        # or clone your empty GitHub repo
# copy the content of this kit into the repository root
npm install                               # creates package-lock.json and installs the Git hooks (husky)
git add -A && git commit -m "chore(ci): add development workflow kit"
```

Put the reference documents in `docs/reference/` (git-ignored, see its README). Commit `package-lock.json`: CI uses `npm ci`, which fails without it — that is deliberate (reproducible installs).
Note: `npm ci` already refuses a lock file that does not match `package.json`; `--frozen-lockfile` is a Yarn/pnpm flag, not npm.

### 2.3 Sign your commits (recommended)

SSH signing proves the commits are yours and takes two minutes:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Then add the same public key on GitHub as a **Signing key** (Settings → SSH and GPG keys).

### 2.4 GitHub repository settings

1. **Rulesets → New branch ruleset** targeting `main`:
   - Require a pull request before merging (required approvals: **0** — you are the only developer; the rule still forces the PR and its checks).
   - Require status checks to pass: `Lint, types, tests`, `Dependency audit`, `Secret scan`, `Static analysis (Semgrep)`, `Analyze (JavaScript / TypeScript)`, `Pull request title (Conventional Commits)`.
   - Require branches to be up to date before merging.
   - Block force pushes; restrict deletions; require linear history.
   - Require signed commits (if you did 2.3).
2. **General → Pull requests:** allow **squash merging only**; default commit message = pull request title; automatically delete head branches.
3. **Code security:** enable Dependabot alerts, Dependabot security updates, secret scanning with push protection, private vulnerability reporting. CodeQL runs from `.github/workflows/codeql.yml`.
4. **Socket** (socket.dev): install the free GitHub app on the repository. It comments on PRs that add dependencies with risky behaviour (install scripts, network access, obfuscation) — the supply-chain check required by OWASP M2.

## 3. Daily loop

```bash
git switch main && git pull
git switch -c feat/api-refresh-rotation        # feat/ fix/ chore/ docs/ refactor/ test/ + short name
# … code, with tests …
npm run verify                                 # same gates as CI
git add -p                                     # stage deliberately, hunk by hunk
git commit -m "feat(auth): rotate refresh tokens and detect reuse"
git push -u origin HEAD
gh pr create --fill                            # or open the PR on github.com; fill the template
```

Then: wait for CI → do the review (docs/CODE_REVIEW.md) → squash merge → delete the branch.

### 3.1 Commit messages

Conventional Commits, enforced by the `commit-msg` hook and on PR titles:

```
type(scope): subject in lower case, imperative, ≤ 100 characters
```

- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `ci`, `build`, `revert`.
- **Scopes:** `api`, `mobile`, `web`, `shared`, `infra`, `db`, `auth`, `docs`, `ci`, `deps`, `security`, `release`.

Because PRs are squash-merged with their title, `main` reads like a changelog — useful for the internship report (L13).

### 3.2 What runs where

| Gate                                          | pre-commit   | commit-msg | pre-push | `npm run verify` | CI              |
| --------------------------------------------- | ------------ | ---------- | -------- | ---------------- | --------------- |
| Secret scan (gitleaks)                        | staged files |            |          | whole history    | whole history   |
| ESLint (incl. security + layering rules)      | staged files |            |          | ✔                | ✔               |
| Prettier                                      | staged files |            |          | ✔                | ✔               |
| Commit message                                |              | ✔          |          |                  | PR title        |
| TypeScript                                    |              |            | ✔        | ✔                | ✔               |
| Unit tests                                    |              |            | ✔        | ✔                | ✔ with coverage |
| Integration tests (PostgreSQL, Redis, RLS)    |              |            |          |                  | ✔               |
| npm audit (high+)                             |              |            |          | ✔                | ✔               |
| New dependency licence / vulnerability review |              |            |          |                  | ✔ (PR)          |
| Semgrep (registry + `.semgrep.yml`)           |              |            |          | ✔                | ✔               |
| CodeQL                                        |              |            |          |                  | ✔ + weekly      |

Never bypass hooks with `--no-verify`. If a hook is wrong, fix the hook in its own PR.

### 3.3 Local services

PostgreSQL 16 and Redis 8 run in Docker (`infra/compose.dev.yml`), bound to `127.0.0.1` only. Run from Git Bash.

| Command               | What it does                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev:secrets` | Once. Creates the password files in `infra/secrets/` (git-ignored, mode 600; existing files are kept) and prints `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY` and `TEST_DATABASE_ADMIN_URL` for your `.env`.         |
| `npm run dev:up`      | Starts both services and waits until they are healthy. On the first start, `infra/postgres/init/01-roles.sh` creates the roles `s360_owner` (migrations), `s360_app` (API), `s360_worker` (worker) and `s360_metrics` (monitoring). The app never uses `postgres`. |
| `npm run dev:down`    | Stops the services; data is kept in the named volumes.                                                                                                                                                                                                             |
| `npm run dev:reset`   | Asks for confirmation, then stops the services and **deletes all local data** (volumes).                                                                                                                                                                           |

The roles and the init settings (`POSTGRES_INITDB_ARGS`, `infra/postgres/init/`) are applied only when the database
volume is empty, so a secret file or an init setting changed later has no effect until you run `npm run dev:reset`,
then `npm run dev:up`. Password authentication applies everywhere, including `docker exec … psql`.

Host ports default to 5432 (PostgreSQL) and 6379 (Redis). If one is already used — for example by a Redis or
PostgreSQL installed as a Windows service — choose another with `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT`. Compose
reads them from the shell environment, not from the root `.env`, so export them in Git Bash before `dev:up` and
`dev:secrets` (which prints the URLs with those ports):

```bash
export REDIS_HOST_PORT=16379
npm run dev:up && npm run dev:secrets
```

### 3.4 Database migrations

Data migrations run as s360_owner, which is also subject to FORCE RLS and the users guard trigger: every data
migration must set an app context (set_config) or use a dedicated SECURITY DEFINER function.

## 4. Definition of done (per pull request)

- Acceptance criteria of the issue met; requirement IDs in the PR description.
- Tests cover the new behaviour and at least one failure path; coverage of critical modules stays above 60 % (BNF11).
- `npm run verify` green locally; CI green.
- Review checklist done (docs/CODE_REVIEW.md); Tier 1 review for security-critical changes.
- Docs updated when behaviour, API or configuration changed (OpenAPI for the API).
- No TODO without an issue number.

## 5. Releases and supply chain

### 5.1 Versions

Tag releases on `main` with SemVer (`v0.1.0` at the end of S5, `v0.x` until the defence). The API image and the
APK carry the same version.

### 5.2 Dependencies

- Add a dependency only with a reason, its licence, and — for mobile — its size impact (APK < 50 MB).
- Check new packages on socket.dev before installing; read the Socket comment on the PR.
- Expo-managed packages are upgraded with `npx expo install --fix`, not by hand or by Dependabot.
- Run `npx expo-doctor` in `apps/mobile` before each mobile release.

### 5.3 GitHub Actions pinning

Third-party actions are referenced by version tag in the kit. Once the repository exists, pin each one to its full
commit SHA (the tag stays as a comment); Dependabot keeps the SHAs up to date. This prevents a compromised action tag
from running code in your CI.

## 6. Secrets

- Local development: `.env` (git-ignored), created from `.env.example`.
- Production: Docker secrets files in `infra/secrets/` (git-ignored), mounted at `/run/secrets/` (L2 §8.6).
- Generate secrets with `openssl rand -base64 48`, never by hand.
- If a secret is ever committed — even on a branch, even for a minute: **rotate it first**, then remove it from history. Assume anything pushed is compromised.
- Never paste secrets, `.env` files, tokens or real incident data into an AI tool (docs/AI_WORKFLOW.md §5).
