# BRIEF — value-native Set `set[K]` (B2 map-alias) — §59.12 implement + flip Nominal banner

**Dispatched:** ss37, 2026-06-26. **Agent:** scrml-js-codegen-engineer, isolation:worktree, opus.
**Branch base:** `spa/ss37` @ `49e04332` (the PA's RULING commit; §59.12 B2 text authored).

## What you are building

`set[K]` — a value-native Set TYPE that is a **thin desugar over the §59 value-native map**. This is **NOT a new collection**: no new runtime structure, no new literal, no new codec. `set[K]` lowers to the map `[K: bool]` with a fixed compiler-internal membership marker (`true`, never author-visible). Mirror the S169 Map landing (D1 type-recognition → D2 parser → D3 lowering → D4 codegen/tests), but the "runtime" step is a desugar, not a new structure.

**Normative source — READ IT FIRST, it is fully authored:** `compiler/SPEC.md` §59.12 (lines ~33083–33088). The `set` bullet + its sub-bullets are the contract. Key points verbatim:

- **Desugar.** `set[K]` is a TYPE lowering to §59 map `[K: bool]`, value always `true` (internal marker, never author-visible). No new data structure/runtime/literal/codec — only a desugar pass + the lowered surface.
- **Surface (set vocab → map lowering):**
  - `.add(k)` → map `.insert(k, true)`  (`.add` is the author-facing spelling; NOT `.insert`)
  - `.has(k)` → §59.6 map key-presence → `bool`
  - `.remove(k)` → map remove
  - `.size` → entry count
  - **Iteration yields ELEMENTS (the map's keys, NOT the markers):** `<each in=@s as e>` and/or `.elements()` → `[K]`. (Do NOT expose `.entries()`/`.values()` markers to the author.)
  - `.union` / `.intersect` / `.difference` are **methods that DELEGATE to the already-shipped `scrml:data` value-canonical algebra** (`union`/`intersection`/`difference` in `stdlib/data/transform.scrml`). ONE algebra implementation — surface it as methods, do NOT re-implement (limit-primitives: do not double the surface).
- **Empty literal `[:]`** (the map's empty). **NO distinct set literal** — seed via `.add`. This cohesion seam (type says `set`, empty literal is map's `[:]`) is RULED, accepted.
- **Inherited from the §59 map, NOT re-specified:** value-canonical hashing (§59.5); COW / reassignment-canonical (`@s = @s.add(k)`); bracket-WRITE rejected → reuse `E-MAP-BRACKET-WRITE`; structural order-independent `==` (two sets equal iff same elements — falls out of map `==`); value-acyclic elements; lossless §57 codec. Struct/enum/nested elements value-correct for FREE (the map's structural key-hash).

## Footprint (the §59 map machinery is your TEMPLATE — mirror it)

- **D1 — type-system** `compiler/src/type-system.ts`: `MapType` interface + `tMap()` + comparability are at ~289–846, ~2233. Recognize the `set[K]` type → resolve to a `MapType` keyed `K`→`bool` (or a `SetType` view that lowers identically — your call, but the desugar-to-map representation is the ruling; the cleanest is to resolve `set[K]` to the map `[K: bool]` and carry a `set` display/flag for diagnostics + the element-iteration shape). Type-check the set method surface (`.add`/`.has`/`.remove`/`.size`/`.elements`/`.union`/`.intersect`/`.difference`). Key comparability reuses the map's `isComparableType`. Bracket-write on a set-typed cell reuses the `E-MAP-BRACKET-WRITE` typer gate.
- **D2 — parser** (`compiler/src/ast-builder.js` native + the legacy type path): recognize the `set[K]` TYPE grammar. There is NO new literal (empty = `[:]`, already parsed by `expression-parser.ts:1199+`). Mind the native-parser `.scrml` mirror staleness caveat — brief the conditional, not a rigid lockstep (memory `native_parser_scrml_mirror_feature_stale`).
- **D3/D4 — codegen** `compiler/src/codegen/` (map lowering: `emit-functions.ts` uses `collectMapVarNames`/`collectOrderedMapVarNames` from `reactive-deps.ts`): lower the set-vocab call sites → map-vocab (`.add`→`.insert(_, true)`, `.has`/`.remove`/`.size` direct, `.elements`→map `.keys()`), and lower `.union`/`.intersect`/`.difference` → calls into the `scrml:data` helpers (import/emit the same way other `scrml:data` transforms are emitted). Confirm whether set var-names need a collector sibling (`collectSetVarNames`) or fold into the existing map collector.
- **SPEC** §59.12 is authored. **Flip the Nominal banner** to IMPLEMENTED for the set bullet once it compiles end-to-end (mirror the §59 map banner phrasing). Do NOT re-author the design — only flip status + reconcile any "Nominal/spec-ahead" wording for set.

## Verification (R26, mirror how Maps were verified)

1. **Compile + `node --check`** a worked example exercising the full set surface (add/has/remove/size/elements/union/intersect/difference + struct elements + `@s = @s.add(k)` COW + iteration). Add it as `examples/NN-value-native-set.scrml` (next free number).
2. **Runtime correctness** — actually run the emitted JS and assert behavior (membership, dedup-by-construction, struct-element value-correctness, set-algebra results match the `scrml:data` helpers, order-independent `==`).
3. **Tests** — mirror the §59 map test suite shape (a set integration/codegen test file). Cover: `set[K]` type recognition, `.add`/`.has`/`.remove`/`.size`/`.elements`, the three algebra methods, struct/enum elements, `E-MAP-BRACKET-WRITE` on set bracket-write, the empty-`[:]` seed.
4. **FULL `bun run test`** before you report DONE. The pre-commit hook runs the full ~18k-test suite (~131s) — budget for it.
5. No differential-testing needed (this adds no runtime structure — it's a desugar; the map's own tests already guard the runtime).

## Constraints / discipline

- **NO new runtime structure, NO new literal, NO new codec.** If you find yourself writing a Set runtime class, STOP — it desugars to the map. The marker value is `true`; never surface it.
- **Do NOT re-implement set-algebra** — `.union`/`.intersect`/`.difference` delegate to the shipped `scrml:data` helpers (`stdlib/data/transform.scrml`). Read those first; match their value-canonical contract.
- **Commit incrementally** on your worktree branch (one logical D-step per commit; coupled code+test in the SAME commit — memory `coupled_code_test_commit`). NEVER `--no-verify`. The hook gates each commit.
- **Path discipline:** write ONLY inside your worktree (verify `git status` shows no main-checkout leakage; `stat`/read-back check — memory `agent_main_repo_path_leak`).
- **Rep-agnostic:** the map rep is COW today; ss38 will swap it to HAMT later. Because Set is a pure desugar to `.insert`/`.keys()` calls, your work rides whatever the map rep is — do NOT couple to COW internals.
- If you hit a genuine design fork (e.g. the `set[K]` parse grammar collides with something, or `.elements` vs `.values` naming is ambiguous against the SPEC), STOP and report it — do NOT invent a ruling.

**Return:** a final summary — files touched, the worked example path, test file path, full-suite result (pass/fail counts), your branch tip SHA, and any forks you hit.
