# BRIEF — `--emit-token-set` (ss54, flogence-coordinated)

**Change-id:** `token-set-emit-2026-06-28` · **Branch:** `spa/ss54` · **Built:** PA-direct (sPA, single contained item)

## What
The scrml-side half of the flogence docs↔code-drift DD (flogence S17, ratified). Emit a
compiler-computed **token-set** (`--emit-token-set` → `token-set.json`) that flogence consumes
as a second flograph currency pass to flag a doc citing a now-dead symbol. **scrml owns ONLY
the emit** — a read-only projection of what the compiler already computes. Consume/display/tiering
lives in flogence.

## Survey findings (the locating half of SURVEY-FIRST)
- **Emit-hook precedent:** `--emit-reachability` / `--emit-engine-graph` / `--emit-block-analysis`
  in `commands/compile.js` — a CLI flag → a lazy `result.*Json()` fn on the api.js return →
  `writeFileSync` in compile.js. Mirror exactly. Dead-code-free: the fn is lazy, only invoked
  under the flag.
- **symbols source:** `buildBlockAnalysis(metaFiles)` (block-analysis.ts, EXPORTED, tested,
  deterministic) already projects every named block (`function|component|engine|type|channel`)
  per file. PLUS file-level state-cells via `FileAST._scope.stateCells` (SYM attaches `_scope`).
- **keywords source:** `KEYWORDS` set in `tokenizer.ts:57` (now exported) ∪ stdlib namespaces
  (one dir per module under repo-root `stdlib/`).
- **errorCodes source — the UNANTICIPATED 3rd OQ:** there is **NO programmatic §34 catalog**.
  461 distinct `(E|W|I)-*` codes scattered as string literals across `compiler/src`; §34 is
  SPEC prose. Decision below.
- **Distribution:** bun runs `.ts`/`.js` directly from `compiler/src` (no dist bundle for the
  compiler itself) → an `import.meta.url`-relative source scan is reliable.

## Decisions (the 2 list OQs + the surfaced 3rd)

**OQ-1 — version / identity key → CONTENT HASH (FNV-1a).** `fnv1aHash` (codegen/fnv1a-hash.ts,
§47.1.3 normative, 8-char base36) over the canonical JSON body `{symbols, errorCodes, keywords}`.
Decisive, not just the lean: the re-check invariant flogence stated ("changes when the symbol set
changes; stable when source unchanged") **is** a content hash. A monotonic / commit-SHA key
changes on every commit even when symbols don't → false "re-check needed" churn → violates the
invariant in the test plan. Semantically a fingerprint, not a version number — flagged to flogence.

**OQ-2 — per-symbol `kind` → YES.** Every symbol is `{name, kind}`. v1 kind enum:
`function|component|engine|type|channel|state-cell` (the buildBlockAnalysis five + state-cells).
`enum-variant` / `server-fn` (vs pure) / `stdlib-export` granularity DEFERRED (documented to
flogence) — a removed function is dead regardless of server-ness; stdlib vocab rides the
`keywords` field, not `symbols`.

**OQ-3 (surfaced) — errorCodes source → LIVE SOURCE-SCAN.** Scan `compiler/src/**/*.{ts,js}`
(resolved via `import.meta.url`) for `(E|W|I)-[A-Z0-9-]+` string literals; dedupe; sort.
Rationale:
  - No programmatic catalog exists; the scattered literals ARE the de-facto emittable set.
  - **Over-inclusion is SAFE:** the oracle flags codes ABSENT from the set, so an over-broad set
    only yields fewer false "dead-code" flags — never a false positive.
  - A committed constant registry would impose a per-diagnostic refactor-tax on every future
    code-adding change (violates the co-location axiom) AND is itself a "second identity store"
    smell (constraint ii). Live-scan is drift-free + anti-ouroboros (read-only, never read back).
  - **Risk flagged:** depends on the run-from-source distribution model. If scrml ever ships a
    bundled/minified package without `compiler/src`, errorCodes needs a generated-constant
    fallback. Documented to flogence + PA.

## Hard constraints honored
- (i) INFO never a gate — the emit is wired into nothing pass/fail; pure CLI byproduct.
- (ii) Rides existing projections, NOT a new identity store — read-only projection of the symbol
  table / AST / tokenizer; written to `token-set.json` which the compiler never reads back.
- (iii) Confidence-tiering SUPPORTED via per-symbol `kind` (flogence-side tiering).
- (iv) Emits no "this doc is current" signal — N/A to the emit.

## Shape
```json
{ "version": "<8-char fnv1a base36 of the canonical body>",
  "symbols":    [ {"name":"sendMessage","kind":"function"}, ... ],   // sorted (kind,name), deduped
  "errorCodes": [ "E-...","W-...","I-..." ],                          // sorted, deduped
  "keywords":   [ "match","lift", ..., "scrml:data", ... ] }          // sorted, deduped
```
ONE `token-set.json` per compile (symbols aggregate across all compiled sources), written to
`outputDir`. No flag → no artifact, zero overhead.

## Files
- `compiler/src/token-set.ts` — NEW. `buildTokenSet(metaFiles,{errorCodes,keywords})` (pure
  given injected static sets) + `collectSymbols` + `collectErrorCodes(srcDir?)` +
  `collectKeywords(stdlibDir?)` (FS scans, import.meta.url defaults) + `serializeTokenSet`.
- `compiler/src/tokenizer.ts` — export `KEYWORDS`.
- `compiler/src/api.js` — add `tokenSetJson` lazy fn to the result object.
- `compiler/src/commands/compile.js` — `--emit-token-set` flag + usage line + emit block.
- `compiler/tests/unit/token-set.test.js` — R26 (real compiled AST), all-4-keys, version
  invariant, no-flag-no-artifact.

## Test plan (from the list)
- `--emit-token-set` → well-formed `token-set.json`, 4 keys populated on a representative
  `.scrml` (symbols non-empty {name,kind}, errorCodes = the §34 scan, keywords = the vocab).
- No flag → no artifact, no overhead.
- version stable when source unchanged; changes when a symbol is added/removed/renamed.
- R26: emit on a real adopter source; symbol set matches declared identifiers.

## Coordination-back to flogence (on land)
Reply with the FINAL contract: version-key = **content fingerprint (fnv1a)** not a monotonic
version; kind IS emitted (v1 enum = 5 decl kinds + state-cell; enum-variant/server-fn/stdlib-export
deferred); artifact = `token-set.json` in outputDir under `--emit-token-set`; errorCodes = live
source-scan (run-from-source dependency flagged).
