# progress — s444-core-additions-dpa058-r2

- 2026-09-30 start; base 16221b99a + merge origin/main (2291df2b1). The merge also fixes main 3a4d869a3's
  protect-error-egress test pollution (sibling files leak a happy-dom GlobalRegistrator → unregister in beforeAll);
  without it the gate fails 5 tests on main itself.
- F1 (7be6bd062): the novalidate traversal carries a CarryCx; `<slot/>` in decl D's markup = the kids of every use
  of D (UseSite list, recursive through an enclosing decl's slot; inside a use's expansion the slot is that use's own
  kids, already visited). novalidate is ONE static attribute of D's markup → added when ANY use's slot content
  carries (⚑ PA: per-instance precision would need a per-instance attribute in Core). + F5a state-arm test.
- F2 + F3 + F5b (16f77eb86): declarations (and a `single` program cell) resolve before structuralOwner().
  F3: no SPEC sentence states a sequence index type (searched §66.12, §6.5, §14, §34 E-TYPE-031) — ⚑ PA; the bootstrap
  checks the index as `int` (E-TYPE-031, int enforced S440 JS-WAT 7(a)); a negative int is SPEC-silent → stays the
  runtime refusal (D4); runtime messages now distinguish "not a sequence position" from "outside (positions 0..n-1)".
- F4 (361de5e17): SPEC §48.6.2 makes a `fn` → `function` call E-FN-003 (the brief said E-FN-004; SPEC wins) — this
  closes the transitive clock hole for `fn` by construction. clockFns (syntactic fixpoint, over-approximating on
  shadowing) refuses a clock helper in initializer / markup / attribute / lambda-in-markup positions.
  F-s444-3 impl#1 dogfood: inside a `match` arm of a `fn`, the string text "pure `fn`" is emitted as
  "pure `function`" (repro: `fn a(h: H) -> string { return match h { .A :> msg("a pure \`fn\` body") .B :> "b" } }`).
- F6 + B3 site: second `bind:` refused (E-BOOTSTRAP-UNSUPPORTED; §5.4 silent, ⚑); a hand attribute contradicting a
  lowered one refused (same static text = OK; ⚑ §53.7.1's analogous `type` rule lets the derived win + warning);
  "replace not granted" message. B3: topLevelValidatorsLower() is the one flip site (verified both ways).
- DEFERRED (surfaced, not fixed — outside the findings): (a) a `fn` body writing outer cells (`fn p() { @n = 1 … }`,
  `@xs.push`, `@xs.pop()`, `@rows[0].qty = 2`) is CLEAN — §48.3.3 E-FN-003 is not enforced in the bootstrap at all
  (pre-existing); (b) two validators lowering to the same attribute keep the FIRST silently (`length(>2) length(==4)`
  → minlength 3 / maxlength 8, looser than ==4 — pinned by validators.test "the length comparisons"); the right
  lowering is the interval intersection (max of mins, min of maxes; two patterns → refuse); (c) `bind:value` with a
  hand `value="z"` on the same element is accepted.
- VERIFICATION (tree = 1d8aa86cf): lint 58/0 · slices m1–m4 984 pass / 1 todo / 0 fail · lowered m1 73/73 · v2-lexer 337/0
  · mutations.js FULL 318 rows, all RED, unmutated mirror clean (1115 s) · bite matrix CG 32 / CSS 32 / FRONT 20
  certified, 0 uncertified, exit 0 · top-level compiler/tests/*.test.js 6387 pass / 13 skip / 0 fail · gate 27257
  tests / 0 fail · s34-census --check-new PASS · facts --check PASS · regen-spec-index --check OK.
- R2-DONE — pushed as feat/s444-core-additions-dpa058-r2.
