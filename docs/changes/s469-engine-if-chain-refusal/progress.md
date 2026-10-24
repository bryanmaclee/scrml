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
- [x] promote --engine test (g-if-chain-iteration-lints-and-promote-blind SITE 5): the if/else site is found, the
      rewrite now fails closed on E-CG-003 (it produced a blank engine before). Commit `93f52b638`.
- [x] SPEC §17.1.1 (Interaction with `<engine>` + impl#1 divergence note, provenance emit-html.ts:964), §17.7.4 ⚑
      note, §51.0.D note; SPEC-INDEX regen; s34-census --check-new PASS (no §34 row change). Commit `fde055852`.
- [x] Bootstrap probe (read-only): `single` + `<*phase/>` in if= / else-if= / else branches RENDERS (happy-dom);
      `<engine>` element refused E-BOOTSTRAP-UNSUPPORTED; a declaration inside markup refused (slice M2).
- [x] known-gaps: main gap resolved-by-refusal; g-component-body-each-row-engine-unused-compiles-clean-s469 resolved;
      span gap + empty-fallback gap notes; S302 structural-chain gap re-measured (`<engine else>` FAILS OPEN —
      flagged); state.ts --write.
