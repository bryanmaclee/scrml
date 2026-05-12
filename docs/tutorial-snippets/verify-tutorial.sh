#!/usr/bin/env bash
# verify-tutorial.sh
# Compile-verify every tutorial snippet against the v0.2.4 compiler.
# Exits non-zero if any snippet fails to compile.
#
# Run from the worktree root:
#   bash docs/tutorial-snippets/verify-tutorial.sh

set -u

WORKTREE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$WORKTREE_ROOT"

SNIPPET_DIR="docs/tutorial-snippets"
OUT_DIR="/tmp/scrml-tutorial-verify-$$"
mkdir -p "$OUT_DIR"

# Snippets explicitly referenced in tutorial.md by filename:
SNIPPETS=(
  "01-hello.scrml"
  "02-counter.scrml"
  "02a-derived.scrml"
  "02b-counter-persisted.scrml"
  "02c-styles.scrml"
  "03-todos.scrml"
  "04a-tier1-match.scrml"
  "04b-tier2-engine.scrml"
  "05-signup-form.scrml"
  "06-failable.scrml"
  "07-channel-chat.scrml"
)

PASS=0
FAIL=0
FAILED_LIST=()

for snippet in "${SNIPPETS[@]}"; do
  path="$SNIPPET_DIR/$snippet"
  if [ ! -f "$path" ]; then
    echo "MISSING  $snippet"
    FAIL=$((FAIL + 1))
    FAILED_LIST+=("$snippet (missing)")
    continue
  fi

  out=$(bun compiler/bin/scrml.js compile "$path" -o "$OUT_DIR" 2>&1)
  status=$?

  if [ $status -eq 0 ]; then
    echo "PASS     $snippet"
    PASS=$((PASS + 1))
  else
    echo "FAIL     $snippet"
    echo "         status=$status"
    echo "$out" | tail -10 | sed 's/^/         /'
    FAIL=$((FAIL + 1))
    FAILED_LIST+=("$snippet")
  fi
done

echo ""
echo "Summary: $PASS pass / $FAIL fail / ${#SNIPPETS[@]} total"

# Clean up
rm -rf "$OUT_DIR"

if [ $FAIL -ne 0 ]; then
  echo ""
  echo "Failed snippets:"
  for s in "${FAILED_LIST[@]}"; do
    echo "  - $s"
  done
  exit 1
fi

exit 0
