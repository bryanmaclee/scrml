#!/bin/bash
# scripts/install-merge-driver.sh — configure THIS clone for the scrml-generated merge driver.
# change-id: s468-generated-merge-driver
#
# .gitattributes maps the files carrying @generated content to `merge=scrml-generated`; git only
# honours that once the clone's config names the driver. Merge drivers are PER-CLONE config
# (.git/config): every worktree of a clone shares it, a fresh clone has none, and without it git
# silently falls back to its normal text merge (conflicts exactly as before).
#
# IDEMPOTENT and cheap, so it runs on every `bun run pretest` (package.json) as well as from
# scripts/git-hooks/install.sh. Works from any worktree.
# Usage:  bash scripts/install-merge-driver.sh [--quiet]
#         bash scripts/install-merge-driver.sh --uninstall
# Opt out (e.g. a scratch run that must not touch the clone's config): SCRML_SKIP_MERGE_DRIVER_INSTALL=1
#
# What it sets is ONLY the config. The attribute comes from the checked-out branch's own
# .gitattributes and the code from that branch's own scripts/git-merge-generated.{sh,ts} — nothing is
# copied or mirrored into the git dir, so a branch that predates the driver (no attribute lines) never
# runs it, a worktree's WIP driver never runs in another worktree's merge, and a revert of the driver
# takes effect with the revert. The configured command:
#   - checkout has scripts/git-merge-generated.sh → run it (the crash-safe wrapper; fails closed);
#   - otherwise (the attribute without the script — never shipped, but possible mid-revert) → git's
#     own text merge, exactly what git does with no driver: `git merge-file` with markers.
# git sq-quotes each %-placeholder; the inner sh receives them as "$1".."$8".
#
# --uninstall removes the config section, plus anything an earlier version of this installer wrote
# (the info/attributes managed block and the <git-common-dir>/scrml-generated-driver/ copy).

set -e
MODE=install QUIET=0
case "${1:-}" in
  --quiet) QUIET=1 ;;
  --uninstall) MODE=uninstall ;;
esac
say() { [ "$QUIET" = 1 ] || echo "$@"; }

if [ "$MODE" = install ] && [ -n "${SCRML_SKIP_MERGE_DRIVER_INSTALL:-}" ]; then
  say "  install-merge-driver: skipped (SCRML_SKIP_MERGE_DRIVER_INSTALL)"; exit 0
fi
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { say "  install-merge-driver: not a git checkout — skipped"; exit 0; }
cd "$ROOT"
COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"

# Legacy state from the S469 first cut — removed on every run (install or uninstall).
changed=""
INFO_ATTR="$COMMON/info/attributes"
if [ -f "$INFO_ATTR" ] && grep -q '^# >>> scrml-generated merge driver' "$INFO_ATTR"; then
  TMP="$INFO_ATTR.tmp.$$"
  awk '/^# >>> scrml-generated merge driver/{skip=1;next} /^# <<< scrml-generated merge driver <<<$/{skip=0;next} !skip' "$INFO_ATTR" > "$TMP"
  mv "$TMP" "$INFO_ATTR"; changed="$changed info/attributes-block-removed"
fi
if [ -d "$COMMON/scrml-generated-driver" ]; then
  rm -rf "$COMMON/scrml-generated-driver"; changed="$changed stored-copy-removed"
fi

if [ "$MODE" = uninstall ]; then
  if git config --get-regexp '^merge\.scrml-generated\.' >/dev/null 2>&1; then
    git config --remove-section merge.scrml-generated; changed="$changed config-removed"
  fi
  say "  merge driver scrml-generated uninstalled from this clone (${changed:- nothing to remove})"
  exit 0
fi

NAME='scrml @generated-aware merge (scripts/git-merge-generated.sh)'
DRIVER='sh -c '\''if [ -f scripts/git-merge-generated.sh ]; then exec sh scripts/git-merge-generated.sh "$@"; fi; exec git merge-file --marker-size="$5" -L "$7" -L "$6" -L "$8" "$2" "$1" "$3"'\'' scrml-generated %O %A %B %P %L %S %X %Y'

if [ "$(git config --get merge.scrml-generated.name || true)" != "$NAME" ]; then
  git config merge.scrml-generated.name "$NAME"; changed="$changed name"
fi
if [ "$(git config --get merge.scrml-generated.driver || true)" != "$DRIVER" ]; then
  git config merge.scrml-generated.driver "$DRIVER"; changed="$changed driver"
fi

if [ -n "$changed" ]; then
  say "  merge driver scrml-generated configured for this clone + all its worktrees (updated:$changed)"
else
  say "  merge driver scrml-generated already configured"
fi
