#!/usr/bin/env bash
# Compile the sample .scrml files needed by browser tests (compiler/tests/browser/).
# Run automatically via `bun run pretest` before `bun test`.

set -e

SAMPLES_DIR="samples/compilation-tests"
DIST_DIR="$SAMPLES_DIR/dist"
CLI="compiler/src/cli.js"

mkdir -p "$DIST_DIR"

SAMPLES=(
  combined-001-counter
  combined-002-todo
  combined-003-form-validation
  combined-021-component-basic
  control-001-if-basic
  control-002-if-else
  control-011-if-reactive
  match-002-block-form-arm-swap
  reactive-014-form-state
  reactive-016-bind-value
  reactive-017-arrays
  reactive-018-class-binding
  transition-001-basic
)

for name in "${SAMPLES[@]}"; do
  bun run "$CLI" compile "$SAMPLES_DIR/$name.scrml" -o "$DIST_DIR/" 2>/dev/null
done

echo "Compiled ${#SAMPLES[@]} test samples -> $DIST_DIR/"

# S469 — browser-todomvc.test.js reads the gitignored benchmarks/todomvc/dist/ (its header's
# "Requires:" line). Nothing in the tier's setup built it: it passed only where something else had
# (CI's gauntlet step, or todomvc-e2e.test.js's beforeAll when bun happened to run that file first),
# and could read a STALE build otherwise. Build it here, with the same flags as CI's gauntlet step.
bun run "$CLI" compile benchmarks/todomvc/app.scrml --output benchmarks/todomvc/dist/ --convert-legacy-css 2>/dev/null
echo "Compiled benchmarks/todomvc/app.scrml -> benchmarks/todomvc/dist/"
