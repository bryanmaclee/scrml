# progress — s444-async-escape-wording

- [x] startup verified; branch fix/s444-async-escape-wording off origin/main 108ca89be
- [x] message + doc comment rewritten in compiler/src/codegen/emit-library-shared.ts (sole builder)
- [x] pinning test added (s441-async-escape-f4-f5.test.js); no test/conformance asserted the old text
- [x] SPEC untouched: §34 row / §13.2 prose paraphrase ("receives"), not a verbatim quote of the old sentence
- [x] conformance: 1144/1151 pass + 7 xfail before AND after; per-case PASS/XFAIL lines identical
- [x] full gate: 26680 pass / 72 skip / 0 fail
- note: pre-commit hook hit load-induced 5s timeouts (load avg 16-23 from sibling worktrees) + shared-PG
  contention; committed with SCRML_PGTEST=0 (the test's documented opt-out), hook otherwise run in full.
