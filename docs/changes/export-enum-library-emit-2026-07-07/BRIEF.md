# BRIEF — Model-library must EMIT exported enum runtime reps (not erase them) — g-block-analysis-emit-foreign-underscore (MED, S245)

CHANGE-ID: `export-enum-library-emit-2026-07-07`
BASELINE: current main. GAP: `g-block-analysis-emit-foreign-underscore` (MED) — **REDIAGNOSED** (the filed "foreign `_{}`" hypothesis is WRONG; see below).
DISPATCHED-BY: scrml PA (S245). AGENT: scrml-js-codegen-engineer · isolation:worktree · background.

## The bug — reproduced, minimized, gap-rediagnosed
The gap says `flogence/src/models/delta-log.scrml` FAILS `--emit-block-analysis` with `E-CODEGEN-INVALID-LOGIC`,
hypothesizing a "multi-statement foreign `_{}` mis-lower." **That is wrong** — there is NO foreign block in the
file, and the failure is NOT block-analysis-specific (plain `compile` fails identically).

**Minimal repro** (`${ export type Foo:enum = { A, B } }` — a single exported enum in a model/type module):
```
bun compiler/bin/scrml.js compile <repro>   ->   error [E-CODEGEN-INVALID-LOGIC]: ... Unexpected token
   emitted JS: "... from './this-file.js' export"   (a dangling `export`)
```
Controls: `type Foo:enum` WITHOUT `export` → COMPILES (the enum is erased); `export let x = 5` → compiles.
So the trigger is specifically **`export type X:enum`** in a model-library file.

**Root** — `compiler/src/codegen/emit-library.ts` (§21.5 model/type-module emit) strips scrml type-decls with a
TEXT regex (~line 464-465): `/\btype\s+NAME(?::\s*\w+)?\s*=\s*\{[^]*?\}/g`. Two defects:
1. **Dangling `export`** — the regex matches `type X:enum = {...}` but NOT the leading `export `, so
   `export type X:enum = {...}` collapses to a bare `export ` → malformed JS → the loud `E-CODEGEN-INVALID-LOGIC`.
2. **Erases a value-bearing runtime binding** — enums are NOT TS-erasable. A program emits an enum as a runtime
   object: `const X = Object.freeze({ Red: "Red", Green: function(shade){ return {variant:"Green",data:{shade}} }, variants:[...] })`
   (plus `X_toEnum` / `X_variants` helpers), and variant construction (`X.Green(5)`) + `match` REFERENCE it. So an
   `export type X:enum` in a model module MUST emit that runtime rep + `export` it; erasing it means a consumer
   importing `X` (flogence's cockpit imports `Pointer`/`Kind` from `delta-log`) gets `undefined`.

**The trap (Rule 3):** the "easy" fix — also strip `export ` — makes the loud error vanish while SILENTLY erasing
the enum binding. Do NOT do that. That converts a loud failure into a silent consumer-break.

## SPEC authority (this is spec-MANDATED, not a judgment call)
- **§21 Form 2** (SPEC ~L14603-14612): `${ export type UserRole:enum = { Admin, Moderator, User, Banned } }` is the
  **canonical** in-logic export form. The failing shape is spec-valid.
- **SPEC ~L14724-14730:** `export type X:kind = {...}` SHALL produce a `type-decl` + an `export-decl`, and downstream
  codegen SHALL resolve `X` "the same way as a non-exported type" — i.e. an exported enum emits the same runtime
  rep a non-exported/program enum does, then `export`s it.
- **§21.5 (SPEC ~L14740, L14867):** a type/module file (only `${ export ... }`, no markup/CSS) SHALL produce "a JS
  module with the exported bindings as its sole output." An exported enum's binding is its runtime object.

## The fix
`emit-library.ts` must EMIT enum type-decls as their runtime representation instead of stripping them:
1. Locate the program-side enum-emission that produces `const X = Object.freeze({...variant constructors...})`
   (+ any `X_toEnum`/`X_variants` helpers) from an enum `type-decl` node — grep for `Object.freeze` / the enum
   emitter in codegen (likely `emit-logic.ts` or a dedicated type-decl emitter). REUSE it (don't re-implement the
   enum shape).
2. In the emit-library whole-block path: for each **enum** type-decl in `logic.body` (`n.kind==="type-decl" &&
   n.typeKind==="enum"`), emit its runtime rep via that shared emitter; prefix `export ` when the decl is exported
   (the `export-decl` sibling / the `export ` in source marks it). Ensure the emitted rep is a standalone statement
   (own line / trailing `;`) so it never glues to a neighbor.
3. Adjust the text-strip so ENUM decls are removed from the regex-stripped text (they're now emitted as runtime
   reps) while STRUCT and type-ALIAS decls are still erased (those ARE pure types — no runtime binding; TS-erased
   is correct). The `export ` prefix on a stripped struct/alias must ALSO be consumed (no dangling `export`).
4. Non-exported enums that the model's own helpers reference need the rep too (emit them, without `export`). An
   unused non-exported enum may be emitted or erased — but must never leave a dangling `export`/malformed JS.

## ACCEPTANCE (all must hold)
- Minimal repro `${ export type Foo:enum = { A, B } }` COMPILES and emits an exported runtime rep
  (`export const Foo = Object.freeze({...})` or the exact shared-emitter shape); `node --check` the emitted `.js`.
- **R26 (real adopter):** `flogence/src/models/delta-log.scrml` compiles clean BOTH plain AND with
  `--emit-block-analysis`; its `Pointer`/`Kind` enums appear as exported runtime reps in the emitted `.js`.
- A consumer that `import { Pointer } from "./delta-log"` and constructs `Pointer.Sha("x")` resolves at runtime
  (write a 2-file test: model exports an enum, consumer constructs a variant + matches it).
- **Struct/alias erasure preserved:** `export type Config:struct = {...}` and `type A = int` still emit NO runtime
  binding (pure types) and no dangling `export`.
- Regression tests (exported enum · non-exported enum · struct-still-erased · the dangling-export gone · a 2-file
  import+construct round-trip) + a **conformance case** (both codes-half: compiles clean; runtime-half: construct
  works). Full suite `bun run test` → 0 fail (document pre-existing env-floor).

## SCOPE FENCE
Touch ONLY `compiler/src/codegen/emit-library.ts` (+ the shared enum-emit helper you reuse, if it needs a small
export/refactor — minimize edits there) + tests + a conformance case. Do NOT edit `docs/known-gaps.md` (PA marks it
resolved at landing). Do NOT touch the string-blind scanner files / channel-watches / runtime-template.js / other
sessions' surfaces.

## STARTUP + PATH DISCIPLINE (worktree)
`pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90). `git
rev-parse --show-toplevel`==WORKTREE_ROOT; `git status --short` clean; FF to current main; `bun install`; `bun run
pretest`. Apply ALL edits via Bash on worktree-absolute paths (NOT Edit/Write). Never `cd` into main; `git -C
"$WORKTREE_ROOT"`. First commit message includes verbatim `pwd`. Commit incrementally; keep progress.md.

## SPEC — read before coding (Rule 4)
Read SPEC §21 module-export (Form 1/Form 2, ~L14580-14745) + §21.5 (~L14867+) IN FULL before touching codegen —
confirm the exported-enum-binding requirement + the struct/alias-erasure distinction. Also skim the enum
type-decl runtime-rep section (grep `Object.freeze` in emitted output / the enum emitter).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (Task-Shape Routing for a compiler-source codegen fix). Report the Maps line.

## REPORT
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` · which shared enum-emitter you reused + where · the R26 evidence
(delta-log.scrml compiles + Pointer/Kind exported reps present) · the 2-file import+construct round-trip evidence ·
struct/alias-erasure-preserved evidence · the conformance case · the Maps line.
