# progress — s444-core-additions-dpa058

- 2026-09-30 start at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a41b51d8ff7e85d9d (base 29eb80c31, branch feat/s444-core-additions-dpa058)
- 2026-09-30 BASELINE: slices m1+m2+m3+m4 = 819 pass + 1 todo, 0 fail; lint-no-default-arm 58 files / 0.
  Corpus instrument (scratchpad corpus.js: the front end over every conformance case dir + the slice-m4 §66.19 sources) saved as corpus-base.json.
- 2026-09-30 PA ADDITION (fail-open → fail-closed), unit 1:
  (1) analyze resolveElem: a scrml structural element the bootstrap does not implement → E-BOOTSTRAP-UNSUPPORTED
      (§4.15 / §24.4 "These element names SHALL NOT be treated as HTML elements"). Refused: request, poll, timer, timeout,
      machine, errorBoundary, db, schema, channel, onchange, auth, page, engine, onTransition, onTimeout, onIdle, errors,
      match, empty, render, outlet, column, formFor, tableFor, if, else, else-if, component, snippet, partial, foreign,
      endpoint, api, markup, defaults, keyboard, mouse, gamepad (lowercase compare). Implemented and NOT refused: each, slot;
      `<theme>` already refused by the parser; `<program>` parses as the program.
  (2) analyze namedInstanceDiags → openerWordDiags: a declaration-opener word other than `single` / a validator word
      → E-BOOTSTRAP-UNSUPPORTED naming it (persist= / key= → "§6.14 persist= is not in the bootstrap yet"), on user
      declarations, program cells and child fields at any depth; skipped inside a declaration holding a parse error
      (Rule C — debris). Put in analyze, not parse: a named shared instance's construction words (`<accent:swatch
      label=…>`) are not opener words (it is refused whole there).
  Tests: slice-m4/failclosed.test.js (42). slice-m2 typer.test BASE_66_19 block 7 (§66.19.6 Before, `<engine>`) re-pinned:
  refused whole now. Mutations: 5 rows (MUTATIONS_ONLY="s444 PA": 5 RED). mutations.js gained MUTATIONS_ONLY=<substr>.
  CORPUS: 242 case dirs changed, EVERY new diagnostic is a structural-element refusal (no opener-word refusal fired in
  the corpus). Previously-clean cases now refused (21): outlet/{class-id,recognized-clean,duplicate}, input/input-001-{neg,pos}
  (<keyboard>), auth/* ×9 (<auth>/<page>), schema/* ×5, api/{api-unknown-type-ref-neg,api-endpoint-malformed-neg}.
