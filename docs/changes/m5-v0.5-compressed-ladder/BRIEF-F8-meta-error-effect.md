# Dispatch — v0.6 / F8: meta + error-effect payloads (native parser)

**Authority:** DD #27 `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md`
(F8 / Cluster D); SCOPE `docs/changes/m5-v0.5-compressed-ladder/SCOPE-v0.6.md`.
**Estimate:** 5-8h. **Task shape:** native-parser feature addition (BRIDGE-LIGHT).

## Goal

Make the scrml-native parser produce structured payloads for the last two code-bearing
markup contexts still sketch-depth after F7: **`^{}` meta blocks** and **`<errors>`
error-effect arms** — so the native AST matches the live FileAST surface the downstream
compiler consumes.

## Why this is BRIDGE-LIGHT (DD #27 / Approach C composition)

Unlike F7's state/SQL/CSS (which needed genuinely new sub-grammars), F8 needs **no new
parser**. Under S114 Approach C, a `^{}` meta block's body is scrml-native statements —
the native parser's M3 statement parser already parses those. F8 routes the meta-block
body and the error-effect arm bodies through the **existing** native parsers and stamps
the payload shape downstream expects. The residual is a **kind-naming reconciliation**:
the native parser's block/node kinds are PascalCase (`Meta`) where the live pipeline
uses lowercase (`meta`).

## Phase 0 — survey (MANDATORY before any edit)

1. **Native current state.** Confirm the native `Meta` block and the `<errors>` /
   error-effect handling are sketch-depth (F7's report noted "Meta is sketch-depth — no
   parsed body"). Find where the native parser emits the `Meta` block + how it would
   route a body to the existing M3 statement parser.
2. **Target shape.** Read the live payloads — the meta-block node + `ErrorArm` typed
   kind-union — in `compiler/src/types/ast.ts` + how `ast-builder.js` builds them.
3. **Kind-naming reconciliation.** Map every downstream consumer of `node.kind === "meta"`
   — `meta-checker.ts` (~9 sites), `dependency-graph.ts`, `component-expander.ts`,
   `codegen/{emit-client,collect,emit-library,emit-html}.ts` (~17 sites total per DD #27)
   — and the `ErrorArm` consumers. Decide: downstream **dual-mode tolerance** (accept
   both `"meta"` and `"Meta"`, the F2 precedent) is the default approach unless Phase 0
   shows aligning the native emitter is cleaner.

Report the live→native mapping + the reconciliation approach in your final report.

## Implementation

1. Route the native `Meta` block body through the existing native M3 statement parser
   so the meta payload is a native `Stmt[]` body matching the live shape.
2. Route `<errors>` / error-effect arm bodies through the existing native parsers;
   produce arm nodes matching the live `ErrorArm` kind-union.
3. Reconcile kind-naming — downstream dual-mode (`kind === "meta" || kind === "Meta"`)
   per Phase 0, mirroring F2's dual-mode codegen kind-tests so BOTH pipelines work.
4. Author BOTH `.scrml` canonical + `.js` shadow per native-parser file. **The `.scrml`
   canonical file must be CORRECT** — F1 and F7 both shipped malformed `.scrml`
   predicates (`is not` mis-used as a presence guard; `is not not`). `is some` = present,
   `is not` = absent (SPEC §42 / PRIMER §9.4). Audit every predicate you write.

## Constraints

- No live-pipeline wiring — native-parser code the M5 swap activates. Verify via the
  native-parser conformance harness with parity assertions vs the live pipeline.
- Do NOT touch `compiler/src/` except read-only — UNLESS the chosen reconciliation
  approach is downstream dual-mode, in which case the downstream consumer edits ARE in
  scope (that is the F2-precedent path). State which path you took.
- Do NOT touch `emit-server.ts` / `emit-functions.ts` / `route-inference.ts` /
  `monotonicity-analyzer.ts` / `cps-batch-planner.ts` — Ext 1 (M1.5) owns those.
- Coupled code + test = one logical unit. NEVER `--no-verify`.

## Deliverable / report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · live→native payload + kind-naming mapping ·
the reconciliation approach taken (dual-mode vs emitter-align) · conformance count +
result · test delta · maps-consulted line.
