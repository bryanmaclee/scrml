#!/usr/bin/env bash
# Usage: run.sh <label> [pattern]  — compiles every repro/*.scrml into
#   $SCRATCH/<label>/<name>/ and prints diagnostics + grep of emitted JS.
# Run from the worktree root.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="${1:-run}"
PAT="${2:-*}"
SCRATCH="${SCRATCH:-/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/3d8eae9f-f153-45e9-9c40-317c40f0c614/scratchpad/s441-f4f5}"
echo "compiler SHA: $(git rev-parse --short HEAD)"
for f in "$HERE"/$PAT.scrml; do
  b="$(basename "$f" .scrml)"
  out="$SCRATCH/$LABEL/$b"
  rm -rf "$out"; mkdir -p "$out"
  echo "=== $b"
  bun compiler/bin/scrml.js compile "$f" --output-dir "$out" 2>&1 | grep -E "E-|W-ASYNC|error|Compiled" | head -8
  grep -hn -E "_scrml_fetch_[A-Za-z0-9_]+\(|verifyPassword\(|\bm\(|\binner\(" "$out"/*.js 2>/dev/null | grep -v "^.*function _scrml_fetch" | head -12
done
