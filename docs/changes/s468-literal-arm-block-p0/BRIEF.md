# S468 fan-out — COMMON BRIEF (every S468 dev dispatch reads this IN FULL, then its own BRIEF-<unit>.md)

You are `scrml-js-codegen-engineer` on the scrml compiler (TS impl#1, Bun). Normative source: `compiler/SPEC.md`
(reach sections via `compiler/SPEC-INDEX.md` + offset/limit reads). PRIMER/derived docs are NOT normative.

## STARTUP VERIFICATION + PATH DISCIPLINE (before ANY write)
1. `pwd` MUST start with `/home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-` → WORKTREE_ROOT; `git rev-parse
   --show-toplevel` == it; tree clean; `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Else STOP.
2. NEVER cd into or write under `/home/bmacs/scrmlMaster/scrml` outside your worktree. There is NO path-discipline hook
   on this machine — you are the guard. Absolute WORKTREE_ROOT paths for every Edit/Write. `bun --cwd=` needs the `=`.
3. NEVER `git stash`. NEVER `pkill -f`/`killall` — kill only PIDs you captured.
4. `TMPDIR=$HOME/.cache/scrml-agent-tmp/<unit-id>` per command; never /tmp, never inside a repo.
5. `bun install` then `bun run pretest` (plain, from WORKTREE_ROOT) — browser fixtures are gitignored.
6. Create your branch `s468-<unit-id>` from origin/main. First commit: `WIP(<unit-id>): start at $(pwd)`.
   **PUSH AFTER EVERY COMMIT** (`git push -u origin s468-<unit-id>`). Keep `docs/changes/<unit-id>/progress.md`
   (append-only, timestamped). Copy your brief verbatim to `docs/changes/<unit-id>/BRIEF.md` in your first commit.
7. Commits run the pre-commit hook (~15-22 min on this machine; 8 agents share it). Before each commit check
   `free -g` available ≥ 6; if not, wait (bounded: 10 tries × 60 s, then commit anyway and note it). Foreground, long
   timeout. NEVER `--no-verify`. If the hook fails on something you did not touch, prove it fails identically on an
   origin/main archive and report — do not bypass.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` — stamp `5c43c3b8e` (refreshed S468; equals origin/main). Follow its Task-Shape Routing
to the 2-4 maps for your task. Map loci are hypotheses: verify against source. Report whether maps were load-bearing.

## HOW TO WORK
- **Reproduce first, on current origin/main** (a version-stamped `.scrml` reproducer + compile command + expected vs
  actual, EXECUTED, not eyeballed). If it does not reproduce: classify NOT-REPRODUCED with evidence, sweep 3+ shapes,
  report, stop.
- **The locus in your brief is PA-located-verify** (copied from a gap marker, produced by search not trace). Trace
  from entry point to the decision. Report whether the hypothesis held, was refined, or was wrong.
- **Governing-sentence gate:** before changing what a program means or whether it is accepted, QUOTE the governing
  SPEC sentence with § in progress.md. If none exists ("searched §X, §Y — no governing sentence"), STOP and report:
  that is a ruling for the owner, not a fix.
- **Direction of change:** classify inert / newly-rejecting / newly-accepting / semantics-changed. Newly-ACCEPTING
  without a pre-existing normative sentence → STOP, report. Newly-rejecting → MEASURE the corpus by compiling
  (`scripts/corpus-emit-differential.ts`; roots examples, samples, conformance/cases, stdlib) and report the count;
  non-zero real (non-test-fixture) sites → STOP and report before landing.
- **Fix the ROOT, not the position.** If round after round finds a new position, change the boundary (admit only
  what is provably safe), say so.
- **No regex over source text in a post-AST stage** (type-system, symbol-table, dependency-graph, route-inference,
  codegen/*) without a one-line justification — use the tree you already hold (Rule 7).
- Tests: unit + integration covering the reproducer AND the adjacent shapes your mechanism could break (blast radius).
  Security-shaped fixes: run `bun compiler/tests/integration/security-await-pack/classify.js` before/after; 0 new FAIL.
- Gap ledger: flip your gap's marker to `status=resolved` with `locus=` (traced) in `docs/known-gaps.md`; regen
  `bun scripts/state.ts --write`, `bun scripts/facts.ts --write` if counts moved; `--check` both.
- Do NOT open/merge PRs, touch main, or edit SPEC beyond what your brief authorizes.

## FINAL REPORT
WORKTREE_PATH · branch · final SHA (== `git ls-remote origin s468-<unit-id>`) · reproducer + before/after ·
governing sentence (quoted) · direction-of-change + measured corpus impact · files touched · tests added · gate
results · locus hypothesis held/refined/wrong · maps load-bearing? · anything STOPPED for a ruling.
# unit-id: s468-literal-arm-block-p0 — P0: a literal-pattern match arm's BLOCK body is never parsed → unawaited server call → wrong password accepted
Policy limb: SECURITY (P0, live on main bbddfd7b9). Severity HIGH (there is no CRITICAL tier — priority, not tier).
Found by the S468 review of #1446 (relayed, executed by the reviewer — REPRODUCE FIRST). Artifacts (read-only):
$HOME/.cache/scrml-agent-tmp/s468-rev-f4fu/ — m1.scrml (repro source), drv/p3.mjs…p7.mjs (shapes), drv/ast.mjs (AST dump),
driver $HOME/.cache/scrml-agent-tmp/s468-rev-1434/drv/drive.mjs (`drive.mjs <treeRoot> <shapes>`).
Reproducer (server function body in the await-pack template):
    const n = 1
    match n {
      1 => { const g = check
        if (!g(pass, row.pw)) { return "REJECTED" }
        return "WELCOME" }
      else => { return "X" }
    }
→ emitted `const g = check; if (!g(pass, row.pw)) return "REJECTED"` (no await) → wrong password 200 "WELCOME".
Variants that FAIL the same way: matchArmInF, matchArmInFLet (`g = check` into an outer let from the arm),
matchArmInFLetDecl, matchArmInFObj (`{ g: check }`), matchArmNestedFnIf (inside a helper fn), strArm (`"bob" =>`),
strArmColon (`:>`), boolArm (`true =>`), strArmObj (`[check]`), matchNumArmIfOnly (binding nested in an `if` in the arm).
Correctly handled today: variant arms `.A =>`, `else =>`-only, `!{}` arms; literal arms with DIRECT calls.
Locus hypothesis (PA-located-verify, from the reviewer's AST dump): the parser keeps a literal arm as a `bare-expr`
whose `expr` = the whole arm TEXT and `exprNode` = only the literal; the F4 walk never sees the inner statements; the
text fallback skips text that has an `exprNode`; codegen emits the text verbatim. Related gap (same root, filed as
fail-closed MED): g-nested-match-in-string-arm-block-unlowered-s467 (docs/known-gaps.md).
ROOT FIX: a literal-pattern arm's block body is parsed into statements exactly like every other arm kind, so every
analysis (await mandate §13.2, F4 §13.9.6, E-ERROR-002, CPS tiering, E-RI/E-ROUTE checks) sees it by construction. Do
NOT add a text scan. Quote the governing sentences (§18 match arm grammar; §13.2 await mandate) in progress.md.
Also: check the CLIENT side and markup/`<match>` forms for the same arm-kind divergence; check JS-style `match` in
expression position, statement position, and `:>`/`=>`/`->` separators.
ADD every variant above (and any you find) to compiler/tests/integration/security-await-pack/shapes so the classify gate
covers literal arms; prove the pack shows them FAIL on main and PASS-REFUSED/PASS on your branch.
Direction: semantics-changed for literal-arm blocks (now actually analysed) and likely newly-rejecting where the
newly-visible code violates F4/E-ERROR-002 — measure the corpus (examples, samples, conformance/cases, stdlib +
/home/bmacs/scrmlMaster/{giti,flogence}); real sites newly refused → STOP and report. Resolve/annotate the related gap.
