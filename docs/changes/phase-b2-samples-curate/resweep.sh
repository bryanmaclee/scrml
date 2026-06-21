#!/usr/bin/env bash
set -u
cd "$(git rev-parse --show-toplevel)"
OUT="docs/changes/phase-b2-samples-curate/triage-positive.tsv"
RES="docs/changes/phase-b2-samples-curate/resweep-result.txt"
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
np=0; sf=0
: > "$RES.tmp"
while IFS=$'\t' read -r f actual; do
  bun run compiler/src/cli.js compile "$f" -o "$TMPD/o/" >/dev/null 2>"$TMPD/err"; rc=$?
  if [ "$rc" -eq 0 ]; then np=$((np+1)); else
    sf=$((sf+1))
    code=$(grep -oE '^error \[[A-Z0-9-]+\]' "$TMPD/err" | head -1 | sed -E 's/^error \[//; s/\]$//')
    echo "$(echo "$f"|sed 's#samples/compilation-tests/##') | $code" >> "$RES.tmp"
  fi
done < "$OUT"
{ echo "RESULT now_pass=$np still_fail=$sf"; sort "$RES.tmp"; } > "$RES"
echo "SWEEP-COMPLETE" >> "$RES"
rm -f "$RES.tmp"
