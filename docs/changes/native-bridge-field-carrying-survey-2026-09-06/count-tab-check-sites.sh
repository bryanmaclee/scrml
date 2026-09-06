#!/usr/bin/env bash
# How many DISTINCT emission sites in compiler/src/ast-builder.js would a relocation of the
# TAB-embedded checks have to move? Counts lines in ast-builder.js that name one of the
# TAB-exclusive codes, excluding pure comment lines, so the number is edit-sites not mentions.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
AB="$ROOT/compiler/src/ast-builder.js"
IN="$ROOT/docs/changes/native-bridge-field-carrying-survey-2026-09-06/artifacts/tab-exclusive-codes.txt"
total=0
while read -r c; do
  [ -z "$c" ] && continue
  n=$(grep -n -- "$c" "$AB" | grep -v ':[[:space:]]*\*' | grep -v ':[[:space:]]*//' | wc -l)
  printf '%4d  %s\n' "$n" "$c"
  total=$((total + n))
done < "$IN"
echo "----"
echo "total non-comment lines naming a TAB-exclusive code in ast-builder.js: $total"
