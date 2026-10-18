# unit-id: s468-structural-eq-everywhere
Gap: `g-structural-eq-emitted-as-strict-eq-outside-typed-fn-bodies-s464` (MED). `==` lowers to `_scrml_structural_eq` only
in the typed function-body form; elsewhere it is emitted as `===` (wrong for structs/enums/maps). Locus searched:
emit-expr.ts, emit-event-wiring.ts (== lowering). Governing: §45 (single `==`, structural) — quote. This is
semantics-changed for struct/enum operands: run the corpus differential and inspect EVERY artifact diff (each should
be `===` → structural-eq on a non-primitive operand). Cover: handlers, markup interpolation, derived cells, `if=`,
`<each>` filters, `!=`, primitives (may stay `===` only if provably primitive — say how you prove it).
