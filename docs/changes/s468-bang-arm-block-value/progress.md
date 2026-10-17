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
