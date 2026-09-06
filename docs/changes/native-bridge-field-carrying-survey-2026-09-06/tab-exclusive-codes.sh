#!/usr/bin/env bash
# Which of the codes emitted from compiler/src/ast-builder.js are emitted ONLY
# from there? Those are the checks that vanish entirely when the native parser
# replaces the live TAB stage — no other site can fire them.
set -u  # NOT -e/-o pipefail: `grep -rl` legitimately exits 1 on no-match
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IN="$ROOT/docs/changes/native-bridge-field-carrying-survey-2026-09-06/artifacts/astbuilder-codes-all.txt"
OUT="$ROOT/docs/changes/native-bridge-field-carrying-survey-2026-09-06/artifacts/tab-exclusive-codes.txt"
: > "$OUT"
while read -r c; do
  [ -z "$c" ] && continue
  n=$(grep -rl --include='*.ts' --include='*.js' -e "$c" "$ROOT/compiler/src/" 2>/dev/null \
        | grep -v 'ast-builder\.js' \
        | grep -v 'diagnostic' \
        | wc -l)
  if [ "$n" -eq 0 ]; then echo "$c" >> "$OUT"; fi
done < "$IN"
wc -l < "$OUT"
