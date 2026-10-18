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
# The scrml-generated merge driver (S468, s468-generated-merge-driver).
#
# .gitattributes maps the files carrying @generated content to `merge=scrml-generated`; git
# only honours that once THIS clone's config names the driver. Merge drivers are PER-CLONE
# config (.git/config): every worktree of this clone shares it, a fresh clone has none — and
# without it git silently falls back to its normal text merge (conflicts as before, never worse).
# Done FIRST because it works from any worktree; the hook copy below needs the main checkout.
#
# The command degrades to a plain `git merge-file` (markers, like a normal merge) when bun or
# the script is missing, so a missing tool can never leave a file marked conflicted while it
# reads clean. git sq-quotes each %-placeholder; the inner sh receives them as "$1".."$8".
# %S/%X/%Y are the ancestor/ours/theirs labels used for any conflict markers.
git config merge.scrml-generated.name \
  "scrml @generated-aware merge (scripts/git-merge-generated.ts)"
git config merge.scrml-generated.driver \
  'sh -c '\''if command -v bun >/dev/null 2>&1 && [ -f scripts/git-merge-generated.ts ]; then exec bun scripts/git-merge-generated.ts "$@"; else exec git merge-file --marker-size="$5" "$2" "$1" "$3"; fi'\'' scrml-generated %O %A %B %P %L %S %X %Y'
echo "  configured merge driver scrml-generated (this clone + all its worktrees)"

# A merge reads .gitattributes from OURS' working tree, so a branch cut before the
# `merge=scrml-generated` lines landed would never invoke the driver — not even while merging a
# main that has them (measured S468: driver ran 0 times). Mirror those lines into the clone's
# info/attributes (consulted for every branch, highest precedence) as a managed block, re-derived
# from .gitattributes on every run so the two can never disagree for long.
INFO_ATTR="$(git rev-parse --path-format=absolute --git-common-dir)/info/attributes"
mkdir -p "$(dirname "$INFO_ATTR")"
touch "$INFO_ATTR"
BEGIN_MARK="# >>> scrml-generated merge driver (managed by scripts/git-hooks/install.sh) >>>"
END_MARK="# <<< scrml-generated merge driver <<<"
awk -v b="$BEGIN_MARK" -v e="$END_MARK" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$INFO_ATTR" > "$INFO_ATTR.tmp"
{
  echo "$BEGIN_MARK"
  grep -E '^[^#].*[[:space:]]merge=scrml-generated([[:space:]]|$)' .gitattributes
  echo "$END_MARK"
} >> "$INFO_ATTR.tmp"
mv "$INFO_ATTR.tmp" "$INFO_ATTR"
echo "  mirrored merge=scrml-generated attributes into $INFO_ATTR"

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
