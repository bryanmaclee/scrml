# S428 — self-host conformance migration (append-only progress log)

Worktree: `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-ad65d27bcd6f3cc05`
Branch: `migrate/self-host-conformance`
Base SHA: `bf9e831c26fb1bf073c3e24e8817bda1c496c480` (== `origin/main` at dispatch)

Scope: syntax migration of `compiler/self-host/*.scrml` only. Four rules:
A1 `null`/`undefined` -> `not` (SPEC §42.1 / §42.7), A2 `===`/`!==` -> `==`/`!=` (§45),
B1 `try`/`catch` -> failable fns + `!{}` (§19), B2 `await`/`async` (§19.9.3 / §19.9.8).
NOT a refactor. Nothing is deleted, stubbed, simplified, or invented. Unmigratable sites are
left as-is and reported.

---

## Baseline — measured by execution at base SHA

Command (per module): `bun compiler/bin/scrml.js compile <f> --output-dir <tmp>`; exit code 0 == clean.

| module | LOC | exit | errors / warnings | error codes |
|---|---|---|---|---|
| ast | 3792 | 1 | 93 / 549 | E-SYNTAX-042 x67, E-FN-003 x10, E-SCOPE-001 x8, E-TRY-NOT-IN-SCRML x4, E-EQ-004 x2, E-AWAIT-NOT-IN-SCRML x2 |
| bpp | 232 | 1 | 5 / 38 | E-SYNTAX-042 x5 |
| bs | 894 | 1 | 1 / 53 | E-FN-003 x1 |
| cg | 21 | 0 | clean | — |
| dg | 1052 | 1 | 24 / 165 | E-SYNTAX-042 x16, E-FN-003 x8 |
| meta-checker | 874 | 0 | clean | — |
| module-resolver | 305 | 0 | clean | — |
| pa | 444 | 1 | 30 / 59 | E-EQ-004 x14, E-SYNTAX-042 x9, E-SCOPE-001 x5, E-TRY-NOT-IN-SCRML x2 |
| ri | 984 | 1 | 51 / 134 | E-SYNTAX-042 x51 |
| tab | 1109 | 1 | 1 / 154 | E-CODEGEN-INVALID-LOGIC x1 |
| ts | 2570 | 1 | 144 / 329 | E-SYNTAX-042 x134, E-FN-003 x5, E-SCOPE-001 x2, E-FN-004 x2, E-FN-002 x1 |

**HEADLINE BASELINE: 3 of 11 compile clean** (cg, meta-checker, module-resolver). Confirms the
brief's inherited figure by re-execution.

Note: error counts are "as far as the pipeline got" — later stages may surface more once earlier
gates pass.

### Raw A1 census (lexical scan, before any edit)

356 raw `null`/`undefined` word occurrences. Lexical classification (scanner in scratchpad,
cross-checked by hand):

- 343 in code position (candidates)
- 13 in exclusion positions: 2 line comments, 11 string-literal interiors
- 0 inside `_{}` foreign blocks (there are none in these files)
- 0 inside `?{}` SQL blocks
- 0 inside `^{}` meta blocks
