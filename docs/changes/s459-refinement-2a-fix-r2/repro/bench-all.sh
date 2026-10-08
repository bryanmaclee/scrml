#!/bin/bash
# usage: bench-all.sh <sc-file> <NS> <name>...   (3 runs per tree; prints every run, min first)
cd /home/bryan-maclee/.cache/scrml-agent-tmp/s459-ref2a-r2/repro
S=/home/bryan-maclee/.cache/scrml-agent-tmp/s459-ref2a-r2
sc="$1"; ns="$2"; shift 2
for name in "$@"; do
  for t in main base head; do
    case $t in main) tree="$S/main";; base) tree="$S/base";; head) tree=/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-abc4d59cc093b0149;; esac
    runs=""
    for r in 1 2 3; do
      ms=$(NS="$ns" SC="$sc" bun g.mjs "$tree" "$name" 2>&1 | grep "click ms" | awk '{print $3}' | paste -s -d'/')
      runs="$runs $ms"
    done
    echo "$name $t:$runs"
  done
done
