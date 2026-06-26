# ss37 — value-native Set (§59.12 un-defer) — SURVEY-FIRST feature

**Fill-note:** un-defer **§59.12 Set** — a value-native Set type, sibling of the §59 value-native Maps. It was **design-deferred "for lack of an exerciser"**; the DG-builder de-risk slice IS the exerciser (graph algorithms are set-saturated — DFS visited/coloring, reader-sets, fixpoint membership), and it's the headline mechanics-beauty add for narrow-Road-B (kills the model-sets-as-arrays verbosity). **SURVEY-FIRST** — confirm the §59.12 design is complete enough to build, mirror the §59 Map landing (S169), **park any genuine design fork for the PA→user.**

**Shared ingestion:** the §59 value-native Map machinery is the TEMPLATE — the value-canonical hasher, the COW/reassignment-canonical model, the lossless codec, order-independent `==`, the type-system recognition, the codegen lowering. Set is a one-value-per-entry sibling of Map. SEQUENTIAL within-list.

**coreFiles:** the §59 Map impl as the template — `compiler/src/type-system.ts` (map/set recognition + key-comparability) · the runtime (value-canonical hasher + the Map structure → a Set structure) · `compiler/src/codegen/` map lowering (→ set lowering) · the legacy + native literal parsers. SPEC §59.12 (PA ratifies any normative additions).

**Brief reminders:** SURVEY-FIRST — Phase 0 confirms §59.12's design is build-ready (literal syntax, method surface — `.has`/`.add`/`.remove`/`.union`/`.intersect`/`.difference`/`.size`, value-canonical hashing reuse, COW, structural order-independent `==`, iteration order via value-canonical/`@ordered`). Mirror the S169 Map landing shape (D1 type-recognition + D2 literal parser + D3 runtime + D4 codegen). R26 (compile + `node --check` + runtime correctness, as Maps were verified). Re-baseline within-node parity if fixtures shift; FULL `bun run test` before DONE. New §59.12 normative text → PA ratifies.

## Items

1. **value-native Set §59.12 (un-defer)** (Nominal → build) `[status=open]` **SURVEY-FIRST**
   - The Map sibling: value-canonical-hashed, COW (`@s = @s.add(x)` reassignment-canonical, bracket-write rejected à la `E-MAP-BRACKET-WRITE`), structural order-independent `==`, value-acyclic (no set-of-cyclic-keys, like maps §59.4).
   - **Why now:** the DG-builder exerciser justifies un-deferring it; it's the headline beautiful-mechanics add (set-saturated graph algorithms); serves the whole language. With value-canonical iteration it also retires the `.sorted()` determinism tax.
   - Phase 0: confirm §59.12 design completeness + park any genuine fork (e.g. set-of-structs literal vs `.add`-only, the method-surface roster). Then mirror the S169 Map landing end-to-end.
