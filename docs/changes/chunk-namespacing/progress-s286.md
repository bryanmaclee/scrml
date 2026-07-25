# progress — S286 chunk-ns BUG-6 FINISH-TO-GREEN

Append-only. Branch `worktree-agent-a4e2f7f2c4e0d4141` (ff-merged to `e78f3b65`).

## Startup (2026-07-24)
- Worktree provisioned off `fe1ad047` (current main) NOT `e78f3b65`. ff-merged my branch to
  `e78f3b65` (48 commits of rename work; `fe1ad047` is its ancestor). Rename files now present.
- `bun install` + `bun run pretest` OK. `dist` symlinked from main (ENV-GAP).
- Baseline (my branch): 85 fail / 21048 pass (unit+int+conf). Matches brief.
- **KEY FINDING**: ran all 32 failing files against pre-rename baseline `fe1ad047` (scratch worktree):
  ALL GREEN (565 pass / 0 fail). So EVERY one of the 85 fails is RENAME-CAUSED. The progress-bug6.md
  "61 pre-existing" was measured vs the older `096f2239` baseline; main has since fixed those.

## Model (empirically verified — S265 execute-don't-grep)
Rename is behavior-preserving (proven: probe-engine.mjs — bare read("phase")=undefined, keyed
read("000lmhgk$phase")="Loading"). The 85 fails are TEST-HARNESS namespace-blindness + a few
over-migrated emit-unit expectations. Fix taxonomy:
- A. makeEvaluator/read-set by BARE cell name → key through `chunkCellKey(clientJs)`.
- B. fold-then-execute (RangeError self-recursion) / happy-dom bare-read → don't fold executed JS; key reads.
- C. text-assert on namespaced clientJs/html → `foldChunkNamespacing` at the READ site only.
- D. emit-unit over-migrated (emitExpr/emitEngineTimersTable/runtime-template asserting `_scrml_cs_`) → revert to raw `_scrml_`.
- E. byte-identity across two tokens → `normalizeChunkToken` both sides.
- F. no-runtime lowering IIFE (`return _scrml_lex_90` outside IIFE) → `unwrapChunkScope`.
- G. giti-009 compile-errors → investigate.
- H. chunk-namespacing.test.js N2/N3/N4 pinned → investigate (arc's own identity tests).

## Done
(appended per phase)

## Next
Fix files by class, run per-file, commit incrementally.

## Done (phase batches)
- engine-ontimeout (8): makeEvaluator keys read/set via chunkCellKey.
- s95-bug-2 (2): emitExpr direct→raw; §7 full-pipeline→cs.
- computed-delay (3): direct-emit + runtime-template reads→raw; full-pipeline indexOf→cs.
- bug-ab (3), s144 (2), engine-name-dual-table (3): foldChunkNamespacing text-asserts + unwrapChunkScope executor (IIFE-local program fns + bare reads).
- engine-event-handler-writes (4): align raw-accessor indexOf sites→cs.
- c15 (2): fold the two direct enginesClient readFileSync reads PART-A missed.
- engine-a7-hierarchy (1): add unNamespaceCellKeys. a7-history (1): cs advance indexOf.
- opener-c1 (2): foldChunkNamespacing at read + revert its 1 cs-assert. onIdle (3): fold + template-read raw.
- chain-mount N30 (1): cs reactive_get indexOf.
- replay-primitive (8) + effect-body-reactive-refs (5): compile returns RAW, buildEnv unwrapChunkScope for execution.

## FLAG (over-migrated-vs-gap): c22 (4) reverted to raw.
Empirically: BARE files (top-level `render(m)`, NO `<program>` wrapper) are NOT chunk-namespaced;
`<program>` pages ARE. Both written+in-memory output raw for bare files. c22 tests bare-variant
codegen (`.Idle`→"Idle") where accessor name is incidental. PART-A over-migrated. Reverted to raw.
OBSERVATION for PA: bare non-<program> script-files bypass BUG-6 namespacing (defensible — not page
chunks that compose into one document — but a theoretical hole if two bare files ever share a bundle).

## Next: happy-dom cluster + byte-identity + giti-009 + chunk-namespacing.test.js N2/N3/N4.

## MILESTONE: unit+integration+conformance GREEN (0 fail / 0 errors, exit 0) — 21224 pass
Remaining batch fixes since last note:
- engine-name-dual-table, engine-a7(hier/hist), opener-c1, onIdle, chain-mount, request-tag, m67-c2,
  self-host-v2-lexer(unwrap), byte-identity(normalizeChunkToken ×2), typed-array(unwrap), 28-flux(un-double-key),
  14-mario(unwrap), select-row+lift-target(captureInsideChunkScope), derived-machines(unwrap), engine-body-render(fold-html+unwrap).
- REAL CODEGEN FIX: wrapChunkBodyInIife now hoists top-level import/export OUT of the N3 IIFE
  (a classic client carrying a .js-helper ESM import was wrapped illegally → E-CODEGEN-INVALID-LOGIC). giti-009 green.
- semdiff: canonicalizeChunkNamespaceToken neutralizes the path-derived token in the emit-identity compare (D2 class).
- esm-client §4 + chunk-namespacing N2/N3/N4: flipped the KNOWN-OPEN/collision pins to assert the CLOSED behavior.
- elision-cat-2a-2b + elision-slice-2-3-4: repaired PART-A botched string escaping (parse errors).

## Next: within-node parity regen, gzip re-measure, browser isolated, artifact-diff, R26.
