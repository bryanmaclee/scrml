# progress s441-demo-blockers

- start: worktree verified, bun install + pretest ok (base cf62b4154)
- DEFECT 1 (W-LINT-007/013 on §5.2.3 inline-block handlers): reproduced (13 false lints on
  repro/d1-inline-block-handler.scrml); fixed in compiler/src/lint-ghost-patterns.js (tag-opener walk
  recognises `on<event>={` by the parser's isEventHandlerAttrName, steps over the block, block joins
  logic ranges). Test: compiler/tests/unit/lint-ghost-inline-block-handler-s441.test.js (13/18 fail on
  base, 18/18 after). Committed 78e529397.
- DEFECT 2 (§7.2.1 constructs at <program>/<page> body-top ship as page text): reproduced
  (repro/d2-*.scrml, all exit 0 + page text on base). Fixed by a grammar-head lift gate
  (`forbiddenConstructHead`) in ast-builder.js liftBareDeclarations + the native mirror
  parse-markup.js liftBareBlocks. Brace-delimited heads only (class / async function|fn / try /
  switch / for await). NOT covered: throw / await / dynamic import() / async arrow (braceless
  expression statements — the held §40.8 bare-statement limb).
- Migration measured: 2083 corpus files (examples 71, samples 877, conformance/cases 1070,
  readme-snippets 1, tutorial-snippets 11, stdlib 53) compiled before/after: 0 newly failing,
  0 code-set changes; gate traced: 0 corpus text runs hit the new lift.
- Tests: compiler/tests/unit/default-logic-forbidden-construct-lift-s441.test.js (64) + 6
  conformance cases. Full gate 26042 pass / 0 fail; conformance 1053/1060 + 7 xfail.
