# Dispatch A — U1 / F2: retire `estreeType`, rename to `nativeKind`

**Authority:** DD #27 `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md`
(F2, Pivot 1 ratified S115); SCOPE `docs/changes/m5-v0.5-compressed-ladder/SCOPE.md`.
**Estimate:** 6-12h. **Task shape:** compiler-source refactor (rename + dual-mode).

## Goal

Retire the `EscapeHatchExpr.estreeType` field — a legacy-Acorn artifact — by renaming it
to `nativeKind` (string; **all values unchanged**). The field is a live escape-hatch
sub-kind discriminator; this is a rename, not a behavior change.

## Why (DD #27)

The M5 agent's MD.2 baseline budgeted a 25-35h native↔ESTree translation layer. DD #27
found that unnecessary — downstream codegen already walks the native ExprNode catalog
(`types/ast.ts`), not raw ESTree. `estreeType` survives only as an escape-hatch
decoration. Retiring it (rename) clears the legacy name without the translation layer.

## Phase 0 — verify the surface (MANDATORY before any edit)

PA's S115 grep found `estreeType` across **10 files** (the DD undercounted at 3). Confirm
the current surface against HEAD. Expected sites (verify each — line numbers may have
drifted):

- `compiler/src/types/ast.ts` — the field declaration on `EscapeHatchExpr` (~line 1858)
- `compiler/src/validator-arg-parser.ts` — `makeEscapeHatch` constructor (~192,196)
- `compiler/src/expression-parser.ts` — writes (`node.type` passthrough ~1835;
  `"SqlPlaceholderError"`/`"ParseError"`/`"ConversionError"`/`"TemplateInterpFallback"`)
  + reads (`"TemplateInterpFallback"` ~2666, `"TemplateLiteral"` ~2745)
- `compiler/src/component-expander.ts` — write (~857) + read (`"TemplateLiteral"` ~915)
- `compiler/src/ast-builder.js` — writes (`"SkippedExpr"`/`"ParseError"` ~173,205,2300,
  2330) + reads (`"SqlPlaceholderError"` ~179,2306)
- `compiler/src/symbol-table.ts` — reads (`"Literal"` ~3048,3067,3910;
  `"ArrayExpression"` ~3091; `"ParseError"` ~3094)
- `compiler/src/codegen/emit-table-for.ts` — writes (`"SkippedExpr"` ~268,342)
- `compiler/src/codegen/emit-expr.ts` — reads (`"ArrowFunctionExpression"` /
  `"FunctionExpression"` ~1154-1155)
- `compiler/src/codegen/emit-logic.ts` — read (`"SequenceExpression"` ~1817)
- `compiler/src/gauntlet-phase3-eq-checks.js` — field-name string reference (~312)

Also grep `compiler/tests/` for `estreeType` — test files referencing the field need the
rename too (the test update is part of THIS dispatch — coupled code+test = one logical
unit).

If the surface differs materially from the above, proceed with what the grep shows and
note the delta in your report.

## Part (a) — field rename (mechanical, pipeline-agnostic)

Rename `EscapeHatchExpr.estreeType` → `nativeKind` everywhere. Field type `string`;
**every value string is preserved verbatim** (`"Literal"`, `"ParseError"`,
`"ArrayExpression"`, `"TemplateLiteral"`, `"SkippedExpr"`, `"SqlPlaceholderError"`,
`"ConversionError"`, `"TemplateInterpFallback"`, `"ArrowFunctionExpression"`,
`"FunctionExpression"`, `"SequenceExpression"`, and any others Phase 0 finds). This is a
pure identifier rename across producers, readers, the type declaration, and tests.

`gauntlet-phase3-eq-checks.js:312` references the field name as a string in a
known-fields list — update that string too.

## Part (b) — dual-mode codegen kind-tests (pipeline-coupled)

Three codegen READ sites currently test `estreeType` values that the native parser will
eventually produce as first-class ExprNode kinds. The live (Acorn) pipeline produces
escape-hatch nodes; the native parser (v0.6) produces native kinds. Write these
**dual-mode** so both pipelines work:

- `emit-expr.ts` ~1154-1155: `node.estreeType === "ArrowFunctionExpression" || node.estreeType === "FunctionExpression"`
  → `node.kind === "Arrow" || node.kind === "Function" || node.nativeKind === "ArrowFunctionExpression" || node.nativeKind === "FunctionExpression"`
- `emit-logic.ts` ~1817: `...estreeType === "SequenceExpression"`
  → `... .kind === "Sequence" || ... .nativeKind === "SequenceExpression"`

Verify the exact native ExprKind names against `compiler/native-parser/ast-expr.js` (the
37-variant catalog) — use the catalog's actual casing/spelling for the `kind` arm. If the
native catalog uses different names (e.g. `arrow` lowercase), match the catalog.

The escape-hatch sub-kind reads in `symbol-table.ts` / `expression-parser.ts` /
`component-expander.ts` / `ast-builder.js` are **NOT** dual-mode rewrites — they are
escape-hatch-internal discriminations; the part-(a) field rename alone covers them.

## Constraints

- Behavior must be unchanged. This is a rename + a dual-mode widening. Zero test
  regressions (full pre-commit subset green; report full-suite delta).
- Do NOT touch `compiler/native-parser/` — that is Dispatch C's territory.
- Do NOT introduce a native↔ESTree translation layer. The DD explicitly rejected it.
- `EscapeHatchExpr` itself is KEPT (per DD OQ-5) — only the field is renamed.

## Deliverable / report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the verified Phase-0 surface (file/site
count) · test delta (pre-commit subset + full suite) · any surface delta vs this brief ·
maps-consulted line per the maps block.
