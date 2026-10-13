#!/usr/bin/env bash
# Pin every GitHub Action used in .github/workflows to a full 40-character commit SHA,
# keeping the human-readable tag as a comment:  uses: actions/checkout@<sha> # v4
# Uses only git (no GitHub CLI, no login). Run from the repository root:  bash scripts/pin-actions.sh
# Dependabot (github-actions ecosystem) then keeps the SHAs up to date.
set -euo pipefail

resolve_sha() { # $1 = owner/repo, $2 = tag or branch -> prints the commit SHA
  git ls-remote "https://github.com/$1" "$2" | awk -v t="refs/tags/$2" -v h="refs/heads/$2" '
    $2 == t "^{}" { peeled = $1 }      # annotated tag: the commit it points to
    $2 == t       { tag = $1 }         # lightweight tag
    $2 == h       { head = $1 }        # branch
    END { if (peeled) print peeled; else if (tag) print tag; else print head }'
}

for file in .github/workflows/*.yml; do
  grep -oE 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[A-Za-z0-9_.-]+' "$file" | sort -u | while read -r _ ref; do
    action="${ref%@*}"
    version="${ref#*@}"
    if [[ "$version" =~ ^[0-9a-f]{40}$ ]]; then continue; fi   # already pinned
    repo="$(echo "$action" | cut -d/ -f1-2)"                    # github/codeql-action/init -> github/codeql-action
    sha="$(resolve_sha "$repo" "$version")"
    if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then echo "✖ could not resolve $action@$version"; exit 1; fi
    sed -i "s|uses: ${action}@${version}\$|uses: ${action}@${sha} # ${version}|" "$file"
    echo "✔ $file: $action@$version → $sha"
  done
done
echo "Done. Review with: git diff .github/workflows"
