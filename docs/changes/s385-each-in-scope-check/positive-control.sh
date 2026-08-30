#!/bin/bash
# POSITIVE CONTROL on the whole measurement chain.
# For each corpus file that (a) contains an `<each in=@cell>` and (b) PASSES on
# the build, copy it to a scratch dir, rename the iterated cell to a guaranteed
# typo, and re-run the EXACT sweep command. If the harness + compiler are really
# live, every one of these MUST flip PASS -> FAIL with E-STATE-UNDECLARED.
# If any stays PASS, the measured zero is a false zero.
set -u
WT="$(pwd)"
SP=/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6/scratchpad/poscontrol
rm -rf "$SP"; mkdir -p "$SP"
D="$WT/docs/changes/s385-each-in-scope-check"

flipped=0; stayed=0; skipped=0
while IFS= read -r f; do
  rel="${f#$WT/}"
  # only files that PASS on the build
  verdict=$(awk -F'\t' -v r="$rel" '$1==r {print $2}' "$D/build.tsv")
  [ "$verdict" = "PASS" ] || { skipped=$((skipped+1)); continue; }
  # find the first `<each in=@name` cell name
  cell=$(grep -oE "<[[:space:]]*each\b[^>]*\bin=@[A-Za-z_$][A-Za-z0-9_$]*" "$f" | head -1 | grep -oE "in=@[A-Za-z_$][A-Za-z0-9_$]*" | sed 's/^in=@//')
  [ -n "$cell" ] || { skipped=$((skipped+1)); continue; }
  base=$(basename "$f")
  cp "$f" "$SP/$base"
  # rewrite ONLY the each opener's in=@cell -> in=@zzTypo<cell>
  sed -i "s/\(<[[:space:]]*each[^>]*\bin=@\)$cell\b/\1zzTypo$cell/g" "$SP/$base"
  out=$(bun "$WT/compiler/bin/scrml.js" compile "$SP/$base" --output-dir "$SP/out" 2>&1); rc=$?
  if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "E-STATE-UNDECLARED"; then
    flipped=$((flipped+1)); printf 'FLIPPED  %-70s (@%s)\n' "$rel" "$cell"
  else
    stayed=$((stayed+1));  printf 'STAYED   %-70s (@%s) rc=%s  <<< FALSE ZERO SUSPECT\n' "$rel" "$cell" "$rc"
  fi
done < /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/341444f8-6bac-4378-9e62-c16f9ca2dee6/scratchpad/eachfiles.txt

echo
echo "positive control: flipped=$flipped stayed=$stayed skipped=$skipped"
