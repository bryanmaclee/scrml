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
  - arm-pipe: newly refused in 9 files, all of which fail in place: 8 docs/changes repros and 1 test
    fixture (bootstrap-conformance-counter parse-info). That is 9 blocker entries, one per file,
    because arm-pipe refuses the whole file. Those files had held 15 arm rewrites.
    CORRECTION, round 2: this line first said "15 rewrites are now refused" without the blocker
    count. The reviewer counts 11 entries in 9 files. My all-rules run at 222b2a72e shows 11
    "does not compile" entries in total — 9 arm-pipe, 1 is-some, 1 given-presence — over 11 files.
    A first run also refused samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001, with
    E-PA-002, because the scratch copy lacked the sibling `test.db`. It compiles clean in place. The
    three verifies now mirror sibling .db/.sqlite files into the scratch project, as fix-sql-failable
    does, so that site rewrites again.
  - is-some: 1 rewrite is now refused, in conformance callback-prop-narrowing-ends-on-assign-reject
    (E-COMPONENT-PROP-WRITE, E-TYPE-031).
  - given-presence: 13 applied, the same as before. 1 reason changed: top-level-given-guard-return-neg now
    says it does not compile.
- Fix round code 8715aec4f (pre-commit 34730 tests / 0 fail). Merged origin/main 8b9cd9919 (#1398) as
  f0d49098f. FACTS and bootstrap-conformance conflicts were resolved by regen; both files are generated
  only. Pre-commit passed.
- Gates after the merge:
  - browser-baseline --check: PASS, 48 asserted.
  - integration+lsp+commands: 5643/0. top-level: 2239/0. e2e-render-map: 259/0.
  - s34-census --check-new: PASS. host-global-scan --check: 0 violations.
  - facts, spec-index, severity and bootstrap-conformance --check: current.
  - snippet-gate: 128/0. corpus-compile-floor: PASS.
  - corpus dry-run differential over 3650 files: identical to the pre-merge head run.

## S239 delta re-review round 2 (FIX on 222b2a72e)
- Four false accepts (t1, t3b, t6, t2): side effects reached through calls. The classifier now fails
  closed and decides from the AST:
  - an interpolation must be cell, field and index reads, literals and operators; there are NO calls
    and no interpolating template literals (isPureReadExpr);
  - a non-handler attribute value must be a plain value or a pure read;
  - any component use is refused;
  - the html-fragment text is scanned together with its `logic` holes; impl#1 splits `${...}` out of
    a fragment even inside a tag, as in `onclick=${f()}`;
  - handler attributes are not checked, because a handler does not run at render time.
  New refusal reason: "guard body evaluates a call or a component at render time, whose re-run
  frequency differs between the plain group and the arm selector".
- The repros now give these reasons:
  - "evaluates a call or a component": t1, t3b, t6, t2, a5, a9;
  - "has statements": a1, a1b, a7, and the outer guard of a4;
  - "does not compile": a3, a6, a8;
  - still rewritten: a2, and the inner guard of a4.
- Literal punctuation text between interpolations (a top-level bare-expr that impl#1 could not parse
  as code) is classified as text, not as a statement.
  - The "does not compile" check runs FIRST, through one compile of the original.
  - NEW FINDING: impl#1 lowers that text as code and emits `-;`, so a real build fails with
    E-CODEGEN-INVALID-LOGIC. The verify compiles with `write: false`, which skips the emitted-JS parse
    gate. fix-verify-shared.js now runs validateEmittedArtifacts itself, for all three rules.
  - All-rules corpus delta from that: the arm-pipe site in
    docs/changes/s441-audit-gap-filing/repro/error-handler-in-inline-handler-leaks-raw-bang-brace
    (line 24) is now refused. That file fails in place with E-CODEGEN-INVALID-LOGIC.
- The third accepted-difference text, "an interpolation is re-evaluated on its own reads", is removed:
  such bodies are now refused. The error-recovery browser test uses a throwing pure read
  (`@o.a.b`) instead of JSON.parse.
- All-rules corpus dry-run (fixS66 with the default IMPL1_SAFE_RULES, verify on, 3650 files),
  222b2a72e → this round: applied 3299 → 3298, blockers 1010 → 1010. The only removed rewrite is the
  error-handler-in-inline-handler arm above. Four other blockers changed wording only, adding
  E-CODEGEN-INVALID-LOGIC to the reported codes.
- Round 2 code commit a62bb31ae (pre-commit 34746 tests / 0 fail). The first attempt failed the
  P3-FOLLOW isComponent-routing lint; component detection now goes through isUserComponentMarkup.
- Merged origin/main f2284b72e (#1399) as 002a9e762. The FACTS conflict was resolved by regen.
  - The first merge-commit attempt failed one dev-server integration test with a 30 s timeout under
    load (dev-db-no-side-file). It passes alone, 26/0, and the retry passed pre-commit.
- Gates after the merge:
  - browser-baseline --check: PASS, 48 asserted, on the re-run. The first run was the known
    "PARSER DISAGREES" flake.
  - integration+lsp+commands: 5658/0. top-level: 2239/0. e2e-render-map: 259/0.
  - s34-census --check-new: PASS. host-global-scan --check: 0 violations.
  - facts, spec-index, severity and bootstrap-conformance --check: current.
  - snippet-gate: 128/0. corpus-compile-floor: PASS.
  - all-rules corpus dry-run on the merged head: identical to the pre-merge round-2 run
    (3298 applied, 1010 blockers).

## S239 delta re-review #3 (FIX on 27b2e9443)
- Two readers disagreed: the rule's local `/^on[a-z]/i` treated `one=` / `online=` as handlers (h1, h3:
  #hits 7 → 3). The rule now calls the compiler's isExecutableEventHandlerAttrName
  (attr-injection-sink.ts, NON_EVENT_ON_WORDS). h1/h3 refused; h2 (`onward=`) still rewritten.
- Self-closing void elements (`<input value=@m/>`, `<input oninput=track(@n)/>`) are read: the fragment
  scanner accepts `/>` and impl#1's re-spaced `/ >` (cheap text fix; attributes are still read from the
  fragment text, which is what impl#1 keeps for a guard body's top-level tags).
- The verify now refuses a rewrite whose own compile reports an error (b.errs, incl. the emitted-JS
  gate) — given-presence, is-some, arm-pipe. No natural corpus case triggers it; not separately tested.
- All-rules corpus dry-run: identical to round 2 (3298 applied / 1010 blockers).
- Merged origin/main 37e50e881 (#1399-#1403) as c374c0846. SPEC-INDEX, FACTS and bootstrap-conformance were taken from main and regenerated; my SPEC-INDEX changes had been line ranges and totals only. Pre-commit: 35099 pass, 0 fail.
- Gates after the merge, all run in the foreground:
  - browser-baseline: PASS. integration+lsp+commands: 5688/0. top-level: 2239/0. e2e: 259/0.
  - s34-census --check-new: PASS. host-global-scan --check: 0 violations.
  - facts, spec-index, severity and bootstrap-conformance --check: current.
  - snippet-gate: 128/0. corpus-compile-floor: PASS.
- All-rules dry-run: 3310 applied, 1011 blockers. Every delta from round 3 is in conformance cases new on main, under unwrap-logic and program-move; given-presence, is-some and arm-pipe are unchanged.
