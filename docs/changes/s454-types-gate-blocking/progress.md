# progress — s454-types-gate-blocking (append-only)

- base 48cf11046 == origin/main; bun install + pretest OK.
- `--check` on base: exit 1; 30 NEW + 1 GROWN, 9 GONE (most GONE are re-keys of the same diagnostic — the key embeds tsc's truncated type shape, so widening an opts type re-keys every diagnostic that prints it).

## PART 1 — fix (commit 200dbabf + FACTS regen)

NEW/GROWN found on base 48cf11046 (30 NEW + 1 GROWN, 9 GONE): matches the brief's list, plus
bool-coerce/collect/emit-library/reactive-deps/sqlite-file-target/protect-analyzer/route-inference/
symbol-table TS7016 sites (schema-differ.js, ast-if-chain.js, runtime-template.js, host-import.js).

Fixed (type-only):
- 8 `.d.ts` (ast-if-chain, markup-return-scan, runtime-template, attribute-registry, host-import,
  codegen/emit-lift full surface; ast-builder, schema-differ PARTIAL — the TS-imported surface).
  `export declare` form: cli-listen-host.test.js transpiles every compiler/src/*.ts with
  Bun.Transpiler and a bodiless `export function f(): T;` is a parse error there (first commit attempt
  failed the hook on exactly that).
- emit-control-flow while/do-while opts (+mapVarNames/setVarNames/orderedMapVarNames); line ~845
  boundary:"client" (DocumentFragment factory; emitLogicNode's _ensureBoundary defaulted it).
- emit-reactive-wiring groupEmitOpts boundary:"client" (same default; the 1 -> 3 growth).
- emit-event-wiring local LogicBinding: full kind union + liftMountFn ("lift-host" is LIVE —
  emit-html.ts:4087 registers it; the local mirror was stale, not dead code).
- tenant-egress: `match(/g)` null-guard; route-inference: `fnNode.isGenerator`; symbol-table:
  `span: Span`; protect-analyzer: `SchemaTableDecl[]` (cast made visible by the new .d.ts).

Left in the baseline, re-recorded:
- emit-control-flow TS2345 x2 (if-body emitLogicBody; `boundary` is `"server"|"client"|undefined` vs required): a RE-KEY of a
  recorded entry (S415 added declaredNames to the arg, changing tsc's printed shape). IfOpts.boundary
  is optional; writing `?? "client"` would be behaviour-identical today but would SILENCE
  `_ensureBoundary`'s SCRML_STRICT_BOUNDARY throw — hiding the real "boundary not threaded" signal.
- type-system TS2678 `"machine"`: RE-KEY (union print order). `case "machine"` in isWireSerializable
  is unreachable by type (MachineType is not in ResolvedType; machines live in a separate
  Map<string, MachineType>). Removal = behaviour change unless runtime-proven unreachable; left.
- codegen/index TS2345 'object' -> Record 13 -> 14: NOT new code. tsc on the tree AT the commit that
  last wrote the baseline (19eecc06d) already reports 14 (measured via git archive + tsc). Baseline drift.

Baseline 229 -> 190 diagnostics (143 -> 119 distinct); never-fallthroughs 9 (unchanged).

Differential (base capture @8a6688ce2 == 48cf11046 compiler, head @200dbabf): exit 0,
VERDICT NO DIFFERENCES — 2342 sources, 11438/11438 artifacts byte-identical, 0 compile-failure
delta, 0 diagnostic changes (code or text), syntax delta 0/0/0, bare server-fn sites 203/203.

FACTS: the .d.ts files move "live compiler source" 227 -> 235 files; `facts.ts --check` is a
BLOCKING gate step, so FACTS.md regenerated in its own commit.

## PART 2 — promote

- ci.yml: Types gate step moved to `gate` (step index 3, right after Install deps, no
  continue-on-error); removed from `tracking`; header + tracking comments rewritten.
- `windows` job runs no types step — nothing to move.
- YAML parse: Bun.YAML.parse OK (gate 18 steps, types step [3] continue-on-error=false; tracking 8;
  windows 5) and `node_modules/.bin/js-yaml .github/workflows/ci.yml` OK.
- Bite proof (local): appended `const _s454Bite: number = "not a number";` to tenant-egress.ts ->
  `bun scripts/types-gate.ts --check` BITE_EXIT=1 (`+ 1x tenant-egress.ts :: TS2322`); reverted ->
  REVERT_EXIT=0 ("OK — 190 diagnostics (119 distinct), unchanged").
- Other blocking steps run locally post-fix: lint-no-default-arm 0, conflict-marker 0,
  regen-spec-index --check 0, delta-lint 0, s34-census --check-new 0, e2e-render-map 0, facts 0.
