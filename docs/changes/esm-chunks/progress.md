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
