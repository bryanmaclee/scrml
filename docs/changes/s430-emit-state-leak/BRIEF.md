# BRIEF — s430-emit-state-leak (P7 criterion 1: bootstrap-blocking — the P5 hybrid differential must be deterministic)
Read `docs/changes/s430-common/F4.md` FIRST and obey it.

## Defect (agent-reported by s430-stage-swap; REPRODUCE FIRST)
`compiler/src/codegen/emit-logic.ts` module-level `_structuralDeclNamesForFile` (PA-LOCATED-VERIFY) is reset only by
emit-reactive-wiring, but function-body emission reads it first, so each file sees the PREVIOUS file's set. Repro: compile
`conformance/cases/error/handler-recovery-into-cell/case.scrml` twice in ONE process (compileScrml API) — first compile emits
`_scrml_cs_init_set("result", () => _scrml_risky_3())` inside `go()`, second does not. Gap:
`g-emit-logic-structural-decl-names-leak-across-compiles`.

## Do
1. Reproduce. Then determine which output is CORRECT per SPEC §6.8 (reset/default semantics; quote the governing sentence) —
   the reporter suspects the fresh-process output (a reset thunk registered from inside a function) is the WRONG one. If the
   correct behaviour is unclear from SPEC, STOP and report.
2. Fix the ROOT: make the per-file state compile-scoped (initialise before any reader, or thread it through the emit context)
   so output is a pure function of the input regardless of prior compiles. Then AUDIT for the same class: every module-level
   mutable `let`/`Map`/`Set`/array in `compiler/src/codegen/**` and the passes `api.js` runs, that persists across
   `compileScrml` calls. Report the full list with each one's reset point; fix every one that can leak between compiles
   (or prove it cannot). `setBPPOverrides` in `codegen/compat/parser-workarounds.js` is a known module-global never reset — include.
3. Test: compile a fixed sequence of files in one process in two different orders; every file's artifacts must be
   byte-identical to compiling it alone in a fresh process. Make it a gated test over a representative sample.
4. Corpus A/B: artifacts for the whole corpus compiled in ONE process vs each file fresh — report differences before and after.
