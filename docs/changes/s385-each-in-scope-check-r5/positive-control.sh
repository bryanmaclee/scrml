#!/bin/bash
# POSITIVE CONTROL on the whole S385 measurement chain.
#
# WHY THIS EXISTS. The Phase-3 result is a ZERO, and a zero is exactly what a
# silently-dead harness also reports. This script is the difference between a
# measured zero and an assumed one, so it must be reproducible from a clean
# checkout with no scratch state.
#
# WHAT IT DOES. For each corpus file that (a) carries a real `<each>` opener with
# the slot under test and (b) PASSES on the build, copy it to a scratch dir,
# rewrite that slot to a guaranteed-undeclared name, and re-run the EXACT sweep
# command. If the harness and the compiler are really live, every one of these
# MUST flip PASS -> FAIL. Any file that STAYS passing is a false-zero suspect,
# and the script exits non-zero.
#
# TWO MUTATION STRATEGIES, because the two slots are populated differently in the
# corpus:
#   in    — the corpus has real `in=@cell` reads, so rename the CELL (`@rows` ->
#           `@zzTyporows`), leaving the shape otherwise identical.
#   key   — the corpus has only `key=@.id` (22) and `key=__index__` (13), both of
#           which are EXEMPT by design. Renaming a cell is impossible; instead
#           replace the whole key VALUE with a bare undeclared identifier, which
#           is the shape that used to lower to `(r, _idx) => undeclaredName` and
#           ReferenceError at first render.
#
# Usage:  bash docs/changes/s385-each-in-scope-check-r5/positive-control.sh [in|key] [sweep-label]
#         (defaults: in build-r5)   Run from WORKTREE_ROOT, after sweep.sh.
set -u
WT="$(pwd)"
SLOT="${1:-in}"
LABEL="${2:-build-r5}"
D="$WT/docs/changes/s385-each-in-scope-check-r5"
SP="$(mktemp -d)"
trap 'rm -rf "$SP"' EXIT

[ -f "$D/$LABEL.tsv" ] || { echo "missing $D/$LABEL.tsv — run sweep.sh $LABEL first" >&2; exit 2; }

# Corpus file list, built INLINE (same roots as sweep.sh) — no scratch input.
{
  find "$WT/examples" -name '*.scrml' -type f 2>/dev/null
  find "$WT/samples"  -name '*.scrml' -type f 2>/dev/null
  find "$WT/stdlib"   -name '*.scrml' -type f 2>/dev/null
} | sort > "$SP/all.txt"
LIST="$SP/eachfiles.txt"
grep -lE "<[[:space:]]*each\b" $(cat "$SP/all.txt") 2>/dev/null | sort > "$LIST"

echo "positive control — slot '$SLOT' vs sweep '$LABEL' — $(wc -l < "$LIST") <each>-carrying files"
echo

flipped=0; stayed=0; skipped=0
while IFS= read -r f; do
  rel="${f#$WT/}"
  verdict=$(awk -F'\t' -v r="$rel" '$1==r {print $2}' "$D/$LABEL.tsv")
  [ "$verdict" = "PASS" ] || { skipped=$((skipped+1)); continue; }

  base=$(basename "$f")
  cp "$f" "$SP/$base"

  # COMMENT LINES MUST BE EXCLUDED FROM MATCHING. This bit is load-bearing and
  # it bit twice. `examples/34-value-native-set.scrml` documents the feature in
  # prose on lines 22 and 73 by writing the opener LITERALLY inside a `//`
  # comment: "(also: <each in=@set> directly)". Anchoring the grep on
  # `<[[:space:]]*each` does NOT help — the comment really does contain that
  # text. So the cell got read from prose, the mutation rewrote prose, all three
  # real openers were left intact, and the file reported STAYED: a false
  # false-positive that looked exactly like a dead harness. Match against a
  # comment-BLANKED view of the file, and verify the mutation landed on a
  # non-comment line before trusting the result.
  nocomment() { sed -E 's@^[[:space:]]*//.*@@' "$1"; }

  if [ "$SLOT" = "key" ]; then
    nocomment "$f" | grep -qE "<[[:space:]]*each\b[^>]*\bkey=" || { skipped=$((skipped+1)); continue; }
    # Plain global rewrite. Unlike the `in` branch, this does not READ a name out
    # of the file, so a comment that happens to contain `key=` is harmless: a
    # mutated comment cannot make a compile fail, so it can never manufacture a
    # false FLIP. The non-comment landing check below is what proves a real
    # opener was hit.
    sed -i -E "s@(<[[:space:]]*each\b[^>]*\bkey=)[^ >]+@\1zzTypoUndeclaredKey@g" "$SP/$base"
    probe="zzTypoUndeclaredKey"
    label="key"
  else
    opener=$(nocomment "$f" | grep -ohE "<[[:space:]]*each\b[^>]*\b${SLOT}=@[A-Za-z_$][A-Za-z0-9_$]*" | head -1)
    cell=$(printf '%s' "$opener" | grep -oE "${SLOT}=@[A-Za-z_$][A-Za-z0-9_$]*$" | sed "s/^${SLOT}=@//")
    # `in=@.x` is the contextual sigil, not a cell — excluded by the regex above
    # (`@.` is not an identifier start), which is the intended skip.
    [ -n "$cell" ] || { skipped=$((skipped+1)); continue; }
    sed -i "s/\(<[[:space:]]*each[^>]*\b${SLOT}=@\)$cell\b/\1zzTypo$cell/g" "$SP/$base"
    probe="zzTypo$cell"
    label="@$cell"
  fi

  # Confirm the mutation landed on a REAL opener — i.e. on a non-comment line.
  if ! nocomment "$SP/$base" | grep -qE "<[[:space:]]*each\b[^>]*${probe}"; then
    skipped=$((skipped+1))
    printf 'SKIP     %-70s (%s) mutation did not land on a real opener\n' "$rel" "$label"
    continue
  fi

  out=$(bun "$WT/compiler/bin/scrml.js" compile "$SP/$base" --output-dir "$SP/out" 2>&1); rc=$?
  if [ $rc -ne 0 ] && printf '%s' "$out" | grep -qE "E-STATE-UNDECLARED|E-SCOPE-001"; then
    flipped=$((flipped+1)); printf 'FLIPPED  %-70s (%s)\n' "$rel" "$label"
  else
    stayed=$((stayed+1));  printf 'STAYED   %-70s (%s) rc=%s  <<< FALSE ZERO SUSPECT\n' "$rel" "$label" "$rc"
  fi
done < "$LIST"

echo
echo "positive control [$SLOT vs $LABEL]: flipped=$flipped stayed=$stayed skipped=$skipped"
[ "$stayed" -eq 0 ] || exit 1
