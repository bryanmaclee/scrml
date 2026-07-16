# BRIEF — E-CTRL-004 + E-LOOP-007 soundness-hole fixes (ss75, bryan-ruled S261)

**Dispatch:** `scrml-js-codegen-engineer` · model opus · PRE-MADE worktree (auto-`isolation:worktree` is broken — you work in a manual worktree, NOT via the isolation param).
**Worktree:** `/home/bryan-maclee/scrmlMaster/scrml-ctrl-loop-fix` · branch `fix/ctrl-004-loop-007` · base main `55bbdbed`.
**Origin:** sPA ss75 surfaced two tier-1 §17/§35 diagnostics that CANNOT fire correctly today; bryan ruled **fix-impl** on both (S261). These are freeze-relevant soundness holes — a green suite currently reads them as "covered" over a dead/narrowed path.

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do this FIRST, before any edit)

You are working in a PRE-MADE manual worktree. Your VERY FIRST action:
```
cd /home/bryan-maclee/scrmlMaster/scrml-ctrl-loop-fix
pwd                          # MUST print /home/bryan-maclee/scrmlMaster/scrml-ctrl-loop-fix
git rev-parse --show-toplevel   # MUST equal the worktree path (NOT .../scrml)
git branch --show-current    # MUST be fix/ctrl-004-loop-007
git status --porcelain       # MUST be empty (clean)
ls node_modules/acorn >/dev/null && echo DEPS-OK   # node_modules is symlinked from main
```
If ANY check fails, STOP and report — do not proceed.

**Path discipline (this is a NON-isolated dispatch pointed at a manual worktree — a leak into `../scrml` main is a process violation):**
- Every edit targets a path UNDER `/home/bryan-maclee/scrmlMaster/scrml-ctrl-loop-fix/`.
- NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml` (the main checkout). Use `git -C /home/bryan-maclee/scrmlMaster/scrml-ctrl-loop-fix ...` and `bun --cwd /home/bryan-maclee/scrmlMaster/scrml-ctrl-loop-fix ...` if you ever need an explicit cwd.
- Commit ON the `fix/ctrl-004-loop-007` branch. Do NOT push (the PA lands via file-delta + PR).

## CRASH-RECOVERY (mandatory)
- **Commit after each meaningful unit** (WIP commits expected). The branch is your recovery anchor.
- Maintain `progress.md` in the worktree root: append-only timestamped lines (what you just did / what's next / blockers).
- A clean `git status` before you report DONE is mandatory. "Work in the tree, no commits" is NOT an acceptable terminal state.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first, then `.claude/maps/error.map.md` (diagnostic codes / error classes) + `.claude/maps/domain.map.md` (§ navigation). **Currency:** the maps are stamped commit `f079d0a9`; HEAD is `55bbdbed` (several §34/conformance landings since). Treat every LINE NUMBER in the maps AND in this brief as APPROXIMATE — verify against live source (grep the code string, not the line). Report any map content that was load-bearing OR wrong.

## Anti-pattern briefing (for the conformance `case.scrml` you will AUTHOR)
Before writing any `.scrml`, read `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` + `docs/articles/llm-kickstarter-v2-2026-05-04.md` (canonical scrml shape; kills the React/Vue/JSX reflex). The conformance cases must be idiomatic V5-strict scrml.

---

## FIX 1 — E-CTRL-004 (dead code; §17.1.1 mandates Error)

**SPEC (§17.1.1, SPEC.md:10319):** "`else` and `else-if=` SHALL NOT appear on a state object opener. The compiler SHALL reject any such usage (E-CTRL-004)."

**Bug (verified on `55bbdbed`):** in `compiler/src/ast-builder.js`, the if-chain scan loop reads `const sibling = nodes[j];` then `if (sibling.kind !== "markup") break;` (≈line 17578) — and ONLY AFTER that runs the E-CTRL-004 test `if ((sibling.kind === "state" || sibling.kind === "state-constructor-def") && (hasAttr(sibling,"else") || hasAttr(sibling,"else-if")))` (≈line 17579). Because the `!== "markup"` break fires FIRST for any `state`/`state-constructor-def` sibling, the E-CTRL-004 test is **provably unreachable**. Today `else`/`else-if` on a state opener is SILENTLY ACCEPTED.

**Fix:** HOIST the E-CTRL-004 test ABOVE the `if (sibling.kind !== "markup") break;` guard, so a state-object opener carrying `else`/`else-if` fires E-CTRL-004 before the chain-scan breaks. A state opener WITHOUT else/else-if must still break the chain (unchanged). Do not change any other chain-scan behavior.

**Pos case:** author `conformance/cases/control-flow/ctrl-004-else-on-state-opener-pos/{case.scrml,expected.json}` — a state-object opener carrying `else` (or `else-if=`), immediately following a well-formed `if=` element, asserting `"codes": ["E-CTRL-004"]` + `"severity": {"E-CTRL-004": "error"}`. Mirror the existing `ctrl-004-else-on-state-opener-neg` fixture's structure/metadata (it's already on main; read it). Ground the rationale in §17.1.1:10319.

**Corpus-safety (LOAD-BEARING — this is the real risk of this fix):** hoisting turns a currently-silent shape into an Error. Before claiming done, RECOMPILE the real corpus and confirm ZERO new E-CTRL-004 fires on legitimate code (see Phase R26). If any real sample/example fires E-CTRL-004, STOP and report — it means a legit shape is being caught and the fix or the pos needs re-scoping.

---

## FIX 2 — E-LOOP-007 (impl under-fires §49.4.4; two-part fix)

**SPEC (§49.4.4, SPEC.md:25057):** "A bare `while` statement SHALL NOT be used as an expression ... (e.g., `let x = while (...) { ... }`) without the `lift` accumulator pattern (§49.6). The error is E-LOOP-007." §49.6.1 fixes the ONLY valid expression-position form: the `while` stays a STATEMENT that `lift`s, and the value is consumed via `let result = ~` (NOT `let x = while(...)`). §49.9 (SPEC.md:25319-25325) gives the SPEC's OWN example `let x = while (true) { 5 }  // Error E-LOOP-007` — **no lift, and it IS an Error**.

**Bug (verified on `55bbdbed`):** `compiler/src/type-system.ts` `checkWhileAsExpr` (≈18657-18676) fires E-LOOP-007 ONLY when the init raw matches `/^while\s*\(...\)\s*\{...\blift\b...\}\s*$/` — i.e. the body must contain a `lift` token. So §49.4.4's own no-lift example `let x = while (@n < 3) { @n = @n + 1 }` stays SILENT. The source comment says the `\blift\b` requirement is a deliberate workaround for an ast-builder misparse that "absorbs an unrelated while-stmt into a preceding let-decl's init."

### Part 2a — fix the mis-worded registry rows (SPEC-text)
`§34` row (SPEC.md:18062) and `§49.9` row (SPEC.md:25344) both compress the condition to *"`while` used as expression without `lift`/`~`"*. Read literally that says "fires when the body has no lift token" — the INVERSE of the real rule. Reword both to make clear E-LOOP-007 fires on **any `while` in expression position (as a value, e.g. `let x = while(...)`)** EXCEPT the §49.6.1 statement-`while`+`let result = ~` accumulator pattern. Keep it terse; match the surrounding row style. If your SPEC.md edit shifts section line ranges, regen the index (`bun run scripts/regen-spec-index.ts`) — a same-section row reword usually doesn't, so check first.

### Part 2b — fix the ast-builder misparse (compiler-source; the RISKY part)
Characterize FIRST: write a probe (a tiny `.scrml` + a compile) that reproduces the misparse where a `while(...){...}` statement following a complete `let`/`const` decl gets absorbed into the preceding decl's init. Then fix `compiler/src/ast-builder.js` so a `while` statement following a COMPLETE let/const decl is parsed as a SEPARATE statement, not folded into the decl's init.

### Part 2c — un-narrow the type-system check
Once 2b is fixed, drop the `\blift\b` requirement in `checkWhileAsExpr` so E-LOOP-007 fires on ANY genuine `let x = while(...)` expression-position init (the §49.4.4 mandate), while STILL not firing on the valid §49.6.1 pattern (statement-`while` + `let result = ~`). Verify the existing `loop-007-while-as-expr-pos` (lift-bearing) fixture still passes.

### Part 2d — pos case
Author `conformance/cases/control-flow/loop-007-while-as-expr-no-lift-pos/{case.scrml,expected.json}` — the §49.4.4 no-lift example (`let x = while (@n < 3) { @n = @n + 1 }`) asserting `"codes": ["E-LOOP-007"]` + severity error. Mirror the existing `loop-007-while-as-expr-pos` metadata shape.

### ⚠ BLAST-RADIUS FALLBACK (2b is shared parse logic)
If the misparse fix (2b) ripples broadly — breaks more than a couple of unrelated tests, or you cannot fix it without touching how `let`/`const` init-collection consumes following tokens generally — **STOP, commit your progress + the 2a wording fix + a scoped/annotated version of 2c, and report the characterization back** (what the misparse is, why the minimal fix ripples). Do NOT force a risky parser rewrite. The PA (with bryan) will decide whether to accept a narrower landing. Getting 2a + a documented characterization is a valid partial outcome.

---

## Phase R26 — empirical verification (do NOT mark DONE without this)
1. `bun conformance/run.ts` → must be **693/693** (691 on main + your 2 new pos-cases), 0 fail.
2. Full gate suite: `bun run test` (chains pretest) — unit + integration + conformance green (0 fail). Report the exact pass/fail counts.
3. **R26 corpus recompile (the soundness check):** compile a spread of real adopter `.scrml` on YOUR post-fix baseline and grep the diagnostics — confirm ZERO new E-CTRL-004 and ZERO new E-LOOP-007 fires on legitimate code:
   ```
   for f in scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml examples/*.scrml samples/*.scrml; do
     bun compiler/bin/scrml.js compile "$f" --output-dir /tmp/r26-$$ 2>&1 | grep -E 'E-CTRL-004|E-LOOP-007' && echo "  ^^ in $f"
   done
   ```
   ANY hit on real code = STOP + report (the fix is catching a legit shape). Expected result: no hits.

## Report back (your final message = structured data, not prose to a human)
- `WORKTREE_PATH`, `FINAL_SHA` (branch tip), branch name.
- Files touched (grouped: ast-builder.js / type-system.ts / SPEC.md / conformance cases).
- Per-fix status: E-CTRL-004 DONE/PARTIAL, E-LOOP-007 (2a/2b/2c/2d each DONE/PARTIAL/DEFERRED).
- Test results: `conformance/run.ts` count, full-suite pass/fail counts, R26 grep result (clean/hits).
- Any DEFERRED item + why (esp. if the 2b fallback triggered).
- Anything in the maps/brief that was stale or load-bearing.
