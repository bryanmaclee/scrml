#!/usr/bin/env bash
# `*.log` is gitignored repo-wide (.gitignore:5). The survey's raw run output IS the evidence
# for every number in the report, so mirror each .log to a committable .txt, dropping the
# `Note(PA): Database file ... does not exist` chatter the compiler prints per compile.
set -u
D="$(cd "$(dirname "$0")/artifacts" && pwd)"
for f in "$D"/*.log; do
  [ -e "$f" ] || continue
  grep -v '^Note(PA)' "$f" > "${f%.log}.txt"
  echo "$(basename "${f%.log}.txt")  $(wc -l < "${f%.log}.txt") lines"
done
