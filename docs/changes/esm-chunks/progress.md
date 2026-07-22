# ESM chunks — Unit 1 progress (append-only)

## 2026-07-21 — start (agent-a9091aa6c1e5bdfae)

Worktree base predates main's `docs/changes/esm-chunks/` (BRIEF.md/U1-BRIEF.md exist in main
only). Read both from main (read-only, path-discipline OK). Baseline pre-commit gate GREEN
(21152 tests, 0 fail, 1 todo) at first WIP commit `30a56e74`.

### Survey findings (empirical, verified against source)
- `runtime-chunks.ts:assembleRuntime(chunkNames)` produces the FINAL runtime string from the
  post-slice chunk set. Standalone runtime file emitted at `codegen/index.ts:2400`
  (`runtimeJs = assembleRuntime(union)`), then FNV-hashed (`:2406`) into `scrml-runtime.<hash>.js`.
  This is the U1 locus for the esm branch (append export block BEFORE hashing so classic hash is
  byte-identical and esm gets its own hash).
- `validate-emit.ts` parses EVERY artifact as `sourceType:"module"` FIRST (superset) — so the esm
  `export` block does NOT trip the default-on emit gate. Confirmed L61 PARSE_OPTIONS.
- **PROVEN**: the current CLASSIC assembled runtime ALREADY parses as an ES module
  (`sourceType:module`, len 307659). Adding `export {…}` → valid module. No script-only construct.
- **Top-level decl count = 237** (175 fn / 9 class / 39 const / 3 let / 11 var), ZERO duplicates.
  Brief said "~69 symbols" — PREMISE DRIFT (brief was wrong / measured a subset). Deriving-not-
  curating makes this a non-issue: over-export is harmless, under-export is a link error, so
  exporting ALL 237 top-level decls is the safe robust superset. Reported to PA.
- All R1 + guard anchors match EXACTLY (reactive_get header ×1, meta savedGet ×1, meta finally ×1,
  4 redeclare guards ×1) in the FULL runtime. meta + guard anchors are chunk-gated → at-most-once
  in a sliced standalone runtime; reactive_get header is core (always ×1).
- Transitions IIFE (always-included) is `typeof document` guarded → full runtime importable in bun
  DOM-free. All top-level window/document access is `typeof`-guarded.

### Plan
1. NEW `codegen/runtime-esm.ts` — `toEsmRuntime(assembled)`: R1 rework (override-slot) +
   redeclare-guard simplification + derived `export {…}` block (acorn top-level decls).
2. `codegen/index.ts` — CgInput.moduleFormat + runCG destructure + esm branch at :2400.
3. `api.js` — compileScrml destructure moduleFormat + pass to runCG.
4. `commands/compile.js` + `build.js` + `dev.js` — `--module-format=classic|esm` flag plumbing.
5. NEW `tests/unit/esm-runtime-module-format.test.js` — classic byte-identical, esm imports as
   module, functional R1 (reactive roundtrip + subscribe + meta-effect dep-track interception).

### R1 design (bounded)
Distinct override slot `globalThis.__scrml_reactive_get_override`. `_scrml_reactive_get` consults
it first (module-binding reads route through the tracker). `_scrml_meta_effect` sets/restores the
slot (nested-safe save/restore) instead of swapping `globalThis._scrml_reactive_get` (which under
ESM diverges from the module binding). Applied ESM-ONLY (string transform) so classic bytes are
byte-identical. Classic keeps the old globalThis-swap (works: bare===global in classic scripts).

### DONE (verified before commit)
- NEW `codegen/runtime-esm.ts` — `toEsmRuntime()` (R1 override-slot + guard simplify + derived
  `export {…}`), `deriveTopLevelExportNames()`, `REACTIVE_GET_OVERRIDE_SLOT`. Fail-loud anchored
  replacements (throw on drift).
- `codegen/index.ts` — CgInput.moduleFormat + runCG destructure + esm branch at the `!embedRuntime`
  standalone-runtime assembly (after slice, before hash).
- `api.js` — compileScrml destructure moduleFormat + pass to runCG.
- `commands/compile.js` + `build.js` + `dev.js` — `--module-format=classic|esm` flag (both `=v` and
  space forms; unknown-value rejection) + help text + threading to compileScrml.
- NEW `tests/unit/esm-runtime-module-format.test.js` — 9 tests, all green.

### Verified empirically
- compileScrml: default === explicit classic → BYTE-IDENTICAL runtime + same FNV filename (ACC #1).
- CLI: `--module-format=esm` emits `export {…}` block; `--module-format=bogus` → exit 1.
- esm runtime parses as module + imports in bun (64 exports for the minimal sample; 237 full) (ACC #2).
- Functional R1: full esm runtime imported DOM-free; reactive roundtrip + subscribe + meta-effect
  dep-track re-run (runs 1→2 on module-binding read) + override-slot restore (ACC #3).
- Guard simplification: `_scrml_modules`/`_SCRML_MOUNTS` redeclare guards dropped in esm (the
  in-function `_SCRML_CHUNKS` read-guard at L2772 intentionally LEFT — references a real var).

### DEVIATION from brief (reported)
- Kept `var` (not `const`) on the simplified `_scrml_modules` decl — rebind-safe; the brief said
  `const`, the difference is immaterial for correctness and `var` is the minimal, provably-safe edit.
- Brief said "~69 symbols"; actual = 237 top-level decls. Non-issue (derive-not-curate).

committed feature: e348da6d. Full gate GREEN (21090 pass / 70 skip / 1 todo / 0 fail, +9 = my file).

## 2026-07-21 — fix-round (post-S239, PA-ratified by bryan)

PA S239 verdict: U1 transform core VERIFIED correct. One convergent finder finding, ratified as a
pre-land fix: `--module-format=esm` is a fail-closed-Nominal (S231) violation — it emits an
ES-module runtime but the HTML tag is still classic `<script src>` (no `type="module"` — that is
U3), so `--esm` silently ships a browser-DEAD app with a green compile + zero diagnostics.

### FIX (folded into U1)
- NEW `commands/module-format-notice.js` — `moduleFormatNotices(moduleFormat, embedRuntime)`:
  returns `[]` for classic (default stays silent), one `W-MODULE-FORMAT-ESM-INCOMPLETE (operational
  warning)` line for esm, + a second `Note:` line for esm+embed (esm is dropped for embedded
  runtimes). OPERATIONAL/CLI notice — NOT a §34 catalog row (freeze-gated catalog untouched).
- compile.js / build.js / dev.js — import + fire once per compile pass to stderr (compile.js in
  `c.yellow`; build/dev plain). Help text for `--module-format` annotated "experimental — not
  browser-loadable until chunk-module support lands".

### Verified
- CLI: `--module-format=esm` → stderr contains `W-MODULE-FORMAT-ESM-INCOMPLETE`; `--module-format=
  classic` → 0 occurrences. Both exit 0.
- Classic byte-identity RE-PROVEN (probe-compile.mjs): default === classic byte-identical + same
  FNV filename. The notice is command-layer stderr only — compileScrml/emitted files untouched, so
  byte-identity is structural.
- Test file extended to 13 tests (§6: classic-silent, esm-1-line, esm+embed-2-lines, CLI-surface
  esm-fires / classic-silent). All 13 green.

### OUT OF SCOPE — deferred to U2 (per PA)
- Finder Finding-3: `deriveTopLevelExportNames` omits top-level DESTRUCTURING / block-declared
  names (ungated over/under-export). Not triggered by today's runtime (0 top-level destructuring;
  all decls are plain Identifier const/let/var/function/class — verified via the §3 Acorn
  cross-check test). Revisit if a future runtime symbol is added via destructuring.
- Finder Finding-2: the `min=0` meta-anchor double-drift edge (both meta anchors could
  independently vanish) — already CI-covered by the §5 drift-guard + the set/finally count-parity
  assert in applyR1. No action now.

next: commit fix-round; run full pre-commit gate

## 2026-07-21 — Unit 2 (chunk emit) (agent-a5530a9ff58e8bba7)

Worktree base = 970d3e1f (U1 landed, PR #132). Maps stamped 9481bc69 (pre-U1) — NOT
load-bearing for U2 beyond confirming the codegen/ surface; trusted U1's progress.md for the
ESM plumbing (runtime-esm.ts, moduleFormat threaded index.ts→api.js→commands). Baseline gate
GREEN before changes.

### Empirical survey (real trucking-dispatch artifacts, both formats)
- `generateClientJs` emits the runtime INLINE; `index.ts` (~L1587, `!embedRuntime`) STRIPS it
  out, replacing with `// Requires: <PLACEHOLDER>` and factoring the UNION runtime into the
  standalone `scrml-runtime.<hash>.js`. Placeholder substituted post-union (L2452).
- Classic cross-file linkage: exporter footer `_scrml_modules["<key>"] = {pub: emit,…}`;
  importer `const {a,b} = _scrml_modules["<key>"]` / `const x = _scrml_modules["<key>"].default`.
  Cross-file-linked bodies are IIFE-wrapped (`wrapClientBodyInIife`, index.ts ~L1628) to avoid
  shared-global top-level collisions. Enum reps (`Phase_toEnum`/`_variants`/`Phase`) are bare
  top-level `const` — the collision source.
- `_scrml_stdlib` IS a runtime top-level decl (`const _scrml_stdlib = {}`) → exported by the esm
  runtime → stdlib reads (`const {x} = _scrml_stdlib.<mod>`) just need `_scrml_stdlib` imported;
  handled by the runtime-import surface, no special case.

### Design (mirrors U1's toEsmRuntime architecture)
NEW `codegen/emit-client-esm.ts` — `toEsmClientChunk(body, ctx)`, applied in index.ts's
`!embedRuntime` esm branch AFTER the runtime-strip, BEFORE (and instead of) the IIFE wrap:
  1. Footer → `export { emit as pub, … };` (empty → `export {};`).
  2. Each registry read → a deduped namespace import + local destructure:
       `import * as __scrml_dep_N from "<url>";  const {a,b} = __scrml_dep_N;`
  3. Runtime `import { <surface> } from "<runtimeUrl>";` where
     surface = (runtime-slice top-level exports ∩ chunk-referenced idents) − chunk-own top-level
     decls. Slice-derived so every name ⊆ the union runtime's exports (guaranteed linkable).
IIFE skipped under esm (module scope isolates top-level decls → collision dissolves for free;
an IIFE cannot enclose top-level import/export).

### BRIEF-PREMISE CORRECTION (load-bearing)
Brief §2 said importer → `import { x } from …`. NAMED imports are WRONG here: an importer names
bindings the dep does NOT export as a JS value (cross-file COMPONENTS + type-only names — resolved
at markup-mount, never registered). A NAMED import of a non-exported binding is a hard MODULE LINK
ERROR that kills the page; classic yields `undefined` (harmless). Used a NAMESPACE import +
destructure — `const {LoadCard} = __dep` yields `undefined` for a missing export, preserving exact
classic semantics. Verified: board.client.js imports `LoadCard` (a component load-card does NOT
export) — namespace form links; named form would not.

### URL resolution (pages-strip)
Dist files land `pages/`-STRIPPED (`api.js pathFor` → `stripPagesPrefix`), but registry keys are
un-stripped. So import URLs are computed between STRIPPED locations (importerDistDir + each dep
key both `stripPagesPrefix`'d), `./`/`../`-prefixed for ES. Verified: `pages/dispatch/board.scrml`
→ `dispatch/board.client.js`, imports resolve `../components/…`, `../scrml-runtime.<hash>.js`
(depth 1, correct). NOTE (U3): composed-MPA HTML `<script>` tags still need `type="module"` +
their own upToRoot; composition does NOT rewrite client.js bodies, so these baked-in URLs are
already composition-correct (they target the actual stripped dist locations).

### Verified (empirical, real artifacts)
- ACC#1 byte-identity: main classic == wt default == wt explicit-classic, `diff -rq` IDENTICAL
  (36 files). Classic path 100% untouched (transform is esm-gated).
- ACC#2: esm compile → 0 `_scrml_modules` refs in any of 36 chunks, 0 IIFE wraps; all 36 chunks
  + runtime parse as `sourceType:module` (acorn).
- Footer→export: `schema` → `export { UserRole, LoadStatus, … }`; `load-card` →
  `export { _scrml_formatPickupAt_34 as formatPickupAt, … }` (mangled→public).

next: linkage-executes test (ACC#3, playwright real-Chromium), collision-dissolved test (ACC#4),
unit tests under compiler/tests/unit, full pre-commit gate.

### Unit-2 fix-round: shared-mutable-global bridge (U1 gap surfaced by real chunks)

REAL-CHUNK EMPIRICAL FINDING (S275 "verify the premise" discipline): compiling 22-multifile +
trucking-dispatch esm surfaced a correctness bug NOT anticipated in the brief. `_scrml_lift_target`
is a SHARED MUTABLE GLOBAL — client chunks WRITE it (`_scrml_lift_target = document.querySelector(
…)`, emit-reactive-wiring.ts) and the runtime's `_scrml_lift` READS it (runtime-template.js L1312).
Under ESM an imported binding is READ-ONLY, so the chunk's assignment throws at module eval →
DEAD CHUNK. U1 tested the runtime in isolation (no real chunks writing the global), so it missed
this — exactly analogous to U1's own R1 fix for the `_scrml_reactive_get` interception, but for a
DIFFERENT shared-mutable-global. Acorn assignment-target scan across trucking + multifile → the
write-set is EXACTLY ONE symbol: `_scrml_lift_target`.

FIX (globalThis bridge, both sides, esm-only — classic byte-identical):
- runtime-esm.ts: NEW `applyR2` + `LIFT_TARGET_GLOBAL` — the `_scrml_lift` container read consults
  `globalThis._scrml_lift_target` first, then the classic module-local fallback. Anchored +
  chunk-gated (lift chunk) + fail-loud, mirroring R1's structure. Folded into `toEsmRuntime`.
- emit-client-esm.ts: `SHARED_MUTABLE_RUNTIME_GLOBALS = {_scrml_lift_target}`. The chunk transform
  routes every bare occurrence of a bridged global to `globalThis.<name>` (write + read), excludes
  it from the runtime import, and FAILS LOUD if a chunk assigns ANY OTHER runtime export (a new
  shared-mutable-global with no bridge — caught at compile time, not shipped broken).

This DIRECTLY BLOCKS U2 (chunks would not load), so it is in scope per the brief's
"unless they directly block U2" exception. Surfaced prominently as a U1-gap-closed-in-U2.

### Verified (ACC #3, #4, #5)
- ACC#3 linkage EXECUTES — bun-native ESM loader: runtime + cross-chunk imports resolve; reactivity
  roundtrips (unit §3). REAL-CHROMIUM `<script type=module>` (playwright-core + chromium-1228,
  scratchpad/chromium-linkage.mjs): runtime import + cross-chunk import + reactivity all link/run,
  ZERO JS/module pageerrors → PASS. happy-dom full-graph (app.client.js incl. lift-target) executes
  (browser test).
- ACC#4 collision dissolved — reproducer (shell `<program>` + `pages/detail` each declaring
  `type Phase:enum`): classic concat → acorn `already been declared` SyntaxError; esm each
  module-local `Phase_toEnum`, coexist (unit §4).
- ACC#5 — NEW tests: unit/esm-client-chunk-format.test.js (15 tests, all pass),
  browser/esm-chunk-module-linkage.browser.test.js (1 test, pass). U1's test still 13/13 green.

TEST RUN: `bun test compiler/tests/unit/esm-client-chunk-format.test.js`
          `bun test compiler/tests/browser/esm-chunk-module-linkage.browser.test.js`

BRIEF LOCI/PREMISES CORRECTED:
1. Import form: brief said `import { x }`; correct form is NAMESPACE import (component/type imports
   would link-error under named imports). [done, §emit-client-esm header]
2. `_scrml_lift_target` shared-mutable-global bridge: not mentioned in the U2 brief; a U1 runtime
   gap that U2's real chunks surface. Fixed both sides (blast radius = 1 symbol).
3. URL resolution needs the `pages/` strip (dist files land stripped, keys are un-stripped) — the
   plain "reuse computeDependencyClientScripts" resolver under-specifies this. [done]

DEFERRED to U3 (out of U2 scope): `type="module"` on HTML `<script src>` tags; composed-MPA script
emit. The emitted esm import URLs already target the actual (pages-stripped) dist locations, so U3's
composition work does not need to rewrite client.js bodies.

## 2026-07-21 — U2 fix-round (post-PA-S239, LAND-WITH-FIXES) (agent-a5530a9ff58e8bba7)

PA S239 cleared U2 on the live axis (no R3; 2 finders exhaustive over 129 chunks/34 apps; namespace
semantics correct; classic byte-identity airtight over the 2048-file samples corpus + all examples +
website + multifile + embed; lift-target bridge + URL depth math correct). Two MEDIUM fix-round items:

### FIX 1 (folded in) — complete the fail-loud guard's write-form coverage
`analyzeChunk` previously recorded only `AssignmentExpression`/`UpdateExpression` with an Identifier
target, MISSING object-destructure (`({ _scrml_x } = o)`), array-destructure (`[ _scrml_x ] = a`),
rest (`{ ..._scrml_x }`), and for-of/for-in loop targets (`for (_scrml_x of …)`). A future codegen
change writing an unbridged runtime global via any of these would slip the guard → import a
read-only binding + assign it → module-eval throw, green compile, dead chunk. Latent today (zero such
forms across 129 chunks) but the guard is the arc's forward safety net (R1→R2 each surfaced a new
shared global), so it must be complete. Fix: NEW `collectAssignmentTargets` walks the target PATTERN
recursively (ObjectPattern/ArrayPattern/AssignmentPattern/RestElement → bare Identifiers;
MemberExpression binds no bare id → skipped); wired for AssignmentExpression.left,
UpdateExpression.argument, and ForOf/ForIn.left (when not a VariableDeclaration = a new local). NEW
test: all 7 write forms throw the guard for `_scrml_reactive_get`; `for (const x of …)` new-local +
member-write do NOT false-positive.

### FIX 2 (documented + deferred to U3, NO code fix) — build+esm content-hash 404 landmine
`build --module-format=esm` content-hashes the chunk FILES + rewrites HTML <script src>, but NOT the
in-chunk ES `import` URLs U2 emits → cross-chunk imports point at pre-hash names → 404. Build-path
only; `compile --module-format=esm` is clean; the runtime import survives (codegen-baked hash).
Browser-DOA + W-MODULE-FORMAT-ESM-INCOMPLETE-warned until U3, so no one hits it. Empirically
reproduced (build 22-multifile esm: on-disk `types.client.00ekulbh.js` vs import `./types.client.js`).
- Filed known-gap `g-esm-build-content-hash-import-urls` (MED, open, DEFERRED-U3) — docs/known-gaps.md
  §S278 + @gap token; MED count 38→39.
- Pinned `.skip` test: compiler/tests/unit/esm-client-chunk-format.test.js §6 — asserts every
  build+esm cross-chunk import specifier resolves on disk. FAILS today; U3 un-skips after extending
  the hash-rewrite (or hard-gating build+esm).

**>>> U3 BLOCKER <<<** Before the esm path is browser-loadable, U3 MUST (a) add `type="module"` to the
HTML <script src> tags (its named scope) AND (b) extend the content-hash rewrite to the in-chunk ES
import URLs, OR hard-gate `build --module-format=esm`. Un-skip the §6 pin when done.

### Re-verified (fix-round)
- Classic byte-identity STILL holds (FIX 1 is esm-transform-analysis only; diff -rq trucking
  main-classic vs wt-default IDENTICAL — see report).
- Guard FIRES on destructure + array-destructure + rest + for-of + for-in + update writes to an
  unbridged global; does NOT false-positive on new-locals / member-writes (unit §1, 7 forms + 2 neg).
- Unit file: 16 pass / 1 skip (U3 pin) / 0 fail.
