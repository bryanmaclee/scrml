# DISPATCH BRIEF — `fn` / `pure function` canonicity-framing currency reframe

Change-id: `fn-pure-canonicity-reframe-2026-06-11`. You are `scrml-js-codegen-engineer`, worktree-isolated. This is a **prose + SPEC + one lint-message-string currency reframe — ZERO behavior change** (no codegen, no logic, no lint-firing change, no new/removed error codes).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full first. This is a docs/SPEC/string change; the error.map I-FN-PROMOTABLE entry is the relevant one. Maps reflect HEAD `a2878626` as of `2026-06-11`. In your final report include "Maps consulted: [list]; load-bearing finding: <one sentence>" or "not load-bearing."

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Your worktree path = `pwd` at startup → WORKTREE_ROOT.
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo, STOP and report (S90 CWD-routing failure). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git status --short` clean.
4. `git merge main` (or confirm base includes HEAD `a2878626`).
5. `bun install` (worktrees don't inherit node_modules — pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
6. `bun run pretest` (populates `samples/compilation-tests/dist/` for browser tests).

## Path discipline (S99/S126 — strict)
- **Apply ALL edits via Bash** (`perl -i` / `python3` / heredoc) on **worktree-absolute paths including the `.claude/worktrees/agent-<id>/` segment** — NOT Edit/Write (they leak to MAIN). Echo the path before each write; `git diff` / `grep` after.
- **NEVER `cd` into the main repo** or anywhere outside WORKTREE_ROOT. Use `git -C "$WORKTREE_ROOT"`, worktree-absolute paths, `--cwd "$WORKTREE_ROOT"` for bun.
- **DO NOT use `--no-verify` on any commit** (not authorized — run every commit through the pre-commit gate).
- First commit message includes the verbatim `pwd`: `WIP(fn-pure-reframe): start at $(pwd)`.

# THE TASK

The S176 deprecate-pure amendment reframed the canonical home (§33 head, §34 W-PURE rows, §48.11 head 23064, §23048) to: **`fn` is THE canonical pure form; `pure function` is the DEPRECATED long-form synonym (identical semantics); bare `function` is impure.** It LEFT ~14 derived sites still framing `pure function` as the live canonical form ("ergonomic shorthand for `pure function`") and teaching the now-dead `W-PURE-REDUNDANT`. A dog-food hit the adopter-visible one (the I-FN-PROMOTABLE lint message).

**Read `docs/changes/fn-pure-canonicity-reframe-2026-06-11/SCOPE-AND-DECOMPOSITION.md` in your worktree IN FULL** — it has the complete 15-site inventory, the per-site target wording, and the invariants. Then read SPEC §48.11 + §33 (head + the sub-sections referenced) IN FULL before editing (pa.md Rule 4). The line numbers in the SCOPE doc are approximate (line drift) — locate each site by its quoted text, verify it against current SPEC, then reframe.

## The principle (propagate the EXISTING §48.11/§33-head framing — do NOT invent new normative wording)
- "ergonomic shorthand for `pure function`" → "the canonical pure form".
- "`fn` ≡ `pure function`" where it frames `pure function` as canonical → keep the equivalence FACT, qualify `pure function` as the deprecated synonym.
- "new code MAY use either form" (§48.13) → "new code SHALL use `fn`; `pure function` is deprecated (W-PURE-DEPRECATED)".
- "`pure fn` is valid/redundant (W-PURE-REDUNDANT)" (§48.13, §23309) → "`pure fn` is deprecated (W-PURE-DEPRECATED, which supersedes the former W-PURE-REDUNDANT)".
- kickstarter §1929 → reframe entirely; KILL "reach for the explicit `pure function` form".

## HARD INVARIANTS — do NOT violate (these are the whole reason option C was chosen carefully)
1. **Semantic equivalence stays TRUE.** `fn` and `pure function` enforce the identical §33.3 purity contract — keep every equivalence-as-fact statement; only mark `pure function` deprecated where the framing implies it is the live canonical form.
2. **CONF-S32-004 unchanged.** `compiler/tests/conformance/s32-fn-state-machine/s48-fn.test.js` locks the body-invariant equivalence. Do NOT touch the test assertions; it must stay GREEN as-is.
3. **§33's BODY is the legacy-semantics reference BY DESIGN** (its head banner says so). Do NOT reframe the §33.1/§33.2/§33.3 `pure function` examples. Only fix §33 sub-sites that frame `pure fn` as *valid/non-deprecated* contradicting W-PURE-DEPRECATED.
4. **ZERO behavior change.** No codegen, no logic, no lint-firing change, no new/removed error codes. W-PURE-REDUNDANT is already dead (superseded) — you are only fixing PROSE + the one I-FN-PROMOTABLE message string + stale comments.

# VERIFICATION (no R26 — this is a prose/string change, R26 doctrine does not apply)
- Run the full `bun run test` — MUST be 0 fail. CONF-S32-004 must stay green unchanged.
- Lint-smoke: compile a file with a promotable `function` (a pure-bodied `function` with no SQL/DOM/non-determinism) and confirm `I-FN-PROMOTABLE` still fires — with the NEW message (no "shorthand for pure function"). Quick:
  ```
  cat > /tmp/fnreframe-smoke.scrml <<'EOF'
  ${
    function double(n) { return n * 2 }
  }
  <program><p>${double(21)}</p></program>
  EOF
  bun "$WORKTREE_ROOT"/compiler/bin/scrml.js compile /tmp/fnreframe-smoke.scrml --output-dir /tmp/fnreframe-out 2>&1 | grep -i "I-FN-PROMOTABLE" | grep -i "shorthand" && echo "!! message still stale" || echo "message reframed (no 'shorthand')"
  ```
- `grep -rn "ergonomic shorthand for .pure function\|shorthand for .pure function." "$WORKTREE_ROOT"/compiler/SPEC.md "$WORKTREE_ROOT"/compiler/src/ "$WORKTREE_ROOT"/docs/articles/llm-kickstarter-v2-2026-05-04.md` → should return ZERO (all reframed). Report the final count.

# COMMIT DISCIPLINE
- Commit per logical unit (SPEC sites / lint message+comment / kickstarter / test docstrings). WIP commits fine. Update `docs/changes/fn-pure-canonicity-reframe-2026-06-11/progress.md` after each step (append-only, timestamped).
- Before DONE: `git status` clean; full `bun run test` 0 fail.

# FINAL REPORT
- WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED.
- The exact NEW text of the I-FN-PROMOTABLE lint message (lint-i-fn-promotable.js:289) verbatim.
- A per-site list of what you reframed (site → old framing → new framing), so PA can review every normative change at file-delta.
- The `grep "ergonomic shorthand"` final count (expect 0 outside §33's legacy body, if any remain there explain why).
- Full-suite pass/skip/fail; confirm CONF-S32-004 green unchanged.
- Maps feedback. Any site you judged out-of-scope (e.g. a §33-body legacy example) + why.
