# unit-id: s468-failable-alias-and-match
Gaps (one unit, E-ERROR-002 family — read both entries in full):
1. `g-failable-alias-through-operator-or-returned-fn-s467` (MED) — the value-position failable check follows bare-name
   aliases only; an alias through an operator or a returned function escapes E-ERROR-002. Locus: type-system.ts
   checkFailableCallsInValuePositions + compiler/src/failable-value-calls.ts.
2. `g-match-failable-subject-through-operator-miscompiled-s467` (MED) — match lowering recognizes a failable subject only
   when the subject IS the call; otherwise emits `_scrml_match_N === "Denied"`. Locus: codegen match lowering.
Governing: §19.4.3 (+ the S467 #1431 ruling: an unhandled failable call used as a value is E-ERROR-002) — quote.
Root over positions: if it is round-by-round alias shapes, judge by the value's TYPE (does it carry a failable
result) rather than by syntactic alias chains — say which you did and why.
