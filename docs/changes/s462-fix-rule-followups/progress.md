# s462-fix-rule-followups progress

- [x] merged origin/main (already at 6e58dd9eb, includes #1392/#1395/#1397)
- [x] ITEM A (941673df4): fix-given-presence markup refusal lifted.
  - The refusal was not an explicit check: the verify compared emitted artifacts, and since #1397 a
    markup `${ if (@u is given) { … } }` takes the arm-selector group (`_scrml_lift_if_group`) while
    `given` keeps the plain group, so the two can never be byte-equal. New markup-guard compare: codes
    identical (minus the lint), non-client artifacts identical, each changed client lift group cut from
    both sides and checked (same presence names, one arm, anchored at the same data-scrml-logic id,
    at most one per rewritten guard), the arm-run appendix matched exactly
    (LIFT_BRANCH_RUN_BANNER/HELPER exported from emit-reactive-wiring.ts), rest identical after
    counter renumbering. Unknown shapes fail closed.
  - happy-dom before/after: compiler/tests/browser/browser-fix-given-presence-markup-s462.browser.test.js (5).
  - Conformance: given-presence-deprecated-markup description corrected; new twin
    condition/given-presence-canonical-markup-twin (fresh "bob").
  - Corpus (scratch corpus.mjs over 3640 tracked .scrml excl self-host-v2, before vs after):
    applied 9 → 13; +4 newly fixable, all deliberate deprecated-form conformance fixtures
    (given-presence-deprecated-markup, given-cell-guard-worked-example-{present,absent}-pos,
    given-cell-guard-multi-all-or-nothing-pos) — not migrated. Other 19 blockers unchanged.
  - Arm refusal reason text no longer names the resolved gap (states else-if vs else); lifting it is a follow-up.
- [x] ITEM B: client-server-call TRANSPORT_HANDLER → `!{ .Transport(_) :> return }` (only leave-arm emitter in compiler/src).
- [x] merged origin/main d6820a607 (#1393) → ba3fbf91b; FACTS conflict resolved by regen (only hunk was the table).
- [x] gates (post-merge): pre-commit 34724 tests / 0 fail; browser-baseline --check PASS (48 asserted);
  integration+lsp+commands 5631/0 pre-merge, lsp+commands 724/0 post-merge; top-level 2239/0;
  e2e-render-map 259/0; s34-census --check-new PASS; host-global-scan --check 0 violations;
  facts / spec-index / bootstrap-conformance / severity --check current; snippet-gate 128/0;
  corpus-compile-floor PASS; conformance run 1634 pass + 76 xfail of 1710.
