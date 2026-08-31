#!/bin/bash
# Corpus sweep for the S385 <each in=> scope-check measurement.
# Usage:  bash docs/changes/s385-each-in-scope-check/sweep.sh <label>
# Run from WORKTREE_ROOT. Writes <label>.tsv next to this script.
#
# Per file, one TSV row:   <relpath> \t <PASS|FAIL> \t <space-separated sorted unique diagnostic code set>
# Diff two labels with `diff` to get the newly-failing set.

set -u
WT="$(pwd)"
LABEL="${1:?usage: sweep.sh <label>}"
OUTDIR="$WT/docs/changes/s385-each-in-scope-check"
SCRATCH="/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6/scratchpad/sweep-$LABEL"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
RESULT="$OUTDIR/$LABEL.tsv"
: > "$RESULT"

SUPPORT=/home/bryan-maclee/scrmlMaster/scrml-support

# Build the file list.
LIST="$SCRATCH/files.txt"
: > "$LIST"
find "$WT/examples" -name '*.scrml' -type f 2>/dev/null | sort >> "$LIST"
find "$WT/samples"  -name '*.scrml' -type f 2>/dev/null | sort >> "$LIST"
find "$WT/stdlib"   -name '*.scrml' -type f 2>/dev/null | sort >> "$LIST"
ls "$SUPPORT"/docs/gauntlets/gauntlet-r25/dev-*.scrml 2>/dev/null | sort >> "$LIST"

TOTAL=$(wc -l < "$LIST")
echo "sweep[$LABEL]: $TOTAL files"

i=0
while IFS= read -r f; do
  i=$((i + 1))
  rel="${f#$WT/}"
  rel="${rel#$SUPPORT/}"
  od="$SCRATCH/out/$i"
  out=$(bun "$WT/compiler/bin/scrml.js" compile "$f" --output-dir "$od" 2>&1)
  rc=$?
  rm -rf "$od"
  if [ $rc -eq 0 ]; then verdict=PASS; else verdict=FAIL; fi
  codes=$(printf '%s' "$out" | grep -oE '\[[EWI]-[A-Z0-9_]+(-[A-Z0-9_]+)*\]' | tr -d '[]' | sort -u | tr '\n' ' ')
  codes="${codes% }"
  printf '%s\t%s\t%s\n' "$rel" "$verdict" "$codes" >> "$RESULT"
done < "$LIST"

echo "sweep[$LABEL] done: $(wc -l < "$RESULT") rows -> $RESULT"
echo "  PASS: $(awk -F'\t' '$2=="PASS"' "$RESULT" | wc -l)"
echo "  FAIL: $(awk -F'\t' '$2=="FAIL"' "$RESULT" | wc -l)"
