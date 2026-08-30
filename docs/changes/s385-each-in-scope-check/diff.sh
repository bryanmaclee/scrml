#!/bin/bash
# Diff the base vs build corpus sweeps. Run from WORKTREE_ROOT.
D="$(pwd)/docs/changes/s385-each-in-scope-check"
BASE="$D/base.tsv"
BUILD="$D/build.tsv"

echo "===== ROW-COUNT SANITY ====="
echo "base rows:  $(wc -l < "$BASE")"
echo "build rows: $(wc -l < "$BUILD")"
echo "paths identical: $(diff <(cut -f1 "$BASE") <(cut -f1 "$BUILD") > /dev/null && echo YES || echo NO)"

echo
echo "===== VERDICT TOTALS ====="
printf 'base  PASS=%s FAIL=%s\n' "$(awk -F'\t' '$2=="PASS"' "$BASE" | wc -l)" "$(awk -F'\t' '$2=="FAIL"' "$BASE" | wc -l)"
printf 'build PASS=%s FAIL=%s\n' "$(awk -F'\t' '$2=="PASS"' "$BUILD" | wc -l)" "$(awk -F'\t' '$2=="FAIL"' "$BUILD" | wc -l)"

echo
echo "===== PER-FILE VERDICT FLIPS (the deliverable) ====="
join -t$'\t' -j1 <(cut -f1,2 "$BASE" | sort -t$'\t' -k1,1) <(cut -f1,2 "$BUILD" | sort -t$'\t' -k1,1) \
  | awk -F'\t' '$2 != $3 { print $2"->"$3"\t"$1 }' | sort > "$D/flips.txt"
echo "NEWLY-FAILING (PASS->FAIL): $(grep -c '^PASS->FAIL' "$D/flips.txt" || true)"
grep '^PASS->FAIL' "$D/flips.txt" | sed 's/^PASS->FAIL\t/  /' || true
echo "NEWLY-PASSING (FAIL->PASS): $(grep -c '^FAIL->PASS' "$D/flips.txt" || true)"
grep '^FAIL->PASS' "$D/flips.txt" | sed 's/^FAIL->PASS\t/  /' || true

echo
echo "===== DIAGNOSTIC CODE-SET CHANGES (incl. files that stayed FAIL) ====="
join -t$'\t' -j1 <(sort -t$'\t' -k1,1 "$BASE") <(sort -t$'\t' -k1,1 "$BUILD") \
  | awk -F'\t' '$3 != $5 { print $1"\n    base : "$3"\n    build: "$5 }' > "$D/codeset-changes.txt"
echo "files with a changed code set: $(grep -cv '^ ' "$D/codeset-changes.txt" || true)"
cat "$D/codeset-changes.txt"
