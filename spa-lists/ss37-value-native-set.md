# ss37 — value-native Set (§59.12 un-defer) — SURVEY-FIRST feature

> ✅ **DONE — VERIFIED-LANDED (do NOT re-fire).** S225 runtime check at HEAD `6ead4d7a`: `examples/34-value-native-set.scrml` compiles clean + `node --check` green + the emitted JS uses the B2 set→map desugar (`_scrml_map_insert`/`_scrml_map_has`/`_scrml_map_keys`/`_scrml_map_size`). Set landed S222 (desugar) and rides ss38's HAMT rep (S223). The "CORRECTION / sequencing STILL LIVE / re-fire" text below is **stale intermediate history** — superseded; Set is integrated in main. SPEC §59.12 confirms.

**Fill-note:** un-defer **§59.12 Set** — a value-native Set type, sibling of the §59 value-native Maps. It was **design-deferred "for lack of an exerciser"**; the DG-builder de-risk slice IS the exerciser (graph algorithms are set-saturated — DFS visited/coloring, reader-sets, fixpoint membership), and it's the headline mechanics-beauty add for narrow-Road-B (kills the model-sets-as-arrays verbosity). **SURVEY-FIRST** — confirm the §59.12 design is complete enough to build, mirror the §59 Map landing (S169), **park any genuine design fork for the PA→user.**

**Shared ingestion:** the §59 value-native Map machinery is the TEMPLATE — the value-canonical hasher, the COW/reassignment-canonical model, the lossless codec, order-independent `==`, the type-system recognition, the codegen lowering. Set is a one-value-per-entry sibling of Map. SEQUENTIAL within-list.

**coreFiles:** the §59 Map impl as the template — `compiler/src/type-system.ts` (map/set recognition + key-comparability) · the runtime (value-canonical hasher + the Map structure → a Set structure) · `compiler/src/codegen/` map lowering (→ set lowering) · the legacy + native literal parsers. SPEC §59.12 (PA ratifies any normative additions).

**Brief reminders:** SURVEY-FIRST — Phase 0 confirms §59.12's design is build-ready (literal syntax, method surface — `.has`/`.add`/`.remove`/`.union`/`.intersect`/`.difference`/`.size`, value-canonical hashing reuse, COW, structural order-independent `==`, iteration order via value-canonical/`@ordered`). Mirror the S169 Map landing shape (D1 type-recognition + D2 literal parser + D3 runtime + D4 codegen). R26 (compile + `node --check` + runtime correctness, as Maps were verified). Re-baseline within-node parity if fixtures shift; FULL `bun run test` before DONE. New §59.12 normative text → PA ratifies.

## Items

1. **value-native Set §59.12 (un-defer)** (Nominal → build) `[status=landed-on-branch SHA=70b11383]` **B2 RATIFIED → BUILT → LANDED on `spa/ss37` (scrml-js-codegen-engineer, worktree)**
   - The Map sibling: value-canonical-hashed, COW (`@s = @s.add(x)` reassignment-canonical, bracket-write rejected à la `E-MAP-BRACKET-WRITE`), structural order-independent `==`, value-acyclic (no set-of-cyclic-keys, like maps §59.4).
   - **Why now:** the DG-builder exerciser justifies un-deferring it; it's the headline beautiful-mechanics add (set-saturated graph algorithms); serves the whole language. With value-canonical iteration it also retires the `.sorted()` determinism tax.
   - Phase 0: confirm §59.12 design completeness + park any genuine fork (e.g. set-of-structs literal vs `.add`-only, the method-surface roster). Then mirror the S169 Map landing end-to-end.
   - **PARKED (sPA Phase-0 verdict):** the **un-defer is RATIFIED S222** (`docs/changes/compiler-reimagining-derisk-2026-06-26/RULING.md` §20; user-voice 10769) — build is warranted, supersedes the S170 deferral. But the **SHAPE is NOT build-ready**: §59.12 currently specifies NO set type ("B2-over-map ON THE SHELF"). No normative type grammar / literal decision / method roster exists. S170 (`set-warrant-and-shape-2026-06-06.md`) pre-leaned **B2** (set-as-`[K:unit]`-map alias) and ELIMINATED **A** (first-class type+literal) — **but A's elimination was conditioned on "zero adopter demand," and the S222 DG-builder exerciser is precisely the demand signal that re-opens A-vs-B2.** The ss37 list itself describes a richer-than-B2 surface (`.add` + method-form `.union`/`.intersect`/`.difference` + "literal syntax to confirm"), which straddles A and B2. Genuine design fork → cannot dispatch a build without the PA→user shape ruling (sPA must not rule / not author §59.12 normative text). Escalation developed in `handOffs/incoming/2026-06-26-from-spa-ss37-set-shape-fork-FOR-PA-RULING.md`. **After the shape ruling + §59.12 normative text, the build is mechanical** (mirror the S169 Map landing; ss38 HAMT already landed in main so the shared-§59-runtime sequencing constraint is satisfied — Set rides the HAMT rep).

---

## RULING (S222) — B2 RATIFIED · BUILD-READY

User ruled **B2 (map alias)** via AskUserQuestion. **§59.12 normative text AUTHORED** (SPEC §59.12 set bullet): `set[K]` desugars to the §59 map `[K: bool]`-marker; set-vocab surface (`.add`→`.insert(k,true)` · `.has`/`.remove`/`.size` · iteration=ELEMENTS · `.union`/`.intersect`/`.difference` methods DELEGATE to the shipped `scrml:data` value-canonical helpers — don't double the surface); empty `[:]`, NO set literal (accepted seam); inherits all §59 map semantics. **Build is now MECHANICAL** — mirror the §169 Map landing (D1–D4) as a thin DESUGAR (no new runtime/literal/codec). Item 1 status: parked → **BUILD-READY (B2 locked)**.

**CORRECTION (PA-verified):** the Phase-0 note's *"ss38 HAMT already landed in main"* is WRONG — only the ss38 LIST FILE is in `main` (`1ada2b3e`); there is NO HAMT in the runtime. **ss37↔ss38 sequencing is STILL LIVE** — build HAMT (ss38) + Set (ss37) in sequence (HAMT-first then Set-on-HAMT, OR Set-then-HAMT-both). Re-fire ss37 sequenced with ss38.

---

## LANDED (sPA, 2026-06-26) — item 1 = `landed-on-branch`

Build dispatched scrml-js-codegen-engineer (worktree, opus); landed onto `spa/ss37` @ **`70b11383`** (single squash commit; 19 files, +1047/-21). Branch tip == `70b11383`; `origin/main...spa/ss37` = `0 1` (1 commit ahead, no leak).

**Sequencing resolved (NOT a blocker):** B2 Set is a pure DESUGAR (`set[K]`→map `[K:bool]`; `.add`→`.insert(_,true)`; `.elements`/`<each>`→map `.keys()`; algebra→`scrml:data`). It adds NO new runtime structure → **rep-agnostic**: it rides whatever the map rep is (COW today, HAMT after ss38). Landing on COW now is explicitly sanctioned by the ss38 list ("if ss37 landed on COW, HAMT-swap map+set together"). **ss38 has NOTHING set-specific to do** — swapping the map rep automatically covers set (set is just map calls). The S25 "sequencing still live" concern is dissolved by the desugar architecture, not deferred.

**sPA verify caught + fixed (R26 adversarial):** the dev-agent's full-suite run (unit+integration+conformance subdirs — the same scope as the pre-commit hook) MISSED the top-level M6.5.b.0 within-node parser-conformance gate. On the TRUE full `bun test compiler/tests/` (25,689 tests), `examples/34-value-native-set.scrml` was over-budget (residual 191, no allowlist entry). Diagnosed as ORDINARY native-vs-within-node span/field divergence (class-distribution normal for an example this size; KIND-NAME only 3 — NOT a set-specific parser divergence; the parser was a verified no-op). Re-baselined per the brief mandate ("re-baseline within-node parity if fixtures shift"): added the allowlist entry → full suite **0 fail / 25474 pass**.
