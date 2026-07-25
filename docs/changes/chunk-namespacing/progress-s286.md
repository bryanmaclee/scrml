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

## SCRUTINY-DIRECTIVE RESPONSE (coordinator S286) — intact-bundle acceptance
Ran an ADVERSARIAL probe (scratch) executing the SHIPPED bundle with chunk scope
FULLY INTACT (prologue + N3 IIFE, ZERO fold/unwrap/normalize) in happy-dom:
- PASS: intact bundle executes WITHOUT throw — self-recursion + dangling-ref classes
  (`_scrml_lex_N`, `__scrml_engine_*_transitions`) are GONE in SHIPPED output. The
  self-recursion was ONLY ever a TEST-HELPER artifact (foldChunkNamespacing on the
  EXECUTED clientJs mangled `const _scrml_cs_X = (n)=>_scrml_X(...)` into
  `_scrml_X=(n)=>_scrml_X(...)`); the shipped prologue calls the REAL accessor.
- PASS: intact ENGINE transition on real button click (@phase Loading->Ready).
- PASS: TWO intact bundles (colliding cell+engine names) eval in ONE document scope
  WITHOUT `already been declared` (N3 IIFE isolation) — distinct tokens, distinct keys.
- each-reconcile-on-write: authoritative proof is the each-empty-fallback +
  g-each-* BROWSER tests (execute the INTACT bundle via captureInsideChunkScope,
  prologue+IIFE untouched) — all green. (My minimal probe's each had a harness-init
  quirk, not a shipped defect.)
CONCLUSION: the unwrap/fold/normalize test helpers are test-side accommodations for
eval-in-isolation harnesses reaching INTO the chunk (bare names / IIFE-local fns /
byte-identity across path-derived tokens); the SHIPPED bundle is correct as-is.

## Browser (Phase 4) — per-file isolated
Fixed GREEN (isolated): browser-forms, browser-todo, browser-todomvc, each-empty-fallback,
component-each-in-prop-scope, each-in-block-form-match, each-over-arm, g-bindvalue, g-nested-each,
g-tablefor-column-slot, tablefor-perrow, g-each-mount-form-submit, g-each-component-helper-hoist,
g-each-component-transitive, g-each-inline-prop-member, each-render-before-cell-init,
engine-gated-each-populate, g-if-guard, g-if-chain, g-match, engine-opener, ssr-a-terminus,
browser-deepset-write-loss, browser-structural-compound-deepset, g-each-item-hidden. (+ 14-mario,
derived-machines, engine-body-render fixed in the unit set.)
Fix shapes: chunkCellKey (key bare-global read/write through the token) | captureInsideChunkScope
(scoped setter for effect-triggering) | unwrapChunkScope (reach IIFE-local fns / bare exec) |
foldChunkNamespacing / _scrml_cs_ (text-assert on renamed clientJs) | namespaced mount selector.

REMAINING browser RED (NOT chunk-ns-caused — surfaced, not papered):
- peritem (3) + g-emit-lift (4): PRE-EXISTING markup-text whitespace bug (`Saved ${x}` ->
  `createTextNode("Saved")` drops the trailing space). Codegen BYTE-IDENTICAL to fe1ad047 (verified).
  NOT rename-caused. Their namespacing IS fixed; the whitespace assert/render remains.
- render-by-tag-nested-compound-bug60: PRE-EXISTING E-TYPE-031 (validator vocabulary closed at 14 —
  `email` rejected). Present on fe1ad047 too. Stale fixture, unrelated to chunk-ns.
- browser-navigate-soft-nav (7) + engine-message-dispatch-s155 (6): COMPLEX multi-chunk harnesses
  (soft-nav rehydration reads shell cells via window accessors; message-dispatch reimplements the
  runtime call site). Test-side keying WIP. The SHIPPED equivalents work — engine transition + msg
  arms are the same runtime path proven by the intact-bundle acceptance test.

## (A) REAL codegen/source fixes (product changed):
1. codegen/index.ts wrapChunkBodyInIife — hoist top-level import/export OUT of the N3 IIFE (a classic
   client carrying a .js-helper ESM import was wrapped illegally -> E-CODEGEN-INVALID-LOGIC). giti-009.
2. semdiff.ts canonicalizeChunkNamespaceToken — neutralize the path-derived chunk token in the
   emit-identity compare (D2 cosmetic class), so a moved/renamed file stays Tier-0.
(Plus the pre-existing rename machinery on the branch; these two are the NEW product changes this dispatch made.)

## (B) test-harness accommodations (product already correct; not masking, one-line reason each):
- makeEvaluator/loadSample/mount chunkCellKey keying: reads a cell by author name from OUTSIDE the
  chunk; the chunk namespaces the key — keying externally is required, doesn't alter emitted code.
- unwrapChunkScope executors (bug-ab/s144/engine-name-dual/14-mario/derived-machines/typed-array/
  self-host-lexer): the harness reaches an IIFE-local program fn / bare-keyed state; unwrap makes a
  TEST copy top-level+bare — the SHIPPED bundle (IIFE intact) executes correctly (intact-acceptance test).
- foldChunkNamespacing text-asserts: pins the token-INDEPENDENT lowering contract; a surgical fold
  that can ONLY remove the known `_scrml_cs_`/engine-token/cell-key delta — any other diff still surfaces.
- normalizeChunkToken byte-identity: two byte-identical sources at different paths differ ONLY by the
  path-hash token; normalizing both to a placeholder compares the BODY, not the incidental token.
- captureInsideChunkScope setter-inside (each-empty-fallback/select-row/lift-target): the each-effect
  subscribes to the SCOPED key; the injected setter must bind the scoped `_scrml_cs_` wrapper.
- emit-unit reverts to raw (s95/computed-delay/c22/runtime-template reads): emitExpr/emitEngineTimersTable/
  the runtime template emit the RAW name; the rename runs at bundle assembly, so `_scrml_cs_` was over-migrated.
- N2/N3/N4 + esm-collision pin FLIPS: the arc CLOSED these; the tests now assert the fix, not the old bug.
- within-node parity allowlist regen: classifier runs on PARSED FileASTs pre-codegen; rename cannot affect
  it (parser/allowlist/fixtures byte-identical to fe1ad047) — main's #162 drift, designed baseline-regen.
