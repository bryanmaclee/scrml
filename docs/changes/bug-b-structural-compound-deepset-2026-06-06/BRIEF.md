# BRIEF — Fix Bug B (HIGH): structural-compound deep-set codegen mistarget
# Dispatched S170 (2026-06-06) · scrml-js-codegen-engineer · isolation:worktree · agent a5b98933a2d8305d3
# Base HEAD at dispatch: 63106225

Change-id: `bug-b-structural-compound-deepset-2026-06-06`

A dotted-path deep-set `@a.ref = value` where `a` is a structural-compound cell (`<a> <ref>="" </>`)
writes the derived composite `a` instead of the leaf `a.ref`. The composite is a `_scrml_derived_declare`
that recomputes from the unchanged leaf, so the write is silently clobbered — lost mutation, no diagnostic,
default pipeline. HIGH. Fails even for a SINGLE deep-set (distinct from the already-fixed Bug A parser bug).

## Confirmed reproducer (PA-verified on HEAD 63106225)
```scrml
<a>
    <ref> = ""
</>
<c> = 0
function multi() {
    @c = 1
    @a.ref = "p"
    @c = 2
    @a.ref = "q"
}
<button onclick=multi()>go</button>
<p>${@c} ${@a.ref}</p>
```
Current WRONG emit: `_scrml_reactive_set("a", _scrml_deep_set(_scrml_reactive_get("a"), ["ref"], "p"))`
while `_scrml_derived_declare("a", () => ({ ref: _scrml_reactive_get("a.ref") }))`. Write to composite `a`
is recomputed away from unchanged leaf `a.ref` → LOST.
Expected: `_scrml_reactive_set("a.ref", "p")` (write the backing leaf).

## Fix locus
`compiler/src/codegen/emit-logic.ts:3014` — `case "reactive-nested-assign":`; line 3037 emits
`_scrml_reactive_set(${target}, _scrml_deep_set(_scrml_reactive_get(${target}), ${path}, ${value}))`
with target = bare cell name, never consulting whether the cell is a structural-compound derived composite.
Compound-parents are identified elsewhere via `_cellKind === "compound-parent"` (emit-logic.ts:761-795,
1724-1801) — that signal isn't reached at the reactive-nested-assign site.

Two candidate fix shapes (agent authorized to survey + pick):
- (A) codegen retarget at emit-logic.ts:3014 — resolve target's kind + retarget the write to the deepest
  static backing leaf cell; deep-set any remainder.
- (B) upstream resolver annotation marks the node's true write target + residual path; emit-logic reads it.
  Likely the cleaner Rule-3 fix (resolver already owns the compound→leaf mapping).

## Hard constraints
1. Flat-object case `<a> = {ref:""}` (PLAIN cell, NOT compound-parent) must STAY cell-targeted — no regression.
2. Nested compound `@a.b.ref` → leaf `a.b.ref`.
3. Computed-index segments → retarget to deepest static prefix leaf; deep-set computed remainder; don't crash.
4. SPEC §6.3 / PRIMER §5: a field write updates the field's backing storage (no spec ambiguity — pure codegen).

## Process: full F4/S88/S99-S126 path discipline (Bash-edit, no cd-into-main, pwd-in-first-commit),
S112 merge-main startup, bun install + bun run pretest, S83 two-sided commit discipline (code+test one commit),
NUL-byte check new test files (S169), and MANDATORY S138 Phase-3 R26 empirical verification (compile the repro,
confirm `_scrml_reactive_set("a.ref",...)`, node --check exit 0, flat-object + nested-compound contrast cases).
DO NOT mark DONE without R26 passing.

(Full dispatch prompt as sent is the authoritative version; this archive captures it per pa.md S136.)
