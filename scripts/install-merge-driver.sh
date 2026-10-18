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
# scripts/git-hooks/install.sh. Works from any worktree (it touches only the common git dir).
# Usage:  bash scripts/install-merge-driver.sh [--quiet]
# Opt out (e.g. a scratch run that must not touch the clone's config): SCRML_SKIP_MERGE_DRIVER_INSTALL=1
#
# It does three things, each a no-op when already current:
#   1. sets merge.scrml-generated.{name,driver} in the clone config;
#   2. snapshots scripts/git-merge-generated.ts + scripts/state.ts (state.ts imports only node
#      built-ins) into <git-common-dir>/scrml-generated-driver/. git runs a driver from OURS' working
#      tree, so merging main INTO a branch cut before the driver landed finds no script there — the
#      snapshot is what lets exactly that merge (updating an open PR) use the driver anyway;
#   3. mirrors the `merge=scrml-generated` lines of .gitattributes into <git-common-dir>/info/attributes
#      (same reason: a merge reads .gitattributes from OURS).
#
# The driver command prefers the checkout's own script, then the snapshot, and otherwise FAILS
# CLOSED: no bun, or no script anywhere → it writes git's plain 3-way merge under a loud
# `DRIVER UNAVAILABLE` marker block and exits 1, so the path is left CONFLICTED. git only calls a
# driver when BOTH sides changed the file, and for these files a clean plain merge of generated
# content is exactly the case that can be silently wrong (two PRs each moving `HIGH 264` to `265`
# merge clean as 265). git sq-quotes each %-placeholder; the inner sh receives them as "$1".."$8"
# ($1 %O base, $2 %A ours = the output, $3 %B theirs, $4 %P path, $5 %L marker size,
#  $6 %S base label, $7 %X ours label, $8 %Y theirs label).

set -e
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
say() { [ "$QUIET" = 1 ] || echo "$@"; }

if [ -n "${SCRML_SKIP_MERGE_DRIVER_INSTALL:-}" ]; then say "  install-merge-driver: skipped (SCRML_SKIP_MERGE_DRIVER_INSTALL)"; exit 0; fi
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { say "  install-merge-driver: not a git checkout — skipped"; exit 0; }
cd "$ROOT"
COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"

NAME='scrml @generated-aware merge (scripts/git-merge-generated.ts)'
DRIVER='sh -c '\''if command -v bun >/dev/null 2>&1; then if [ -f scripts/git-merge-generated.ts ]; then exec bun scripts/git-merge-generated.ts "$@"; fi; s="$(git rev-parse --path-format=absolute --git-common-dir)/scrml-generated-driver/git-merge-generated.ts"; if [ -f "$s" ]; then exec bun "$s" "$@"; fi; fi; git merge-file -p --marker-size="$5" -L "$7" -L "$6" -L "$8" "$2" "$1" "$3" > "$2.scrml-plain"; { printf "%s scrml-generated-merge: DRIVER UNAVAILABLE (no bun, or no scripts/git-merge-generated.ts) - generated content NOT regenerated\n%s\n%s resolve by hand (then bun scripts/state.ts --write), and delete this block\n" "$(printf "%${5}s" "" | tr " " "<")" "$(printf "%${5}s" "" | tr " " "=")" "$(printf "%${5}s" "" | tr " " ">")"; cat "$2.scrml-plain"; } > "$2"; rm -f "$2.scrml-plain"; echo "scrml-generated-merge [$4]: DRIVER UNAVAILABLE - left conflicted (fail closed)" >&2; exit 1'\'' scrml-generated %O %A %B %P %L %S %X %Y'

changed=""
if [ "$(git config --get merge.scrml-generated.name || true)" != "$NAME" ]; then
  git config merge.scrml-generated.name "$NAME"; changed="$changed config"
fi
if [ "$(git config --get merge.scrml-generated.driver || true)" != "$DRIVER" ]; then
  git config merge.scrml-generated.driver "$DRIVER"; changed="$changed${changed:+,} driver"
fi

# 2 — the snapshot (refreshed whenever this checkout's copy differs).
SNAP="$COMMON/scrml-generated-driver"
if [ -f scripts/git-merge-generated.ts ] && [ -f scripts/state.ts ]; then
  mkdir -p "$SNAP"
  for f in git-merge-generated.ts state.ts; do
    if ! cmp -s "scripts/$f" "$SNAP/$f"; then
      cp "scripts/$f" "$SNAP/$f.tmp.$$" && mv "$SNAP/$f.tmp.$$" "$SNAP/$f"; changed="$changed snapshot:$f"
    fi
  done
fi

# 3 — the info/attributes mirror (a managed block, re-derived from .gitattributes; left alone when
# this checkout's .gitattributes has no such lines, so an older branch never erases it).
LINES="$(grep -E '^[^#].*[[:space:]]merge=scrml-generated([[:space:]]|$)' .gitattributes 2>/dev/null || true)"
if [ -n "$LINES" ]; then
  INFO_ATTR="$COMMON/info/attributes"
  mkdir -p "$(dirname "$INFO_ATTR")"
  touch "$INFO_ATTR"
  BEGIN_MARK="# >>> scrml-generated merge driver (managed by scripts/install-merge-driver.sh) >>>"
  END_MARK="# <<< scrml-generated merge driver <<<"
  TMP="$INFO_ATTR.tmp.$$"
  # The BEGIN match is a prefix so a block written by an earlier installer version is replaced too.
  awk -v e="$END_MARK" '/^# >>> scrml-generated merge driver/{skip=1;next} $0==e{skip=0;next} !skip' "$INFO_ATTR" > "$TMP"
  { echo "$BEGIN_MARK"; echo "$LINES"; echo "$END_MARK"; } >> "$TMP"
  if cmp -s "$TMP" "$INFO_ATTR"; then rm -f "$TMP"; else mv "$TMP" "$INFO_ATTR"; changed="$changed info/attributes"; fi
fi

if [ -n "$changed" ]; then
  say "  merge driver scrml-generated installed for this clone + all its worktrees (updated:$changed)"
else
  say "  merge driver scrml-generated already configured"
fi
