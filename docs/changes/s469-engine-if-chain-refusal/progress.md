# s469-engine-if-chain-refusal — progress

Gap: `g-engine-in-if-else-chain-branch-renders-nothing-s469` (HIGH). Branch off `b447b29eb`. Limb: impl#1, refuse (not render).

## Measured (happy-dom, base b447b29eb)

Engine renders nothing at exit 0 in: if= branch, else branch, else-if= branch (with and without a terminal else),
deep in a branch, chain at file top level, chain nested in markup, chain in `<program>`, chain nested in a chain
branch, lone if= inside a chain branch, chain in a component body (used, and unused). A lone if= renders.
Already refused: chain inside an engine state-child / match arm (E-IF-IN-DISPATCHED-ARM), engine in an `<each>`
row / `<empty>` under a chain (E-COMPONENT-ENGINE-SCOPE / E-CG-003).
`<match>` in any chain branch: RENDERS (executed) — not refused.
Root cause: `collectHoisted` (ast-builder.js) walks only `markup.children`, so an engine-decl under
`if-chain.branches[].element` / `elseBranch` never reaches `machineDecls` (no substrate, no dispatcher).

## Done

- [x] codegen refusal: emit-html.ts `refuseEnginesUnderIfChain` (E-CG-003), helpers in engine-in-each-row.ts.
- [x] CE collectBodyEngines reaches an engine-decl under a chain / in a row (E-COMPONENT-ENGINE-SCOPE, also unused defs).
- [x] browser test engine-in-if-chain-refused-s469 (24).
