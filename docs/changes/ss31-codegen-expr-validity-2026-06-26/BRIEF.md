# Dispatch BRIEF — ss31: codegen expression / JS-validity (3 bugs, SEQUENTIAL)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus · **change-id:** ss31-codegen-expr-validity-2026-06-26
**Land target (sPA-side):** `spa/ss31`. **Stated base:** local `main` == origin/main `db1e3ba8`.

THREE emitted-expression bugs that produce invalid JS. ALL live in the expression serializers + enum lowering — ONE shared ingestion surface. **SEQUENTIAL within-list — do them in order B1 → B2 → B3, ONE commit per bug.** They edit the same files; do NOT interleave.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
## Startup (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP. Save WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **BASE-CURRENCY (S112):** `git -C "$WORKTREE_ROOT" fetch origin --quiet && git -C "$WORKTREE_ROOT" merge origin/main` (FF). Then `git -C "$WORKTREE_ROOT" merge-base --is-ancestor db1e3ba8 HEAD`. Non-clean FF → STOP.
4. `git -C "$WORKTREE_ROOT" status --short` clean. 5. `bun install`. 6. `bun run pretest`. Baseline = `bun run test` (record pass/fail counts).
If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **S126:** Bash edits on worktree-absolute paths; NOT Edit/Write. Echo the path; re-verify with a read-back. **NEVER `cd` into the main checkout** (`/home/bryan-maclee/scrmlMaster/scrml` without `.claude/worktrees/`). Use `git -C "$WORKTREE_ROOT"`.
- **Commit-message file:** UNIQUE per commit (e.g. `msg-<agentid>-b1.txt`), inside the worktree.

## Commit discipline
- **THREE commits — ONE per bug** (fix + its coupled regression test together; S113 coupled-code-test = one commit). Clean tree between commits.
- NEVER `--no-verify`. Pre-commit hook runs the full suite (~108–180s); allow 300s timeout. Commit FOREGROUND.
- If a bug turns out NOT to reproduce on R26 against real-shaped source → classify NOT-REPRODUCED, do NOT invent a fix, report it (S138 reverse-R26).

## Shared-surface caution
- B1 + B3 both touch `emit-expr.ts` (the unary/binary serializers). B3 also touches the `emitStringFromTree` source-text twin. Keep each bug's edit localized; commit B1 fully (incl. test + within-node re-baseline) BEFORE starting B3 so the two reconcile cleanly.
- **Over-paren blast radius (S215):** any paren/space insertion MUST be guarded to the exact failing shape. Run the FULL suite after each — a broad guard will shift dozens of within-node parity fixtures. If a fixture AST legitimately shifts, **re-baseline the within-node parity allowlist IN THE SAME COMMIT** (do not leave it red).

---

## B1 — g-unary-left-of-exponent-no-paren (MED) — make the bare form LOUD
**Symptom:** source `-@a ** 2` emits `- _scrml_reactive_get("a") ** 2` — a unary LEFT operand of `**`, which is a JS SyntaxError. Currently emitted SILENTLY (compile exit-0, invalid JS).

**Root (verified by sPA):** the AST path is already correct — `binaryOperandNeedsParens` (`emit-expr.ts:1207-1215`) wraps a unary left-operand of `**` → `(-…) ** 2`. That guard handles the AST form `(-@a)**2` (Bug A, landed S221). **Bug B is the BARE `-@a ** 2`:** because `-a ** 2` is itself a JS SyntaxError, acorn REJECTS it when parsing the (placeholder-substituted) expression → codegen falls back to the regex/string path which never reaches the AST guard → emits the raw invalid JS silently.

**Fix direction — REJECT-LOUD (bounded, mirrors JS + the guard's own stated intent).** The existing guard comment (`emit-expr.ts:1200-1202`) already declares the intended behavior: *"a LOUD E-CODEGEN-INVALID-JS … distinct from the SILENT g-paren-ternary drop."* So: make the acorn-fallback path detect the `<unary> ** …` shape (or, more simply, surface acorn's exponent parse-error as a TARGETED diagnostic) and emit a **LOUD `E-CODEGEN-INVALID-JS`** (ideally a tailored message: *"a unary operator immediately left of `**` is invalid JS — write `(-@a) ** 2`"*) instead of silently emitting the broken token stream.
- This MIRRORS JS (which also rejects `-a ** 2`) + the existing AST-path guard. It is NOT a design ruling — the code's own comment fixes the intended behavior as LOUD-reject. Do NOT auto-paren the bare form (that would be an accept-the-form design lean — if you believe auto-accept is clearly better, STOP + report it as a parked design fork, don't decide it).
- Locate the acorn parse + fallback in the expr emit path (the "legacy acorn expr path" — NOT the native parser, so NOT held by the parser fork). Confirm where the silent fallback emits.

**Test (R26):** a regression fixture with a real-shaped `-@a ** 2` (top-level V5-strict decl `<x> = 0`; `@a` inside `${...}`); assert the compile now produces `E-CODEGEN-INVALID-JS` (cross-stream helper if it's a warning-partition code — but E-* is an error → `result.errors`). Assert the `(-@a) ** 2` author-paren form still compiles clean (Bug-A guard intact). Confirm `node --check` is no longer fed silent-invalid output for the bare form.

## B2 — g-enum-toenum-client-structured-decl (MED) — mirror the ss22 server fix
**Symptom:** `Enum.toEnum(...)` is left UN-lowered CLIENT-side when the RHS of a STRUCTURED `<cell> = Enum.toEnum(...)` decl. Same `emitExpr`-bypass root as the server case fixed in ss22 (#5, deferred).

**Mirror precedent — READ `docs/changes/ss22-enum-toenum-server-2026-06-25/BRIEF.md`** (in this repo). ss22 made `rewriteEnumToEnum` (Pass 9, `rewrite.ts:1599`) fire on the server path. Bug B2 is the inverse-bypass: the structured cell-decl RHS emit path (in `emit-logic.ts` `case "state-decl"` — the structured/compound arm) emits the RHS through a path that BYPASSES `rewriteEnumToEnum` (and/or doesn't route through `emitExprField`, which honors the lowering). Find the structured-decl RHS emit site; route it through the same enum-lowering rewrite the scalar client path uses.

**Test (R26):** repro `<Status> = Status.toEnum(raw)` as a structured cell decl client-side; RED first (emitted client JS shows raw `Status.toEnum(...)` un-lowered → runtime `TypeError`). After fix: emitted client JS lowers to `(Status_toEnum[raw] ?? null)` and the `Status_toEnum` table is present in the client bundle. `node --check` + a node-eval that the lowered form resolves.

## B3 — g-double-unary-minus-emit-decrement (LOW) — both serializers
**Symptom:** `Unary(-, Unary(-, a))` serializes as `--a` (a decrement token) → invalid JS for a numeric arg. (ss21 #4 deferred; pre-existing.) Same hazard for `+ +a` → `++a`.

**Root (verified by sPA):** `emitUnary` (`emit-expr.ts:818-826`) emits `${node.op}${arg}`; when `arg` starts with the same sign char, the two `-` fuse into `--`. The `emitStringFromTree` source-text twin (the string-concatenation serializer in `emit-expr.ts`; see the note at `:750` "REPLACES emitStringFromTree's source-text") has the SAME fusion. Fix BOTH sites.

**Fix direction:** when a prefix unary op ∈ {`-`,`+`} and the serialized operand begins with the same sign char, insert a single space (`- -a`) — the MINIMAL-blast-radius fix (a space is valid JS; avoids new parens that would shift within-node parity fixtures, S215). Parens (`-(-a)`) are acceptable if the twin can't cleanly take a space, but prefer the space. Exclude the `++`/`--` update-operator forms (already handled at `:800-817`).

**Test (R26):** fixtures exercising `- -@a` / `-(-@a)` through BOTH serializers (AST path + the string-tree twin — e.g. a markup-interp context that routes through emitStringFromTree); assert emitted JS is `- -…` (or `-(-…)`), `node --check` clean, NOT `--…`.

---

## FINAL (before reporting DONE)
- Run the FULL `bun run test`; report pass/fail deltas vs the recorded baseline. Within-node parity MUST be green (re-baselined in-commit if a fixture legitimately shifted — note which + why).
- Report: per-bug commit SHAs (B1/B2/B3), branch name + tip SHA, the baseline vs final suite counts, any within-node re-baseline, and ANY bug that came back NOT-REPRODUCED or surfaced a design fork (park it, don't decide).
- Your final message IS the data the sPA lands from — give exact SHAs + file lists.
