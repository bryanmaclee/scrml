# GITI-036 — `_scrml_structural_eq` client runtime-chunk tree-shake drop

Archived verbatim at dispatch time (S-current, 2026-07-15). Compiler-source fix
for a CONFIRMED P1 runtime bug (Bug-51 class: compiles exit-0, silent until
runtime).

---

## THE BUG (CONFIRMED on 211dc076 — verified by the PA)

A `==` inside a CLIENT-side markup interpolation (e.g. a
`${ d.scope == "empty" ? <p/> : "" }` in a `<match>` arm body) lowers to a call
to the runtime helper `_scrml_structural_eq(...)` emitted into `*.client.js` —
but the helper is NOT seeded into the CLIENT runtime bundle's tree-shake
inclusion set, so it gets dropped → at runtime the client throws
`ReferenceError: _scrml_structural_eq is not defined` on every reactive
re-dispatch of that arm.

VERIFIED REPRODUCER:
`bun compiler/bin/scrml.js compile ../giti/ui/status.scrml -o /tmp/g036`
→ `/tmp/g036/status.client.js` calls `_scrml_structural_eq` 2×; its runtime
bundle `scrml-runtime.*.js` has 0 `function _scrml_structural_eq` defs.

## ROOT CAUSE

Helper defined in `compiler/src/runtime-template.js` (`function
_scrml_structural_eq`), gated into the `equality` runtime chunk
(`compiler/src/codegen/runtime-chunks.ts`). The SERVER emit already seeds it
correctly (`emit-server.ts:921` and `:3826` — `emitted.includes(
"_scrml_structural_eq(")`). The CLIENT runtime-bundle inclusion path did NOT do
the equivalent scan.

## FIX DIRECTION

On the CLIENT runtime-bundle inclusion path, seed the runtime helper(s) the
emitted client code actually references — mirror the server's post-emit
`emitted.includes("_scrml_structural_eq(")` detection so the `equality` chunk is
included whenever the client emit uses it. Narrow (just `equality`) vs general
(scan for ALL referenced `_scrml_*` helpers) left to agent judgement; LEAN: fix
the whole class if clean + low-risk, else the narrow structural-eq seed at
minimum.

## GUARDS

- A page with NO `==` MUST still tree-shake `equality` OUT (reference-gated, not
  always-on).
- Check whether OTHER runtime helpers referenced from client emit have the SAME
  drop-bug (the general class); report any found.

## VERIFY / TESTS / GATE

- R26 empirical recompile of the adopter source post-fix; symptom-gone grep.
- Minimal standalone `==`-in-client-match-arm repro (dropped pre-fix / included
  post-fix) + over-inclusion guard.
- Codegen unit/integration test asserting the client-reference / runtime-
  definition pairing that was broken + the over-inclusion counter-test.
- Full gate `bun run test` == 0 fail; never `--no-verify`.

See `progress.md` for the resolution record.
