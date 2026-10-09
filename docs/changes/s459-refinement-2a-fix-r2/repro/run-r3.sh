#!/bin/bash
# usage: run.sh <tree: head|base|main|r2> <scenario-file>... ; prints MISS rows + OK count
R=/home/bryan-maclee/.cache/scrml-agent-tmp/s459-ref2a-r3
cd $R/repro
case $1 in head) tree=/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-abc4d59cc093b0149;; *) tree=$R/$1;; esac
shift
for f in "$@"; do
  out=$(SC=$R/repro/$f.mjs bun g.mjs "$tree" "${FILTER:-}" 2>&1 | grep -E "^(OK|MISS)")
  echo "== $f: $(echo "$out" | grep -c '^OK') OK"
  echo "$out" | grep "^MISS" | cut -c1-160
done
