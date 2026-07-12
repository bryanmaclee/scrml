# BRIEF — string-blind scanners: TOKENIZER/AST-based fix (S252 · fresh, post-S244-revert)

**Change-id:** `string-blind-scanners-tokenizer-2026-07-12` · **Agent:** scrml-js-codegen-engineer (iso:worktree) · **Base:** main @ `40b580c5`
**Gaps:** `g-route-inference-signals-string-blind` (#2) + `g-is-predicate-scanner-regex-literal-blind` (#1), both MED open.

## ⛔ READ THIS FIRST — the S244 revert lesson (do NOT repeat it)
S244 tried to fix these with a shared **raw-text literal-masking scanner** (`literal-scan.ts`) — **REVERTED TWICE**, each round the S239 adversarial gate caught a NEW **security false-negative** (a real server-only / is-predicate fire site got masked → leak): round 1 `of / x` masked as regex; round 2 `return /re/` not masked + `x++ / process.env` over-masked → server token leaked to client (regressed E-CG-006). **ROOT: regex-vs-division is UNDECIDABLE from raw pre-tokenized text.** So:
- **DO NOT** rebuild / reuse / extend the reverted `literal-scan.ts` or ANY raw-text char-scan heuristic.
- **The current false-positives are SAFE** — a loud over-fire on VALID code, NO leak. A false-NEGATIVE (missing a real fire site) is a **security leak — strictly worse**.
- **THE ACCEPTANCE BAR (load-bearing):** land a fix ONLY if it is **provably leak-free**. If you cannot make a scanner provably safe, **LEAVE IT OPEN and report why** — that is the CORRECT outcome, not a failure. A safe FP beats a leaky fix.

## The two fixes — DIFFERENT approaches (tokenizer/AST, never raw text)

### #2 `g-route-inference-signals-string-blind` — do this FIRST (the clean win)
`route-inference.ts` §12.2 server-only-signal detection matches `Bun.*`/`process.*` (+print) over **raw source text** → a CLIENT fn that merely MENTIONS `Bun.serve(` in a string/comment spuriously server-escalates (then cascades to E-CPS-NONIDEM-NO-STORAGE). **route-inference runs POST-PARSE and already has AST access** — see `exprNodeCallsPrintBuiltin` (:543), an ExprNode-based detector. **FIX: make the server-only-signal detection AST-NODE-based** — detect a real call/member node (`Bun.serve(...)` as a MemberExpr/CallExpr in the AST), NOT a raw-source substring. This eliminates the string/comment blindness AND the shadow-blindness edge by construction (no regex-vs-division problem exists on the AST path). Mirror the `exprNodeCallsPrintBuiltin` shape for the `Bun.*`/`process.*` signal set.

### #1 `g-is-predicate-scanner-regex-literal-blind` — CHARACTERIZE first, fix only if provably safe
`rewriteIsPredicates` (`expression-parser.ts:1259`) is a **preprocess-stage rewrite** (runs BEFORE acorn) that reads the word `is` inside a regex/string literal (`/there is no.../i`) as the `is` operator → false `E-EQ-005` on valid code. It is NOT literal-aware.
- **CHARACTERIZE:** there is an EXISTING **"shared regex/comment/string fence" (GITI-017, `expression-parser.ts:19`)** that `preprocessForAcorn` already uses. Determine: (a) does that fence correctly track **preceding-token context** to decide regex-vs-division (the crux)? (b) can `rewriteIsPredicates` be routed through it to skip literal/comment interiors? 
- **IF the GITI-017 fence is sound** (context-tracking, not another raw-char heuristic): route `rewriteIsPredicates` through it (skip `is` inside fenced literal/comment spans). Then adversarially prove leak-free (below).
- **IF the fence is ALSO regex-vs-division-blind** (or routing it in can't be made provably safe): **LEAVE #1 OPEN.** Report the exact reason. Do NOT ship a heuristic. (The FP is safe; a leak is not.)

## Adversarial self-verify BEFORE you claim DONE (the S239 gate caught 2 FNs — beat it yourself first)
For EACH scanner you touch, construct and compile test inputs proving NO NEW false-negative:
- The 3 S244 failure modes: `of / x` (false-regex-open), `return /re/` (false-division), `x++ / process.env` / `x++ / server.call` (over-mask). Confirm each still correctly fires the real signal where it should.
- Confirm a REAL server-only signal in actual code (`function f() { Bun.serve(...) }`) STILL escalates (#2) and a real `X is 0` still fires E-EQ-005 (#1) — i.e. you fixed the FP without killing the true-positive.
- Confirm the original FPs are GONE: `function setClient(){ @msg = "docs mention Bun.serve(x)" }` stays client (#2); a regex `/there is no.../i` no longer fires E-EQ-005 (#1).
Record the before/after matrix in `progress.md`. The PA runs an independent S239 adversarial review before landing — but you must clear your own first.

## MAPS — REQUIRED FIRST READ
Read `$WORKTREE_ROOT/.claude/maps/primary.map.md` in full; follow Task-Shape Routing for a compiler-source bug fix. Maps reflect HEAD `fbb4d9fd` (2026-07-09); HEAD is `40b580c5` — verify against current source. Report which maps were load-bearing.

## STARTUP + PATH DISCIPLINE (S99/S126)
1. `pwd` MUST start `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90). Save WORKTREE_ROOT. 2. `git rev-parse --show-toplevel`==WORKTREE_ROOT. 3. clean. 4. `bun install`. 5. `bun run pretest`.
- **Bash-edit on WORKTREE_ROOT-absolute paths** (perl/python/heredoc), echo path before, `git diff` after. NEVER Edit/Write a main-rooted path; NEVER `cd` into main (`git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`). First commit msg includes `pwd`.
- **STAY IN THE TWO FILES** (`route-inference.ts`, `expression-parser.ts`) + their tests + conformance. Do NOT touch ast-builder/type-system/symbol-table/emit-*/SPEC §38.
- ⚠️ **CONCURRENCY:** a sibling dispatch (typer Option-D) concurrently owns the `classifyLiteralFromExprNode` region of `expression-parser.ts` (~4369-4407). Your work is the `rewriteIsPredicates` (:1259) + GITI-017 fence (:19) region ONLY — do NOT touch ~4369. Region-disjoint by construction; the PA 3-way-merges the two branches at re-integration.

## DISCIPLINE
- Incremental commits (don't batch) + `docs/changes/string-blind-scanners-tokenizer-2026-07-12/progress.md` after each step. Coupled code+test = one commit. §34 rows land WITH impl (Rule 4).
- Gate: full `bun run test` green before DONE (foreground). NEVER `--no-verify`.
- **Land on your branch; DO NOT push; DO NOT touch main.** Ping PA inbox `/home/bryan-maclee/scrmlMaster/scrml/handOffs/incoming/` with: change-id · which scanner(s) FIXED vs LEFT-OPEN (+ why) · files · branch tip SHA · the adversarial before/after matrix. Expect the PA's independent S239 review before re-integration.
