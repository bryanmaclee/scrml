#!/bin/bash
# Install versioned git hooks from scripts/git-hooks/ into .git/hooks/
#
# Usage: run from the repo root:
#   ./scripts/git-hooks/install.sh
#
# Existing .git/hooks/<hook> files are backed up to <hook>.bak on first install.

set -e

cd "$(git rev-parse --show-toplevel)"

# ---------------------------------------------------------------------------
# The scrml-generated merge driver (S468/S469, s468-generated-merge-driver): per-clone config ONLY
# (merge.scrml-generated.{name,driver}); the attribute comes from the branch's own .gitattributes
# and nothing is mirrored into the git dir — the S469 review removed the first cut's info/attributes
# mirror and stored driver copy, and the installer now deletes them where they linger. Delegated
# to the idempotent scripts/install-merge-driver.sh, which every `bun run pretest` also runs. Done
# FIRST because it works from any worktree; the hook copy below (post-merge / post-rewrite = the
# driver's phase 2) needs the main checkout, where .git/hooks is a directory.
bash scripts/install-merge-driver.sh

HOOKS_SRC="scripts/git-hooks"
HOOKS_DST=".git/hooks"

if [ ! -d "$HOOKS_DST" ]; then
  echo "✗ $HOOKS_DST does not exist — is this a git checkout?" >&2
  exit 1
fi

for hook in "$HOOKS_SRC"/*; do
  name=$(basename "$hook")
  # Skip non-hook files (this script, README, etc.)
  case "$name" in
    install.sh|README.md|*.md) continue ;;
  esac

  dst="$HOOKS_DST/$name"
  if [ -f "$dst" ] && [ ! -f "$dst.bak" ]; then
    echo "  backing up existing $name → $name.bak"
    cp "$dst" "$dst.bak"
  fi

  cp "$hook" "$dst"
  chmod +x "$dst"
  echo "  installed $name"
done

echo "✓ Git hooks installed from $HOOKS_SRC/"
