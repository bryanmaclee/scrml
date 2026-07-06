# BRIEF — flogence residual D (reframed): foreign VALUE block trailing-bare-expr → silent `undefined`

**Status:** SCOPED — needs a RULING before dispatch (a 3-way fork that REVISES the S216 dpa-003 decision).
Dispatch AFTER clean-print lands (shared emit surface: emit-logic.ts `case "foreign"` / emit-tool.ts).
**Origin:** flogence R26 (1251, `fleet --route`), filed `g-foreign-multistmt-value-block-mislowers` MED.
**R26 RE-VERIFY (PA-side @ `59dc5287`) — the gap is MOSTLY ALREADY FIXED** (flogence tested at `94e156c5`;
a landing since — likely the W5b foreign-detection consolidation `364def58` — closed the codegen defect):

| flogence shape | at `94e156c5` (their test) | at `59dc5287` (now) |
|---|---|---|
| (a) bare side-effect `_={ … }=` (stmt position) | `return (console.log…; for…)` → E-CODEGEN-INVALID-LOGIC | ✅ clean **E-FOREIGN-004** ("bare non-value block not valid here") |
| (b) value-form multi-stmt, trailing bare expr, NO return | `return (const lines=…; …join())` → E-CODEGEN-INVALID-LOGIC | ⚠️ compiles clean, spliced verbatim, but **`s` = `undefined` silently** |
| (b') value-form with explicit `return` (the workaround) | works | ✅ works (`return lines.join(",")` flows) |

So the **codegen defect is GONE** (`emit-logic.ts:2844 scanForeignSliceShape` splits single-expr → `return
(slice)` from multi-stmt → verbatim splice). The **live remnant** is: a **value-position** (`const s = _={
… }=` / `return _={ … }=`) multi-statement foreign block whose trailing statement is a **bare expression**
with no top-level `return` → the emitted IIFE `async (…) => { …; lines.join(",") }` has no `return`, so the
value is **`undefined`, silently**. A scrml developer naturally brings the scrml "last-expression-is-the-value"
idiom (how `?{}` / `fn` trailing-expr value blocks work) to the foreign value block and gets `undefined` with
NO diagnostic. flogence hit this exactly ("bit twice in one file").

## The fork (needs a ruling — it REVISES S216 dpa-003)
S216 (`emit-logic.ts:2834-2837`) **deliberately** chose silent-undefined: *"a body without [a return] yields
`undefined` (honest — they wrote statements, not a value expression)."* The residual-D evidence says that
"honest" default is a real trap. Three options:

- **A — auto-return the trailing bare expression** (support the scrml last-expr-is-value idiom in foreign
  VALUE blocks). `const s = _={ …; lines.join(",") }=` → the IIFE emits `…; return lines.join(",")` → `s` =
  the join. Makes foreign value blocks behave like every other scrml value block (`?{}`, `fn`). Well-defined
  transform (last top-level statement, IF a bare expression-statement, → `return <expr>`); Rust/Ruby
  block-value precedent. **My lean** — it's the Rule-3 right answer (consistency + ergonomics), and it
  eliminates the trap with no diagnostic. Counter: it IS a transform on foreign code (mild "magic"), and it
  reverses the S216 "honest host-semantics" stance.
- **B-diagnosed — keep host-semantics, but ERROR the trap** (`E-FOREIGN-VALUE-NO-RETURN`): a value-position
  multi-statement foreign block with no top-level `return` is a compile error steering to an explicit
  `return`. Fail-closed (v1.0 invariant); honest (no magic); but forces the explicit-return ceremony the
  trailing-expr idiom would avoid.
- **C — keep S216 silent-undefined** (status quo). Rejected by the residual-D evidence (a silent
  wrong-value trap violates Rule 5 / "no silent traps").

**Recommendation: A.** scrml value blocks are last-expr-valued everywhere; a foreign value block is still a
scrml *value* block (the `const s =` asks for a value). Auto-returning the trailing expression is the
consistent, trap-free answer. If bryan prefers host-fidelity over the scrml idiom, B-diagnosed is the
fail-closed compromise. **Either A or B-diagnosed is fine; C (silent) is not.**

## The fix is SMALL either way (the scan flags already exist)
`scanForeignSliceShape` already returns `{ topLevelReturn, topLevelStmtSep }`. In VALUE position (the
`const/let = _={}=` + `return _={}=` paths — statement position already fires E-FOREIGN-004):
- **A:** when `topLevelStmtSep && !topLevelReturn`, find the last top-level statement's span; if it is a bare
  expression-statement (not a `for`/`if`/`while`/declaration/`{}`-block), prefix it with `return `. (Reuse
  the depth/string-aware scan already in `scanForeignSliceShape` to find the last top-level `;`.)
- **B-diagnosed:** when `topLevelStmtSep && !topLevelReturn` in value position → emit `E-FOREIGN-VALUE-NO-RETURN`.

## Value-vs-statement position (already distinguished)
Statement-position bare `_={}=` → E-FOREIGN-004 (existing). The fork applies ONLY to value position
(`const/let <x> = _={}=`, `return _={}=`, an inline value context). Confirm the codegen knows the position
(emit-logic.ts:1787/1906 handle the `const/let x = _={}=` init; :2810 the inline value context).

## SPEC (Rule 4)
§23.2.4 / §23.2.4a (the foreign value-flow rule) is the authority — it currently encodes the S216 Fork-B
"no return → undefined" rule. **A or B-diagnosed amends §23.2.4a** (A: "the trailing bare expression of a
value-position foreign block is its value"; B: "a value-position multi-statement foreign block SHALL end in
an explicit `return`, else E-FOREIGN-VALUE-NO-RETURN"). Author the §23.2.4a amendment + (B) the §34 row in
the same landing. NAME the code if B.

## Gate
- Unit tests: shape (b) → (A) `s` = the value / (B) E-FOREIGN-VALUE-NO-RETURN; (b') explicit-return still
  works; single-expr `_={ expr }=` unchanged; bare-stmt E-FOREIGN-004 unchanged; a nested `return` (inside an
  arrow in the slice) is NOT mistaken for a top-level return (the scan already handles this — regression-guard
  it). Emitted `.js` valid (check as ESM: `node --input-type=module --check` or `.mjs`).
- A merge-blocker conformance case: a value-position multi-stmt foreign block behaves per the ruling (A: runs
  + returns the value; B: fires the code).
- `bun test compiler/tests/{unit,integration,conformance}` zero delta vs env-floor.
- R26: flogence re-ports the trailing-expr shape without the explicit-return workaround (A) — ping them.

## Files (expected)
- `compiler/src/codegen/emit-logic.ts` (`case "foreign"` @ 2809 + the `const/let x = _={}=` inits @ 1787/1906).
- `compiler/src/codegen/emit-library.ts` / `emit-tool.ts` IF they have a divergent foreign-value path (the
  W5b lesson — verify they route through the shared emit-logic lowering, don't re-implement; if they do
  re-implement, that duplication IS a sub-bug to consolidate).
- `compiler/SPEC.md` §23.2.4a (+ §34 row if B).
- `compiler/tests/unit/` + `conformance/`.

## Dispatch (AFTER clean-print lands + a ruling)
Base = post-clean-print main HEAD. iso: worktree. S67 file-delta. S239 adversarial review before landing.
