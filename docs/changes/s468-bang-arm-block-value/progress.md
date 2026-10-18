# progress — s468-bang-arm-block-value (append-only)

- 2026-10-17T15:18 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a178b49c3b74474ed; branch
  `s468-bang-arm-block-value` from origin/main `5c43c3b8e`. `bun install` (puppeteer postinstall exit 1 — chrome
  download, unrelated), `bun run pretest` OK. Maps: read the refreshed 5c43c3b8e maps from the main checkout
  (worktree copies are stale 41af4153a, per coordinator).

- 2026-10-17T15:25 REPRODUCED on origin/main 5c43c3b8e (executed compile, both limbs). Client:
  `const ok = check(p) !{ .Denied :> { @msg = "d"⏎ false } }` lowers to
  `if (R.variant === "Denied") { _scrml_cs_reactive_set("msg","d"); false; }` then `var ok = R;` — R is the
  error envelope (truthy). Server function: same shape (`note = "d"; false;` then `var ok = R`).
- GOVERNING SENTENCE (§19.4.3, "Handling in a value position"): "In a value position, every arm SHALL do one of
  two things: 1. **Yield a value** of the call's success type: the arm is an expression, or a block whose last
  expression is that value (§18.5)." §18.5: "A block arm is `{ statement* expression? }`. The block's result is
  its **last expression**."
- LOCUS (traced): `compiler/src/codegen/emit-logic.ts` `case "guarded-expr"` arm loop → `emitArmBody` (client:
  `rewriteBlockBody` text; server: parsed statements, all emitted as statements) → `emitArmAssign`, whose
  multi-line / multi-statement branches emit statements only ("authors should assign to resultVar themselves").
  Hypothesis (codegen, value-position `!{}` guard emission) HELD; refined to that function.
- FIX: NEW `emitBlockArmValueToResult` — parses the block (`armBlockStatementsDetailed`), classifies the last
  statement with the shared §18.5 tail rule (`_blockTailIsValueExpr`, the match block-arm classifier — not a new
  text scan), lowers leading statements via `emitLogicNode`, assigns the tail (emitted from its node; server via
  `serverArmExprNode`) to the result slot; a tail handled call yields its handler's result slot. Spans of the
  re-parsed arm anchored at the arm (log() file:line). Non-value-tail arms: unchanged path.
- DIRECTION: semantics-changed (a value-position block arm now yields its value, as SPEC says). Not
  newly-rejecting/accepting. Corpus emit-differential (base = same tree with the helper disabled via a temporary
  env switch, since removed): 2847 sources / 8578 artifacts — NO DIFFERENCES.
- security-await-pack classify: before FAIL=10, after FAIL=10, identical FAIL set (0 new).
- Out of scope, found: an expression-position handler's arm text is token-joined (newlines lost), so a
  newline-separated block arm inside an expression is refused E-CODEGEN-INVALID-LOGIC (fails closed); base same.

- 2026-10-17 FIX ROUND 1 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a5e6dd9019709b315 on existing branch s468-bang-arm-block-value, HEAD 684420b36 asserted. bun install (puppeteer postinstall exit 1, unrelated), pretest OK. Briefs appended to BRIEF.md.

- 2026-10-17 FIX ROUND 1 — REPRODUCED (executed under happy-dom, reviewer shapes re-run on `684420b36` via
  `~/.cache/scrml-agent-tmp/s468-bang-arm-block-value/h/run.mjs` + `f1.mjs`): with a WRONG password every one of
  `{ @note = "d"⏎ !yes }`, `!true`, `true && check(p) !{…⏎ !yes }`, `{ @note = "d"⏎ 0 }`, `{ @note = "d"⏎ "" }`,
  `{ plain(1)⏎ @note = "d"⏎ 0 }`, `{ plain(1)⏎ !yes }`, the nested block-armed `!{}` (newline and `;` forms) and
  `{ const y = check2(p) !{ .Locked :> {…⏎ false }⏎ .Denied :> false }⏎ y }` printed "LOGGED IN". The same texts in a
  server function: E-STMT-UNEXPECTED-TOKEN (fails closed) — confirmed.
- WHY THE READER REFUSES (traced): `armBlockStatementsDetailed` → `parseStatementTextDetailed` (the function-body
  parser) reads `@note = "d"⏎ 0` as ONE statement — impl#1's collector (ast-builder `collectExpr`, BUG-ASI-NEWLINE)
  breaks a statement at a newline only when the next token is an IDENT / KEYWORD / `@` / `{` / `<decl`; a NUMBER,
  STRING, `!` or `[` joins the line above — and the strict check (`unreadableContentIn`, lost trailing content)
  refuses it. In a plain function body the same join silently DROPS the line (`@note = "d"⏎ !se()` never calls
  `se()` — executed); that is the unbuilt §7.2.2 rule 5 in impl#1, `g-dpa063-termination-unbuilt-impl1-legacy`
  (HIGH, open) — not taught here: it changes statement boundaries in every function body (a language-wide parser
  change with its own corpus migration), not an arm-reader fix. The nested-handler refusal had a DIFFERENT cause:
  the strict check judged the nested arm's `handlerExpr` — the builder's EXPRESSION reading of the arm block's
  inner text (`_parseHandlerExpr`), which no emitter uses for a braced arm and which loses every statement after the
  first. That one IS taught by construction (below).
- GOVERNING SENTENCES. §19.4.3 "Handling in a value position": "In a value position, every arm SHALL do one of two
  things: 1. **Yield a value** of the call's success type: the arm is an expression, or a block whose last expression
  is that value (§18.5). … 2. **Leave** … An arm that does neither … **falls through**, and in a value position that
  SHALL be a compile error". A value position: "the initializer of a `let` / `const` / `lin` or state declaration …,
  the right-hand side of an assignment …, a function argument, a `return` operand, an operand of an operator … — any
  position whose result is read." §7.2.2 "Terms": a statement list includes "a `{ … }` match or `!{}` arm block";
  rule 5: "A line whose first token can start an expression — `(`, `[`, a template literal, a regex literal, `!`, an
  identifier, a literal, … — SHALL begin a new statement."
- FIX (1, HIGH): `codegen/arm-structure.ts` `refuseUnreadableValueArm` + `emit-logic.ts` guarded-expr arm loop: when
  the handler's result is used (`bindingName` | `return` | `yield` | a cell write | an expression-position guard |
  an `assign` bare-expr) and a non-empty braced arm is refused by the reader, the CLIENT records
  E-STMT-UNEXPECTED-TOKEN (or the front end's own code) naming the arm (`the \`.Denied\` arm of a \`!{ }\` handler
  whose result is used (a value position, §19.4.3)`) and the text no statement begins at, and emits an inert
  `resultVar = null` placeholder — never the text fallback. Statement position unchanged (the arm's result is not
  read). Server unchanged (its reader already refused).
- FIX (1b, root, by construction): `validators/defer-structure.ts` `unreadableContentIn` reads a nested `!{}` arm
  with a braced body as a statement list (same strict parser) instead of judging its `handlerExpr`. The nested
  shapes are now READ: client executes wrong=rejected / right=LOGGED IN for all three; a nested arm whose own block is
  unreadable is still refused. Server: the nested form now compiles (was E-STMT-UNEXPECTED-TOKEN) — direction
  newly-accepting under §7.2.2 "Terms" + §19.4.3/§18.5. Executed: a nested call to a SAME-FILE server function
  inside a server arm throws `check2 is not defined` (500, fails closed) — pre-existing on origin/main `5c43c3b8e`
  for the already-readable flat shape too = open `g-server-match-arm-same-file-peer-call-not-defined-s465`.
- FIX (2, LOW): ast-builder `joinArmHandlerParts` (one helper for the three `!{}` arm join sites; text unchanged)
  records a non-enumerable `handlerSrcMap` ([textOffset, sourceStart, sourceLine] per token); `emit-logic.ts`
  `_anchorSpansAt` maps each re-read STATEMENT's probe offset (`PROBE_BODY_OFFSET`, exported from defer-structure)
  to its own source offset/line; expression nodes take their statement's position; a nested arm's map is remapped.
  Executed: `log()` on lines 20 / 22 (after a blank line) / 23 (inside an `if`) print app.scrml:20 / :22 / :23
  (client and server; was :20 for all).
- DIRECTION: (1) newly-rejecting (client, value position, unreadable arm — each such program miscompiled: the arm's
  value was dropped); (1b) newly-accepting on the server, value-correct on the client; (2) inert except `log()`
  file:line. CORPUS (scripts/corpus-emit-differential.ts, roots examples,samples,conformance/cases,stdlib; base =
  `684420b36` archive, head = this tree): 2840 sources, 1700 compile both sides, 0 newly failing, 0 newly passing,
  0 diagnostic-code / text changes, 8562 artifacts; 167 differ and ALL 167 differ only in the embedded
  `_scrml_project_root` path of the two capture trees (checked line-by-line) — 0 real sites.
- GATES: new tests `compiler/tests/unit/bang-arm-block-value-s468-r1.test.js` (26 cases; 22 fail on `684420b36`, the 4 passing
  are the unchanged-behaviour controls); prior `bang-arm-block-value-s468.test.js` 23/23. security-await-pack
  classify: base FAIL=10, head FAIL=10, identical FAIL set (0 new). `bun conformance/run.ts`: 1724/1795 both sides,
  identical non-PASS set. First full-suite run surfaced 2 regressions (`s441-async-escape-f4-f5` A2/B2: a nested
  `!{}` arm ending in `return` was refused by the first cut) — fixed by 1b (the reader now reads it).
- RECORDED (not fixed here, per brief): value-position arms whose tail is `if … { true } else { false }`, `{ false }`
  or `x = false` FALL THROUGH (wrong password logs in, executed) = open `g-impl1-value-position-arm-fallthrough-s451`
  (E-ERROR-012 unbuilt). SAME CLASS, NOT BENIGN: a tail line starting `(` / template / `(() => …)()` joins the line
  above (`@note = "d"⏎ (false)` reads as one write) and so also falls through — executed: wrong password LOGS IN on
  `5c43c3b8e`, `684420b36` and this head (`tail-paren`, `tail-lambda-call`, `tail-tmpl`). Benign changes from round 0
  confirmed: an arm with `fail` inside an `if` now compiles correctly (`fail-lead-if`: rejected / LOGGED IN); a
  leading line starting `(` / `[` / template joins the previous statement as in function bodies.
- NEW GAP FILED: `g-derived-cell-ignores-bang-handler-s468` (HIGH) — reproduced on `684420b36` and this head:
  `const <okc> = check(@pw) !{ .Denied :> false }` → `@okc` truthy with a wrong password (the derived thunk
  recomputes `check(@pw)` with no handler; the arms only touch `_scrml_cs_derived_declare(...)`'s return). Not fixed.
