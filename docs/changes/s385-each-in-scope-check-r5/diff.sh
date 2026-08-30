#!/bin/bash
# Diff two corpus sweeps produced by the r5 sweep.sh. Run from WORKTREE_ROOT.
# Usage: bash docs/changes/s385-each-in-scope-check-r5/diff.sh <before-label> <after-label>
#        (default: base build-r5)
D="$(pwd)/docs/changes/s385-each-in-scope-check-r5"
BL="${1:-base}"
AL="${2:-build-r5}"
BASE="$D/$BL.tsv"
BUILD="$D/$AL.tsv"

echo "===== $BL  ->  $AL ====="
echo "===== ROW-COUNT SANITY ====="
echo "before rows: $(wc -l < "$BASE")"
echo "after  rows: $(wc -l < "$BUILD")"
echo "paths identical: $(diff <(cut -f1 "$BASE") <(cut -f1 "$BUILD") > /dev/null && echo YES || echo NO)"

echo
echo "===== VERDICT TOTALS ====="
printf '%-10s PASS=%s FAIL=%s\n' "$BL" "$(awk -F'\t' '$2=="PASS"' "$BASE" | wc -l)" "$(awk -F'\t' '$2=="FAIL"' "$BASE" | wc -l)"
printf '%-10s PASS=%s FAIL=%s\n' "$AL" "$(awk -F'\t' '$2=="PASS"' "$BUILD" | wc -l)" "$(awk -F'\t' '$2=="FAIL"' "$BUILD" | wc -l)"

echo
echo "===== PER-FILE VERDICT FLIPS (the deliverable) ====="
join -t$'\t' -j1 <(cut -f1,2 "$BASE" | sort -t$'\t' -k1,1) <(cut -f1,2 "$BUILD" | sort -t$'\t' -k1,1) \
  | awk -F'\t' '$2 != $3 { print $2"->"$3"\t"$1 }' | sort > "$D/flips-$BL-to-$AL.txt"
echo "NEWLY-FAILING (PASS->FAIL): $(grep -c '^PASS->FAIL' "$D/flips-$BL-to-$AL.txt")"
grep '^PASS->FAIL' "$D/flips-$BL-to-$AL.txt" | sed 's/^PASS->FAIL\t/  /'
echo "NEWLY-PASSING (FAIL->PASS): $(grep -c '^FAIL->PASS' "$D/flips-$BL-to-$AL.txt")"
grep '^FAIL->PASS' "$D/flips-$BL-to-$AL.txt" | sed 's/^FAIL->PASS\t/  /'

echo
echo "===== DIAGNOSTIC CODE-SET CHANGES (incl. files that stayed FAIL) ====="
join -t$'\t' -j1 <(sort -t$'\t' -k1,1 "$BASE") <(sort -t$'\t' -k1,1 "$BUILD") \
  | awk -F'\t' '$3 != $5 { print $1"\n    before: "$3"\n    after : "$5 }' > "$D/codeset-changes-$BL-to-$AL.txt"
echo "files with a changed code set: $(grep -cv '^ ' "$D/codeset-changes-$BL-to-$AL.txt")"
cat "$D/codeset-changes-$BL-to-$AL.txt"
