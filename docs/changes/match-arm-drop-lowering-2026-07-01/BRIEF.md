# BRIEF — match-arm-drop lowering fix (F2/F3/F6) (S234, 2026-07-01)

The self-host-v2 lexer dogfood surfaced a `match`-arm-drop FAMILY — `match` drops arms in three
shapes, filed `g-match-lowering-arm-drop` (MED; **F3 is a SILENT soundness drop**). Fix the family,
prioritizing F3. These are LIVE-compiler bugs affecting all scrml `match` users, not just self-host.

## The three shapes (repros in `compiler/self-host-v2/progress.md` F2/F3/F6; RE-CONFIRM on current main 8c8ef0aa)
- **F2 — int-literal arms (LOUD):** `match n { 61 :> "eq"  40 :> "lp"  _ :> "other" }` → `warning:
  statement boundary not detected` + `E-CODEGEN-INVALID-JS` (the int-literal arms DROPPED, leaving a
  bare `else`). STRING-literal single arms (`match s { "if" :> 1 … }`) work. Likely PARSE-layer (the
  int-literal arm-pattern isn't recognized as an arm).
- **F3 — product-match literal-in-tuple-slot (SILENT / soundness — THE PRIORITY):**
  `match (a, b) { (.LParen, 0) :> …  (.Num(v,r), _) :> …  (_,_) :> … }` SILENTLY DROPS the
  `(.LParen, 0)` arm from the lowered JS (only the variant arms emit) → valid-but-WRONG output, NO
  diagnostic. enum×enum product-match works. Likely CODEGEN-layer (arm parsed but not lowered).
- **F6 — `|`-alternation arms (LOUD-ish):** drop when the alternatives are STRING literals
  (`"const" | "let" :> …`) OR any alternative is a PAYLOAD pattern (`.Ident(_) | .Num(_) :> …`) →
  bare `else` → parse-desync / `E-CODEGEN-INVALID-JS`. NULLARY-enum alternation (`.A | .B :> x`) works.

## Approach
- **Phase 0 — reproduce all 3 on current main 8c8ef0aa + classify the LAYER per shape.** For each:
  does the arm survive to the AST (inspect the parsed match node's arms) but not the emitted JS
  (F3-shape = codegen), or is it dropped at parse (F2/F6-shape)? Report the layer per shape in
  progress.md BEFORE fixing. Study: the value-`match` parser (`ast-builder.js` match-arm collection /
  the arm-pattern grammar) + the codegen `emitMatchExpr` (`compiler/src/codegen/emit-match.ts`).
- **Fix each shape at its root. F3 (silent) is the PRIORITY** — a silent arm-drop is a soundness bug;
  get it fixed for certain. F2/F6 are LOUD (fail-closed) → fix if tractable in the same arc; if a shape
  has a big/divergent root, fix the tractable ones + report the rest precisely (do NOT force a
  half-fix). The three may have DISTINCT roots (int-literal pattern grammar · product-slot literal
  lowering · alternation with non-nullary alternatives).
- **MUST-NOT-BREAK set (regression-guard — currently working):** string-literal single arms · enum×enum
  product-match · nullary-enum alternation · the ENTIRE existing `match`/`!{}` corpus. After the fix,
  verify these AND construct ADVERSARIAL match shapes (S215) — the fix must not drop or mis-lower any
  currently-working shape.
- Do NOT touch the self-host-v2 lexer (it uses workarounds for these — F2 string-dispatch, F6
  avoid-alternation; a separate simplification later). Note if the fix would let the lexer drop a
  workaround.

## Regression tests (per shape + guard)
F2 int-literal arms lower correctly; **F3 product-literal-slot arm EMITS (not dropped)** — assert the
emitted JS contains the arm; F6 string/payload alternation lowers. Plus the must-not-break shapes.
Update `docs/known-gaps.md` `g-match-lowering-arm-drop` to resolved (or partially, naming which
sub-shapes) at the end.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Worktree under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` MUST start with that prefix (else STOP — S90). Save WORKTREE_ROOT. Base may be behind main —
   `git -C "$WORKTREE_ROOT" merge --ff-only main` to pull to 8c8ef0aa (S112).
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT; clean; `bun install`; `bun run pretest`.
Edits via **Bash** on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/` — NEVER Edit/Write,
NEVER main-rooted paths, NEVER `cd` into main (`git -C "$WORKTREE_ROOT"`, `bun --cwd`). First commit
message includes verbatim `pwd` (S99).

# MAPS — `.claude/maps/primary.map.md` first (Task-Shape: compiler-source bug fix). ~5 commits stale —
verify vs live source. Report load-bearing or not.

# COMMIT + REPORT
Incremental commits (`git -C "$WORKTREE_ROOT"`). Full `bun run test` GREEN before DONE (per-shape
regression + zero regressions; the ~26k suite may exceed 5min under load but still land, S164 — verify
HEAD/tree post-hoc); never `--no-verify`. Report: WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the
per-shape LAYER classification · which of F2/F3/F6 are FIXED (and which deferred + why) · the
adversarial must-not-break verification · known-gaps status update.
