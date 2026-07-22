# BRIEF — per-chunk id/cell namespacing

Full scoping: [`SCOPING.md`](./SCOPING.md)

**Status (S280): DISPATCHABLE — nothing built.** All three OQs ruled by bryan. This arc is the REAL gate for cross-chunk soft-nav (adopter #27); it replaces the falsified S279 Option-B framing and is module-format-AGNOSTIC, so landing it unblocks BOTH the held classic Wave-1c loader and ESM U4.

**Ruled:** token = FNV-1a of the dist-relative source PATH (base36, 8 chars) · ALWAYS-ON · one-time byte churn gated by an artifact-diff asserting only id tokens moved, classified `semantics-changed` per §8.

**Two independent namespaces collide** — numeric node ids AND source-name-keyed cell keys. Fixing either alone still clobbers. ~390 touch points across 8 files.

**Verification trap:** `docs/website` is the wrong corpus and `examples/23-trucking-dispatch` does not collide BY LUCK (its pages differ in node count). A purpose-built colliding fixture is mandatory; the acceptance test is `origin/evidence/u4-premise-falsified` flipping to isolated, executed in a browser, under both module formats.

DONE-PROBE: grep -qE "namespaceToken|chunkNamespace" compiler/src/ast-builder.js
