#!/usr/bin/env bash
# verify-tutorial.sh
# Compile-verify every tutorial snippet, the way CI does.
#
# S469: docs/tutorial.md is written in the RULED dialect (`<!-- dialect: ruled -->`),
# so its snippet files are compiled by the BOOTSTRAP, not impl#1. This script used
# to run `scrml compile` (impl#1) over a hardcoded list; it now delegates to the
# snippet gate, which picks the compiler from the citing document, knows the
# spec-ahead markers, and discovers files instead of listing them. See docs/DIALECT.md.
#
# Run from anywhere:
#   bash docs/tutorial-snippets/verify-tutorial.sh

set -eu
WORKTREE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$WORKTREE_ROOT"
exec bun scripts/snippet-gate.js docs/tutorial-snippets/*.scrml
