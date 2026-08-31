#!/bin/bash
# Corpus sweep for the S385 r4 <each> opener scope-check measurement.
# Usage:  bash docs/changes/s385-each-in-scope-check-r4/sweep.sh <label>
# Run from WORKTREE_ROOT. Writes <label>.tsv next to this script.
#
# Per file, one TSV row:   <relpath> \t <PASS|FAIL> \t <space-separated sorted unique diagnostic code set>
#
# Identical to round 3's sweep.sh except for the SCRATCH path — that one carried
# round 3's session id hard-coded, and sibling worktree agents SHARE the
# scratchpad root, so reusing it races another dispatch's files.
#
# NOTE ON WHAT THIS MEASURES: it drives the CLI, which WRITES output, so the
# api.js emitted-JS parse gate (inside `if (write && outputDir)`) is LIVE here.
# A `compileScrml({write:false})` harness would NOT see E-CODEGEN-INVALID-LOGIC.

set -u
WT="$(pwd)"
LABEL="${1:?usage: sweep.sh <label>}"
OUTDIR="$WT/docs/changes/s385-each-in-scope-check-r4"
SCRATCH="/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/2d10eb9e-8ba4-4bf3-ba64-f5219b1014a7/scratchpad/sweep-$LABEL"
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
