# library-mode structural routing — progress (append-only)

change-id: `library-mode-structural-routing-2026-09-06`
worktree: `.claude/worktrees/agent-a451e4f6606fbf34e`, base `origin/main` @ `499eecce`

## 1. Startup verification
- `pwd` inside the worktree; `rev-parse --show-toplevel` == worktree root; `git status` clean.
- `merge-base HEAD origin/main` == `origin/main` == `499eecce`.
- `bun install` (218 pkgs), `bun run pretest` run plainly from worktree CWD (13 samples compiled).

## 2. §1 symptom table — RE-MEASURED, and the brief's DIAGNOSTIC column is wrong
Probe: `compileScrml({ inputFiles:[f], mode:"library", write:false })`, all three
diagnostic fields collected (`errors` + `warnings` + `lintDiagnostics`).

| shape | brief says | measured at 499eecce |
|---|---|---|
| local annotation `let acc: int` | broken w/ E-CODEGEN-INVALID-LOGIC | broken — but **ZERO diagnostics**; `: int` shipped verbatim |
| payload variant `return .Ok(n)` | broken w/ E-CODEGEN-INVALID-LOGIC | broken — but **ZERO diagnostics**; `.Ok(n)` shipped verbatim |

The E-CODEGEN-INVALID-LOGIC emit gate (`api.js:2946`) is `validateEmit`-flagged
(default OFF) **and** requires `write && outputDir`, so the ordinary compile path
emits the invalid JS at exit 0. The defect is SILENT-WRONG, not loud.

## 3. §3 root — HELD
`emit-library.ts:669` `if (!fnBodyContainsMatch(node)) continue;` is the gate.
Same body + a dummy typed `match` compiles clean and emits `let acc = n * 2;` /
`return { variant: "Ok", data: { n: n } };`. Lowering present, routing absent.

## 4. Fix — routing polarity inverted
`emitControlFlowLibraryFns` now routes **by default**; `rawFallbackReason` names
the one standing exclusion (`ifExpr` decls — g-if-expression-value-binding-lowers-null).

Two guards the widening forced, both found by MEASUREMENT not by inspection:

- **`verifiedFnRemovalRange`** — `function-decl` spans are not reliable. On
  `compiler/native-parser/ast-expr.scrml` every top-level `export fn` reports a
  span starting ~22 chars INSIDE its own param list and ending inside the NEXT
  statement's comment. Splicing those offsets emitted
  `export function makeIdent(name, spait — numeric literal.`. The guard verifies
  head/tail/brace-balance and falls back to raw when the span cannot be shown to
  cover the fn's own text.
- **`LIB_RUNTIME_HELPERS` + `unmetRuntimeHelperRefs`** — the structural lowering
  emits `_scrml_structural_eq(…)` (SPEC §45) and, for a `@cell`,
  `_scrml_reactive_get/set(…)`. A library `.js` has no client runtime, so those
  were undefined free identifiers in **28** corpus modules: output that PARSES
  and throws on first call. `_scrml_structural_eq` / `_scrml_log` /
  `_scrml_print` are now inlined on use (same table shape emit-tool.ts uses);
  anything else un-satisfiable makes the fn fall back to raw, where it fails
  loudly instead.

## 5. Numbers (see the final report for the full table)
- population (compiler's own classifier, per-file compile, libraryJs emitted): **118**
- byte-identical 47 / changed 71 / newly-emitting 0 / lost-emit 0 / ~~newly-failing 0~~
  ⚑ **CORRECTED S410 — "newly-failing 0" IS WRONG AS WRITTEN.** The S239 pass on #893 found
  **three regressions** the differential could not see, all confirmed on the same checkout with
  only `emit-library.ts` swapped: a foreign-bearing fn had its body NULLED (HIGH, silent-wrong);
  a layout-coupled assertion; and a `!{}` guarded expr became legal JS that is always `false`
  (HIGH). The differential scored them clean because **the 118-file population contains no `_{}`
  and no `!{}` in a library fn** — *a zero over a path the population never exercises is not
  coverage.* All three were fixed before landing. Post-fix re-measurement:
  **118 · 47 byte-identical · 53 changed-and-valid · 0 newly-invalid · 18 still-invalid**
  (16 failing identically, 2 failing merely later).
  The same correction landed in `docs/known-gaps.md` at #893; this archived progress doc was
  missed and still carried the original figure.
- acorn parse status: base 46 BAD → fix 46 BAD, **0 newly-broken, 0 newly-parsing**
- undefined `_scrml_*` helper refs: base 0 → fix 0 (was 28 before the helper table)
