#!/usr/bin/env bash
# Full local quality and security check — the same gates as CI, run before opening a pull request.
# Usage: npm run verify   (on Windows, from Git Bash — see docs/WORKFLOW.md §2.1)
set -uo pipefail
fail=0
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
run() { "$@" || { printf '\033[1;31m✖ failed: %s\033[0m\n' "$*"; fail=1; }; }

step "Build shared package"; run npm run build -w @secure360/shared
step "Format";        run npm run format:check
step "Lint";          run npm run lint
step "Types";         run npm run typecheck
step "Unit tests";    run npm test
step "Dependencies";  run npm audit --audit-level=high

step "Secrets (whole history)"
if command -v gitleaks >/dev/null 2>&1; then
  run bash -c 'gitleaks git --redact --no-banner 2>/dev/null || gitleaks detect --redact --no-banner'
else
  echo "✖ gitleaks not installed or not on the PATH of this shell (see docs/WORKFLOW.md §2.1)"; fail=1
fi

# Scan every file Git could commit (tracked + new, non-ignored) — not git-ignored local secrets (.env, infra/secrets).
step "Secrets (working tree, including uncommitted files)"
if command -v gitleaks >/dev/null 2>&1; then
  scan_dir="$(mktemp -d)"
  git ls-files -z --cached --others --exclude-standard \
    | tar --null --ignore-failed-read -T - -cf - 2>/dev/null \
    | tar -xf - -C "$scan_dir"
  run bash -c "gitleaks dir '$scan_dir' --redact --no-banner 2>/dev/null || gitleaks detect --no-git --source '$scan_dir' --redact --no-banner"
  rm -rf "$scan_dir"
else
  echo "✖ gitleaks not installed or not on the PATH of this shell (see docs/WORKFLOW.md §2.1)"; fail=1
fi

step "Static analysis (Semgrep)"
if command -v semgrep >/dev/null 2>&1; then
  run semgrep scan --error --quiet \
    --config p/typescript --config p/nodejs --config p/owasp-top-ten --config p/jwt \
    --config .semgrep.yml
elif command -v docker >/dev/null 2>&1; then
  # Git Bash on Windows rewrites "/src"-style paths: disable that and pass the Windows path to Docker.
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    src="$(pwd -W)"; export MSYS_NO_PATHCONV=1
  else
    src="$PWD"
  fi
  run docker run --rm -v "$src:/src" -w /src semgrep/semgrep semgrep scan --error --quiet \
    --config p/typescript --config p/nodejs --config p/owasp-top-ten --config p/jwt \
    --config .semgrep.yml
else
  echo "semgrep and docker not available — skipped (CI will still run it)"
fi

if [ "$fail" -eq 0 ]; then
  printf '\n\033[1;32m✔ All checks passed — ready for a pull request.\033[0m\n'
else
  printf '\n\033[1;31m✖ Some checks failed — fix them before opening the pull request.\033[0m\n'
fi
exit "$fail"
