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
    given-cell-guard-multi-all-or-nothing-pos) — not migrated. Blocker entries: 27 over 23 files before →
    23 over 19 files after (2 of the files under docs/changes). (CORRECTION, S239 review: the A commit
    message and the first report said "the other 19 blockers are unchanged" — the real figure is 23
    blocker entries over 19 files.)
  - Arm refusal reason text no longer names the resolved gap (states else-if vs else); lifting it is a follow-up.
- [x] ITEM B: client-server-call TRANSPORT_HANDLER → `!{ .Transport(_) :> return }` (only leave-arm emitter in compiler/src).
- [x] merged origin/main d6820a607 (#1393) → ba3fbf91b; FACTS conflict resolved by regen (only hunk was the table).
- [x] gates (post-merge): pre-commit 34724 tests / 0 fail; browser-baseline --check PASS (48 asserted);
  integration+lsp+commands 5631/0 pre-merge, lsp+commands 724/0 post-merge; top-level 2239/0;
  e2e-render-map 259/0; s34-census --check-new PASS; host-global-scan --check 0 violations;
  facts / spec-index / bootstrap-conformance / severity --check current; snippet-gate 128/0;
  corpus-compile-floor PASS; conformance run 1634 pass + 76 xfail of 1710.

## S239 review fix round (FIX on item A)
- F1 FALSE ACCEPT (a1b): markup guard bodies must be markup only (markupBodyIsPure: html-fragment /
  markup / lift-of-markup / interpolations holding one non-writing expression); otherwise refused with
  "guard body has statements whose re-run frequency differs between the plain group and the arm
  selector". Review repros a1, a1b, a3, a6, a7, a8 and the outer guard of a4 are now refused;
  a2, a5, a9 and the inner guard of a4 are still rewritten.
  The optional cut-body compare (modulo LIVE wrappers) was not done; refusing is enough.
- F2 VACUOUS VERIFY: new compiler/src/commands/fix-verify-shared.js; given-presence, is-some, arm-pipe
  (the three rules with the codes+artifacts verifyByCompile) refuse a file whose original compile has
  an error-severity diagnostic: "file does not compile; cannot verify (impl#1 reports … before the
  rewrite)". client-server-call / sql-failable / s66 have a different, codes-only gate (artifacts change
  by design) and legitimately target files carrying the error they clear (E-CPS-NEEDS-FAILABLE) — not
  changed; surfaced.
- F3 documented accepted differences (rule header + SPEC §63.7), and pinned both in the browser test
  (input keeps text+focus; recovery after a throwing read).
- F4 counts corrected (above).
- Corpus differential of the three rules, before (06463bb6b) vs after, 3644 tracked .scrml files with
  self-host-v2 excluded:
  - arm-pipe: 15 rewrites are now refused because the file does not compile (in place too). They are
    in 9 files: 8 docs/changes repros and 1 test fixture (bootstrap-conformance-counter parse-info).
    A first run also refused samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001, with
    E-PA-002, because the scratch copy lacked the sibling `test.db`. It compiles clean in place. The
    three verifies now mirror sibling .db/.sqlite files into the scratch project, as fix-sql-failable
    does, so that site rewrites again.
  - is-some: 1 rewrite is now refused, in conformance callback-prop-narrowing-ends-on-assign-reject
    (E-COMPONENT-PROP-WRITE, E-TYPE-031).
  - given-presence: 13 applied, the same as before. 1 reason changed: top-level-given-guard-return-neg now
    says it does not compile.
