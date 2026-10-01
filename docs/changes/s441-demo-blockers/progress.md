# progress s441-demo-blockers

- start: worktree verified, bun install + pretest ok (base cf62b4154)
- DEFECT 1 (W-LINT-007/013 on §5.2.3 inline-block handlers): reproduced (13 false lints on
  repro/d1-inline-block-handler.scrml); fixed in compiler/src/lint-ghost-patterns.js (tag-opener walk
  recognises `on<event>={` by the parser's isEventHandlerAttrName, steps over the block, block joins
  logic ranges). Test: compiler/tests/unit/lint-ghost-inline-block-handler-s441.test.js. Committed 78e529397.
- ⛔ DEFECT 2 fix — WITHDRAWN — superseded by bryan's S441 ruling. bryan rejected the body-top
  grammar-head lift as brittle (a prose-vs-code pattern matcher; `try`⏎`{`, throw / await / import()
  all still leak) and ruled the ROOT instead: `<program>` / `<page>` bodies carry no loose prose —
  prose must be declared (an element or a `"..."` literal). That is a separate SPEC + implementation
  arc. All Fix-2 source, tests and conformance cases were reverted to origin/main on this branch;
  the notes below and repro/d2-*.scrml are kept as evidence for the root arc.
- DEFECT 2 (§7.2.1 constructs at <program>/<page> body-top ship as page text): reproduced
  (repro/d2-*.scrml, all exit 0 + page text on base). Fixed by a grammar-head lift gate
  (`forbiddenConstructHead`) in ast-builder.js liftBareDeclarations + the native mirror
  parse-markup.js liftBareBlocks. Committed 607ab167e; FACTS 29b337620.

## Review round (PA verdict LAND-WITH-NITS on 29b33762)

- merged origin/main (edc2bdecb).
- Fix 2(a) prose-with-braces: the recognizer now needs a COMPLETE block — head + `{` on one line, a
  matching `}` inside the text run, no tag-shaped markup in the body, a single-line body that is empty
  or statement-shaped (`(` `=` `;` `@` or a statement keyword), only whitespace/`;` after the `}`;
  `try` must be followed by `catch`/`finally`; `switch` body must hold `case …:`/`default:`; `class`
  needs a NAME and `extends` a single identifier/dotted path; `for await` needs `(<binding> of <expr>) {`.
  `try {this} at home`, `class {A} notes`, `class Room extends the house {with} doors`,
  `switch (on) {the lights} now`, `try { <b>bold</b> } at home` all stay text (both pipelines).
- Fix 2(b) same-line: head through `{` may not cross a newline (`class Notes⏎{today}` stays text).
- Fix 2(c) scope: gate is now `isDefaultLogicBody || isFileRoot` in BOTH pipelines. `parentType === null`
  was dropped as the file-top test because `buildAST` / `nativeParseFile` are re-entered on fragments
  (`<match>` arm bodies, engine/error-boundary/component bodies) whose top is also null — that is how the
  live gate fired in `<match>` arms. A real file's top is now marked explicitly:
  `buildAST(bs, tok, { fileRoot: true })` from api.js's per-file TAB call, and
  `nativeParseFile(path, src, { fileRoot: true })` from api.js (native pipeline) and forbidden-js-native.
  FOLLOW-UP (not lifted, unchanged from base): `<match>` arm bodies, engine state-children, state-block
  (`<db>`/`<state>`) bodies — each has its own open body-mode question (§4.18 code-default loci).
- Fix 1 boundary: an `on<event>={` handler is recognised after any attribute boundary the scanner
  accepts — whitespace or the close of the previous value (`"` `'` `}` `)` `]`), e.g. `class="a"onclick={…}`.
- Accepted nits (per PA): nit 6 — an UNTERMINATED handler block (`onclick={ @x = 1 >a</button>`) makes
  `findMatchingClose` swallow to EOF, suppressing ghost lints in the rest of the file (the file already
  fails E-CTX-003). nit 7 — `onx={…}` is treated as a handler block, matching the compiler's own
  `isEventHandlerAttrName` (`/^on[a-z]+$/i`).
- RESIDUAL (stays page text, as on base): code that fails a rule — `try { x }` with no catch,
  `class A { x }`, `switch (x) { }`, braceless `for await (…) stmt`, a class/function body containing
  markup; a construct below a prose line in the same run; braceless `throw` / `await` / dynamic
  `import()` / `async (…) =>` (the held §40.8 bare-statement limb).
- Corpus differential (origin/main vs branch, 2098 files: examples 71, samples 877, conformance/cases
  1077, readme-snippets 9, tutorial-snippets 11, stdlib 53; errors + warnings + lint streams):
  - 0 pre-existing files newly fail; 0 error/warning set changes in pre-existing files. The only
    newly-failing files are this change's 5 new expected-error conformance cases.
  - 54 files change ONLY in the lint stream, all removals: W-LINT-007 −113, W-LINT-013 −87, every one
    inside an `on…={ … }` block (51 conformance/cases/markup-handler + derived, 3 docs/readme-snippets/nerdme
    added by the main merge). CORRECTION to the first report: "0 code-set changes" measured errors only;
    the lint stream DID change (51 files at 29b33762, 54 after the merge).

## Final shape (after the S441 ruling)

- Branch carries Fix 1 ONLY: compiler/src/lint-ghost-patterns.js + its unit test
  (compiler/tests/unit/lint-ghost-inline-block-handler-s441.test.js), incl. the attribute-boundary nit.
- Expected corpus diagnostic diff vs main: exactly the W-LINT-007/013 removals inside `on…={ … }` blocks.
- MEASURED at eed298e8a vs origin/main 55a9f3d5c (only compiler/src/lint-ghost-patterns.js differs),
  2095 files, errors + warnings + lint streams: 0 newly failing, 0 newly passing, 0 error/warning
  changes; 60 files change ONLY in the lint stream, all removals (W-LINT-007 −125, W-LINT-013 −100),
  every file containing an `on…={ … }` block (conformance/cases/markup-handler 50, derived 1,
  docs/readme-snippets 3, docs/tutorial-snippets 6). Suite 25986 pass / 0 fail; conformance
  1047/1054 + 7 xfail (== main).
