# progress — s449-scrml-fix-s66-twins (append-only)

- start: worktree agent-a7d956136e3176845 at origin/main cb26eeec6; BRIEF.md committed.
- merged origin/wip/s449-opener-keywords-land (the `let <x/>` spelling the twins target). The counter's
  own fixtures (main #1247) used S435 `<let x/>` → E-DECL-LET-IN-OPENER on the sibling parser; migrated
  in the merge commit. FACTS/known-gaps generated-section conflicts regenerated.
- step 1: compiler/src/commands/fix-s66.js (the §66 rule set) + commands/fix.js (`scrml fix` CLI) +
  cli.js wiring + facts.ts NOT_A_VERB + tests compiler/tests/commands/fix-s66.test.js (50).
  Corpus (957 legacy-marked cases): 504 fully mechanical, 0 idempotence failures, 2 residual markers
  (both false-positive markup `<span>=`).
  Codemod bugs found and fixed while building (each by a bite or a bootstrap run):
  - impl#1 writes a function-body `@x = v` as a structuralForm:false state-decl WITHOUT
    `_isReactiveAssign` — AST write set missed it (bite caught; lexical layer had covered it).
  - `<b reset-on=[@c]> = 0` is DROPPED by impl#1's front end (no node) — safety-net line scan added
    (a legacy decl the AST did not surface is reported, never left silently).
  - litType is "bool" not "boolean" in impl#1 ExprNodes.
  - untyped numeric literal → `:number` (impl#1 has no int inference; `<c=0/>` would infer int and
    `@c / 2` becomes E-INT-DIVISION on the bootstrap — verified).
  - union types (`T | not`) in an opener: no ruled spelling (bootstrap rejects `|`, `?`, parens) →
    blocker, not a guess.
