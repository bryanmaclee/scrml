#!/bin/sh
# scripts/git-merge-generated.sh — the crash-safe wrapper git invokes for `merge=scrml-generated`.
# change-id: s468-generated-merge-driver
#
# git calls (via the clone config set by scripts/install-merge-driver.sh):
#   /bin/sh scripts/git-merge-generated.sh %O %A %B %P %L %S %X %Y   (plain `sh` only if /bin/sh is absent)
# from the top of OURS' working tree, so this file and the driver are always the checked-out
# branch's own versions (never a copy from another worktree or an older branch).
#
# FAIL CLOSED. The driver (scripts/git-merge-generated.ts) writes its result to %A and then a
# `%A.scrml-done` sentinel. If it exits WITHOUT the sentinel — an import-time throw, a bun crash, an
# OOM kill, no bun at all — %A may hold pure OURS (or a partial write) and git would show the path
# conflicted with NO markers, so a `git add` would silently drop theirs. In that case this wrapper
# rewrites %A as git's plain 3-way merge of the ORIGINAL three inputs (with markers) under a loud
# marker block, and exits 1: the path stays conflicted and both sides are on the page.

O=$1 A=$2 B=$3 P=$4 L=${5:-7} S=$6 X=$7 Y=$8
case "$L" in ''|*[!0-9]*) L=7 ;; esac
OURS="$A.scrml-ours"
DONE="$A.scrml-done"
if ! cp "$A" "$OURS"; then
  # Cannot even snapshot ours (no cp on PATH, a full disk, …). Exiting here would leave %A as pure
  # OURS with no markers — exactly the silent drop this wrapper exists to prevent. Still fail CLOSED:
  # git's own 3-way, IN PLACE (merge-file writes into its first argument, so no copy is needed; git is
  # always reachable — git prepends its exec-path to a driver's PATH).
  git merge-file --marker-size="$L" -L "$X" -L "$S" -L "$Y" "$A" "$O" "$B"
  echo "scrml-generated-merge [$P]: could not copy %A - left CONFLICTED with git's plain 3-way (fail closed)" >&2
  exit 1
fi
rm -f "$DONE"

why=""
if command -v bun >/dev/null 2>&1; then
  bun scripts/git-merge-generated.ts "$@"
  rc=$?
  if [ -f "$DONE" ]; then
    rm -f "$DONE" "$OURS"
    exit "$rc"
  fi
  why="DRIVER FAILED (exit $rc before writing a result)"
else
  why="DRIVER UNAVAILABLE (no bun on PATH)"
fi

# The fail-closed write needs ONLY shell builtins + git (git prepends its exec-path to a driver's
# PATH): the bar is built in the shell (no tr), and git's 3-way is appended straight onto the banner
# (no cat, no temp file) — a PATH missing coreutils must not turn the fallback into four marker-less
# lines with neither side under them.
bar() { b=; i=0; while [ "$i" -lt "$L" ]; do b="$b$1"; i=$((i + 1)); done; printf '%s' "$b"; }
{
  printf '%s scrml-generated-merge: %s - generated content NOT regenerated\n' "$(bar '<')" "$why"
  printf 'Below is git'"'"'s plain 3-way merge of the original inputs.\n'
  printf '%s\n' "$(bar '=')"
  printf '%s resolve by hand (then bun scripts/state.ts --write / --regen), and delete this block\n' "$(bar '>')"
} > "$A"
git merge-file -p --marker-size="$L" -L "$X" -L "$S" -L "$Y" "$OURS" "$O" "$B" >> "$A"
rm -f "$OURS"
echo "scrml-generated-merge [$P]: $why - left CONFLICTED with git's plain 3-way (fail closed)" >&2
exit 1
