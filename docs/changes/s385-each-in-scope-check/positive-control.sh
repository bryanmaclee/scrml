#!/bin/bash
# POSITIVE CONTROL on the whole S385 measurement chain.
#
# WHY THIS EXISTS. The Phase-3 result is a ZERO, and a zero is exactly what a
# silently-dead harness also reports. This script is the difference between a
# measured zero and an assumed one, so it must be reproducible from a clean
# checkout with no scratch state.
#
# WHAT IT DOES. For each corpus file that (a) carries a real `<each>` opener with
# an `@`-cell in the slot under test and (b) PASSES on the build, copy it to a
# scratch dir, rename that cell to a guaranteed typo, and re-run the EXACT sweep
# command. If the harness and the compiler are really live, every one of these
# MUST flip PASS -> FAIL. Any file that STAYS passing is a false-zero suspect.
#
# Usage:  bash docs/changes/s385-each-in-scope-check/positive-control.sh [in|key]
#         (default: in)   Run from WORKTREE_ROOT, after sweep.sh build.
set -u
WT="$(pwd)"
SLOT="${1:-in}"
D="$WT/docs/changes/s385-each-in-scope-check"
SP="$(mktemp -d)"
trap 'rm -rf "$SP"' EXIT

[ -f "$D/build.tsv" ] || { echo "missing $D/build.tsv — run sweep.sh build first" >&2; exit 2; }

# Corpus file list, built INLINE (same roots as sweep.sh) — no scratch input.
LIST="$SP/eachfiles.txt"
{
  find "$WT/examples" -name '*.scrml' -type f 2>/dev/null
  find "$WT/samples"  -name '*.scrml' -type f 2>/dev/null
  find "$WT/stdlib"   -name '*.scrml' -type f 2>/dev/null
} | sort > "$SP/all.txt"
# Keep only files that actually contain an `<each` opener.
grep -lE "<[[:space:]]*each\b" $(cat "$SP/all.txt") 2>/dev/null | sort > "$LIST"

echo "positive control — slot '$SLOT' — $(wc -l < "$LIST") <each>-carrying files"
echo

flipped=0; stayed=0; skipped=0
while IFS= read -r f; do
  rel="${f#$WT/}"
  verdict=$(awk -F'\t' -v r="$rel" '$1==r {print $2}' "$D/build.tsv")
  [ "$verdict" = "PASS" ] || { skipped=$((skipped+1)); continue; }

  # Extract the target cell from a REAL opener only.
  #
  # The `<[[:space:]]*each\b[^>]*` prefix is load-bearing: an earlier revision
  # grepped for the bare attribute text and matched `<each in=@set>` written
  # inside a source COMMENT (examples/34-value-native-set.scrml lines 22 + 73),
  # so the mutation rewrote comment prose, left all three real openers intact,
  # and the file "stayed" — a false false-positive. Anchor on the opener.
  opener=$(grep -ohE "<[[:space:]]*each\b[^>]*\b${SLOT}=@[A-Za-z_$][A-Za-z0-9_$]*" "$f" | head -1)
  cell=$(printf '%s' "$opener" | grep -oE "${SLOT}=@[A-Za-z_$][A-Za-z0-9_$]*$" | sed "s/^${SLOT}=@//")
  # `key=@.id` is the contextual sigil, not a cell — the regex above already
  # excludes it (`@.` is not an identifier start), which is the intended skip.
  [ -n "$cell" ] || { skipped=$((skipped+1)); continue; }

  base=$(basename "$f")
  cp "$f" "$SP/$base"
  sed -i "s/\(<[[:space:]]*each[^>]*\b${SLOT}=@\)$cell\b/\1zzTypo$cell/g" "$SP/$base"
  # Confirm the mutation actually landed on an opener before trusting the run.
  if ! grep -qE "<[[:space:]]*each\b[^>]*\b${SLOT}=@zzTypo$cell\b" "$SP/$base"; then
    skipped=$((skipped+1))
    printf 'SKIP     %-70s (@%s) mutation did not land on an opener\n' "$rel" "$cell"
    continue
  fi

  out=$(bun "$WT/compiler/bin/scrml.js" compile "$SP/$base" --output-dir "$SP/out" 2>&1); rc=$?
  if [ $rc -ne 0 ] && printf '%s' "$out" | grep -qE "E-STATE-UNDECLARED|E-SCOPE-001"; then
    flipped=$((flipped+1)); printf 'FLIPPED  %-70s (@%s)\n' "$rel" "$cell"
  else
    stayed=$((stayed+1));  printf 'STAYED   %-70s (@%s) rc=%s  <<< FALSE ZERO SUSPECT\n' "$rel" "$cell" "$rc"
  fi
done < "$LIST"

echo
echo "positive control [$SLOT]: flipped=$flipped stayed=$stayed skipped=$skipped"
[ "$stayed" -eq 0 ] || exit 1
