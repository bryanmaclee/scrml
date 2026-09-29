#!/usr/bin/env bash
# Phase 3 empirical check: compile real sources with a compiler tree and grep the
# emitted CLIENT JS for a server-fetch Promise reaching a sync consumer.
#   bash phase3-grep.sh <compilerRoot> <label>
# The symptom: an `if (` / `.some(` / `.filter(` / `.every(` / `.find(` / `&&` / `||`
# / `?` whose operand is a bare `_scrml_fetch_*(` call (no `await`).
set -u
CROOT="$1"; LABEL="$2"
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="${SCRATCH:-/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/3d8eae9f-f153-45e9-9c40-317c40f0c614/scratchpad/s441-f4f5}/phase3-$LABEL"
rm -rf "$OUT"; mkdir -p "$OUT"
for f in "$REPO"/examples/*.scrml "$REPO"/docs/readme-snippets/tasks-app.scrml; do
  b="$(basename "$f" .scrml)"
  bun "$CROOT/compiler/bin/scrml.js" compile "$f" --output-dir "$OUT/$b" > "$OUT/$b.log" 2>&1 || true
done
bun "$CROOT/compiler/bin/scrml.js" compile /home/bryan-maclee/scrmlMaster/scrml-site --output-dir "$OUT/scrml-site" > "$OUT/scrml-site.log" 2>&1 || true
PAT='(if \(\s*|while \(\s*|\.(some|filter|every|find|findIndex)\(\s*\(?[A-Za-z_$, ]*\)?\s*=>\s*|&&\s*|\|\|\s*|!\s*)_scrml_fetch_[A-Za-z0-9_]+\(|(?<!await )(?<!await \()_scrml_fetch_[A-Za-z0-9_]+\([^()]*\)\s*(\?|&&|\|\||===|!==|==|!=)'
echo "compiler: $CROOT"
echo "client.js files: $(find "$OUT" -name '*.client.js' | wc -l)"
echo "hits (grep -P over *.client.js):"
find "$OUT" -name '*.client.js' -print0 | xargs -0 grep -nP "$PAT" > "$OUT/hits.txt" || true
wc -l < "$OUT/hits.txt"
cut -c1-220 "$OUT/hits.txt" | sed "s|$OUT/||"
