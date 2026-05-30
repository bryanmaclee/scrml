# Progress: s144-mangler-string-opacity (6nz Bug Z, HIGH)

- Started at PWD /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-add602239179ead08
- Baseline HEAD 505f4ace (v0.7.0). Pretest exit 0.
- Bug confirmed: post-emit fn-name mangler (emit-client.ts ~1387-1419) rewrites
  a declared name's substring INSIDE a string literal. Reproducer /tmp/bugz.scrml
  emits `_scrml_reactive_set("label", "_scrml_handleKey_2(e)")` (string corrupted).
- Root cause: clientCode.replace(combinedRegex,...) runs over the raw emitted JS
  string with NO string-literal awareness.
- Fix plan: wrap the mangle replace in rewriteCodeSegments (code-segments.ts) —
  the established string/regex/comment-aware fence already used by rewrite.ts and
  expression-parser.ts. transform applies only to code segments; string literals,
  regex literals, and comments are preserved verbatim.

## Fix applied + verified
- emit-client.ts: added `import { rewriteCodeSegments } from "./code-segments.ts"`;
  wrapped the fn-name mangle `clientCode.replace(combinedRegex,...)` in
  rewriteCodeSegments so the substitution applies ONLY to code segments.
  String/regex literals + comments pass through verbatim. Committed badc092c.
- R26 reproducer (/tmp/bugz.scrml + /tmp/bugz2.scrml): string `"handleKey(e)"`
  now intact; declaration `_scrml_handleKey_N()` and onclick call
  `_scrml_handleKey_N()` still mangled. node --check passes.
- Added compiler/tests/unit/mangle-string-literal-opacity.test.js (6 tests, all
  pass): §1 string opacity (", ', backtick), §2 decl+call mangle, §3 interaction
  (string + real onclick call same file), §4 escaped-quote string opacity.

## Regression-gate note (flaky full-suite tests — NOT regressions)
- Full `bun test compiler/tests/` reported 3 fail under parallel load:
  self-compilation.test.js (bootstrap ts.scrml / ast.scrml parity) and
  trucking-dispatch-smoke-integration.test.js (manifest.compiler stable across
  two compiles). Re-running each file FOCUSED: self-compilation 22/22 pass,
  trucking-dispatch 13/13 pass. These are pre-existing parallel-load flakes
  (self-host parity + two-compile determinism), unrelated to the mangler fence.
  The fix cannot affect self-host parity / manifest stability except via files
  with a declared name inside a string literal; focused reruns confirm green.
