# sPA ss72 — conformance authoring: import / module resolution §21 (freeze-gate, WAVE B pillar-contract)

**Launch:** `read spa.md ss72` · **Branch:** `spa/ss72` · **Worktree:** `../scrml-spa-ss72`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). The **module-resolution contract**
(§21 — import/export/use, pinning, scope) is a pillar guarantee: what resolves, what is circular, what a
bare/pinned specifier means. The S256 audit puts **~14 import/module codes** in tier-1; they are
uncovered. NEW S256 · **fireable now** (pure conformance-corpus data — disjoint). Enumerates the CODES;
the fired sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS". Author from
impl#1 → SANITY-CHECK vs SPEC §21 → ESCALATE divergences; verify GREEN on `bun conformance/run.ts`;
schema in `conformance/README.md`. Grep each code live in `compiler/src` (`module-resolver.js` +
`gauntlet-phase1-checks.js` + `ast-builder.js` + `symbol-table.ts`) for the exact trigger. Harness-clean
(compile-time; the `files` multi-file convention — see `conformance/README.md` §"files" — lets a case
ship sibling `*.scrml` import fixtures).

## Core files
`conformance/README.md` (esp. the `files` multi-file convention) · `spa-lists/ss56-conformance-engine-51.md`
(method §) · `conformance/cases/` (any multi-file case using the `files` convention to mirror) ·
`compiler/src/module-resolver.js` + `gauntlet-phase1-checks.js` + `ast-builder.js` ·
`compiler/SPEC.md` §21 (normative — read the named subsection per code)

## Items (one code per item; reject-path pos + clean neg)
1. **E-IMPORT-001** (codes) `[status=pending]` — an import-form error ("Wrap the declaration: …", `gauntlet-phase1-checks.js:232`). Grep exact trigger; pos + neg.
2. **E-IMPORT-002** (codes) `[status=pending]` — a circular import detected (`module-resolver.js:391`). Pos (a 2-file `files`-convention cycle → E-IMPORT-002) + neg (acyclic graph → silent).
3. **E-IMPORT-003** (codes) `[status=pending]` — imports must live at the top of a file (`gauntlet-phase1-checks.js:378`). Pos (a non-top import → E-IMPORT-003) + neg.
4. **E-IMPORT-004** (codes) `[status=pending]` — a name not found in the target's exports (`module-resolver.js`). Pos (import of an undeclared export → E-IMPORT-004) + neg.
5. **E-IMPORT-005** (codes) `[status=pending]` — a bare specifier (npm without `vendor:`) (`module-resolver.js`). Pos + neg (a `./` relative or `vendor:` specifier → silent).
6. **E-IMPORT-006** (codes) `[status=pending]` — the target file does not exist (`module-resolver.js:221`). Pos (import of a missing sibling → E-IMPORT-006) + neg (sibling present via `files` → silent). (`E-IMPORT-007` is tier-2 — excluded.)
7. **E-IMPORT-PINNED-INVALID** (codes) `[status=pending]` — an invalid `pinned` import (`symbol-table.ts:1133`). Pos + neg (a valid pin → silent).
8. **E-EXPORT-001** (codes) `[status=pending]` — an export error (`module-resolver.js:303`). Grep exact trigger; pos + neg.
9. **E-EXPORT-002** (codes) `[status=pending]` — a component-export constraint (`ast-builder.js:1286`, "Component ..."). Pos + neg.
10. **E-EXPORT-003** (codes) `[status=pending]` — a component-export constraint sibling (`ast-builder.js:1315`). Pos + neg.
11. **E-SCOPE-010** (codes) `[status=pending]` — two file-scope declarations colliding ("Two file-scope …", `gauntlet-phase1-checks.js:449`). Pos + neg. (§21 scope; from the scope/state soundness family.)
12. **E-USE-001** (codes) `[status=pending]` — a `use` directive error (`gauntlet-phase1-checks.js:346`). Grep exact trigger; pos + neg.
13. **E-USE-002** (codes) `[status=pending]` — a `use` must be at the top of the file ("Move this line to the top …", `gauntlet-phase1-checks.js:253`). Pos + neg.
14. **E-USE-005** (codes) `[status=pending]` — a `use` specifier form error ("Change the specifier to …", `gauntlet-phase1-checks.js:266`). Pos + neg.

**Definition of done:** all 14 import/module codes pinned (codes-half; reject pos + clean neg per code;
circular/missing-file cases use the `files` convention); run.ts green; divergences ESCALATED. The
module-resolution contract moves to conformance-covered.

## Progress
`spa-lists/ss72.progress.md`. Land per-item on `spa/ss72`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
