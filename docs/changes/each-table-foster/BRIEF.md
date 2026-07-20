# BRIEF — `<each>`→`<tr>` under `<tbody>` foster-parents (table each renders empty)

- **Gap:** `g-each-mount-div-foster-parented-in-table` (HIGH, open) — docs/known-gaps.md
- **Filed:** S272 (peter, adopter lane). Source: assetManagement PA report `handOffs/incoming/read/from-aM-pa-2026-07-19-each-tr-in-tbody-renders-empty.md`.
- **Confirmed on:** current main (this branch's base) + pin `9c950dfe`. NOT a stale-pin artifact.
- **DONE-PROBE:** grep `emit-each.ts` — the each mount is table-context-aware (no unconditional `<div data-scrml-each-mount>` for a table-section parent) OR the mount is an anchor-node model. While the mount is still an unconditional `<div>`, this thread is OPEN.

## Root cause (single locus)

`emitEachMountHtml` (`compiler/src/codegen/emit-each.ts:362`) emits a static
`<div data-scrml-each-mount="each_<id>"></div>` at the each's source position,
**unconditionally** — zero table-context awareness. Inside `<table>/<thead>/
<tbody>/<tfoot>/<tr>` the HTML parser FOSTER-PARENTS that `<div>` out of the
table (relocates it to just before `<table>`), taking every `<tr>` the runtime
appends into it. `<tbody>` renders empty, `<empty>` absent, 0 rows — silently.

Reactivity/keying/reconciler are all correct — only the mount's **parsed DOM
position** is wrong. `<div>`-based each works because `<div>`-in-`<div>` never
fosters (the shipped aM workaround; Portal proves it in production).

Foster-parenting is PARSE-TIME only → affects only the STATIC top-level mount.
A nested each (inside another each's per-item template) builds its mount via
`createElement`+`appendChild` at runtime → immune.

## Interim (LANDED S272)

`W-EACH-TABLE-FOSTER` info-lint — `compiler/src/lint-w-each-table-foster.js`,
wired at `api.js` Stage 6.4f. Fires on a top-level static each under a
table-section element; does NOT descend into each `templateChildren` (nested
runtime mounts are immune → no false positive). Turns the silent failure loud +
points at the `<div>`-layout workaround. Tests:
`compiler/tests/unit/each-table-foster-warn-s272.test.js` (9/9).

## Fix fork (DEFERRED to the aM go-live comprehensive scan)

| | A — anchor-node model (right) | B — table-context mount (surgical) |
|---|---|---|
| What | Comment/text ANCHOR (foster-safe in tables) + insert rows as SIBLINGS; reconciler becomes anchor-based | Detect table-section parent → reconcile directly into the parent `<tbody>` / a `<tr>`-shaped anchor |
| Also fixes | The latent wrapper-`<div>` layout-parent pollution (flex/grid/`<ul>`/`<select>` parents) | Tables only |
| Cost | Shared each-runtime reconciler → R1/R2; full adversarial + regression sweep | Localized to emit-each.ts; lower blast radius |

**Lean:** A is the Rule-3 "right" fix (every production framework uses anchor +
sibling insertion precisely to dodge table foster-parenting + layout pollution).
Non-urgent (aM worked around). Shared-runtime change → run the A/B fork past the
ladder (Peter) before building; not to be ground out unprompted.

## Acceptance criteria (for the eventual fix)

1. A top-level `<each>`→`<tr>` under `<tbody>` renders its rows INSIDE the real
   `<tbody>` — value-asserting browser test: `tbody tr` count == item count
   after a post-mount `@rows` assignment (EXECUTE, don't grep — real-browser
   foster-parenting; happy-dom fidelity is suspect, prefer a CDP/real-Chrome
   check or a parser that models foster-parenting).
2. `<empty>` fallback renders inside `<tbody>` when the list is empty.
3. The `<div>`-layout path stays byte-identical (no regression).
4. `W-EACH-TABLE-FOSTER` is removed (or downgraded) once the mount is table-safe.

## Repro

`docs/changes/each-table-foster/repro-each-tr-tbody.scrml` (fires the warning;
emits `<div data-scrml-each-mount>` inside `<tbody>` — inspect the `.html`).
Control: `<each>`→`<div>` renders fine (Portal pattern).
