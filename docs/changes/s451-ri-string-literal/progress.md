# s451-ri-string-literal — progress

## Governing sentence (SPEC §12.4, compiler/SPEC.md:9720-9728)

> Route inference SHALL be per-function. The compiler SHALL classify each function based
> on its own body and its explicit closure-capture references to other functions; it SHALL
> NOT classify a function based on the names of identifiers that appear inside string-literal
> contents of its body.

Direction: semantics-changed toward the contract (conformance restoration).

## Log

- start: worktree verified, branch cut from origin/main b490f3b75; reproducer confirmed
  (`label` placed server, `/_scrml/__ri_route_label_1`).
- baseline placement dump taken over examples/ + samples/ + gauntlet-r25 dev-*.scrml
  (952 files, 1412 function rows, 217 server).
- fix landed (46352daab): `detectServerOnlyResourceForNode` matches SERVER_ONLY_PATTERNS against
  `codeOnlyTextForTrigger` — the tree rendered with every string / template-quasi text blanked
  (`emitCodeOnlyStringFromTree`, expression-parser.ts); opaque raw slots (escape-hatch `raw`,
  interpolated-template `raw`, match-expr `rawArms`, the match-arm `.expr` site, the
  no-exprNode fallback) lexed by the parser's acorn tokenizer (`blankLiteralTextInSource`),
  fail-closed (unlexable -> unchanged). Patterns themselves unchanged. Also the `?{\``
  sigil check in `hasServerOnlyResourceInInit`.
- tests: compiler/tests/unit/route-inference-trigger1-literal-blind.test.js, 76 tests;
  36 of them fail on the pre-fix RI (7 families x string/single/template/interp-template/
  block-callback); sql-in-string and comment shapes already passed pre-fix (guards).
- placement delta: examples/ + samples/ + gauntlet-r25 dev-*.scrml (952 files, 1412 fn rows):
  ZERO changes (boundary AND escalation reasons). compiler/self-host-v2 (61 files, 7707
  rows, 0 server): ZERO changes.
- pre-commit gate: 30090 tests, 0 fail.

## Deferred (same class, outside SERVER_ONLY_PATTERNS)
- D2c `detectImportedServerNamespaceRef(expr)` / `matchesNamespaceRef` and Trigger-2
  `bareExprAccessesField` / `declDestructuresField` still scan the unblanked text.
- (checked, NOT a gap: a block-body arrow `[x].map(y => { return session.userId + y })` still escalates — it reaches RI as an escape-hatch, which is lexed.)
