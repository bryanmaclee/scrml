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

======

# unit-id: s468-bang-arm-block-value
Gap: `g-block-bodied-bang-arm-drops-value-s467` (HIGH, security — a wrong password is accepted). Read its full entry in
docs/known-gaps.md. Symptom: a value-position call with a `!{}` handler whose arm is BLOCK-bodied emits the arm's last
expression as a bare statement, then assigns `var ok = _scrml__scrml_result_N` — the arm's value is dropped.
Locus hypothesis (verify): compiler/src/codegen, the `!{}` guard emission for a value-position handler.
Cited sentence (re-read it yourself): §19.4.3 "the block's last expression is the arm's value".
Cover: block arms that end in an expression, in `if`/`match`, in a nested block, ending in a call, `return` inside the
arm, every `!{}` value position (const/let init, assignment, argument, return, cell init).

## Fix round 1 (S468)

### COMMON.md (verbatim)

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

### BRIEF-bangarm-fixround.md (verbatim)

# unit-id: s468-bang-arm-block-value  — FIX ROUND 1 (from the S239 review of frozen 684420b36)
Work ON the existing branch `s468-bang-arm-block-value` (PR #1440): `git fetch origin s468-bang-arm-block-value && git
checkout -B s468-bang-arm-block-value origin/s468-bang-arm-block-value`; assert HEAD == 684420b366b1a69802ea557d42d5b21fa503f206.
(COMMON step 6 "create from origin/main" is overridden.) Read the branch's docs/changes/s468-bang-arm-block-value/progress.md
first — it is the previous dev's record. Policy limb: SECURITY.
Reviewer artifacts (read-only): $HOME/.cache/scrml-agent-tmp/s468-rev-bangarm/ — h3/n1.mjs,n2.mjs,s4.mjs,cps.mjs,exec.mjs;
h2/probe*.mjs call armBlockStatementsDetailed directly. Findings are RELAYED — reproduce each first.
1. HIGH, fail-open on the CLIENT (pre-existing, but the gap is marked RESOLVED): when `armBlockStatementsDetailed` cannot
   read a braced arm body in a VALUE position, the client silently falls back to the old lowering that drops the value
   → a wrong password LOGS IN. Shapes: `const ok = check(p) !{ .Denied :> { @note = "d"⏎ !yes } }` (and `!true`,
   `true && check(p) !{…⏎ !yes }`), `{ @note = "d"⏎ 0 }`, `{ @note = "d"⏎ "" }`, `{ plain(1)⏎ @note = "d"⏎ 0 }`,
   `{ plain(1)⏎ !yes }`, a block-armed `!{}` nested inside the arm (newline and `;` forms), and
   `{ const y = check2(p) !{ .Locked :> {…⏎ false } ⏎ .Denied :> false }⏎ y }`. The reader refuses statements starting
   with a number/string/`!`/`[` after a newline and arms containing block-armed handlers. The SERVER already refuses these
   texts at compile time (E-STMT-UNEXPECTED-TOKEN) — fails closed. FIX: in a value position a non-empty braced arm the
   reader cannot read is REFUSED on the client too (a compile error naming the arm) — never a fallback. Teaching the
   reader the missing statement starts by construction is better, but the fallback MUST become a refusal regardless.
   Tests for every shape; execute wrong + right password.
2. LOW: `_anchorSpansAt` overwrites every statement's line with the arm's first line (two `log()`s on lines 20/22 both
   print app.scrml:20) — anchor each statement to its own line.
3. Ledger: g-block-bodied-bang-arm-drops-value-s467 stays resolved only with item 1 landed. FILE a NEW HIGH gap (locus=
   + prov= fields): a DERIVED cell ignores its `!{}` handler — `const <okc> = check(@pw) !{ .Denied :> false }` logs a
   wrong password in on base and head (the derived thunk recomputes check(...) with no handler; the handler runs only
   against `_scrml_cs_derived_declare(...)`'s return). Do NOT fix it here. In progress.md record: `{ if…{true} else
   {false} }` / `{ false }` / `x = false` tails fall through (= open g-impl1-value-position-arm-fallthrough-s451); two
   benign behaviour changes (an arm with `fail` inside an `if` now compiles correctly; a leading line starting
   `(`/`[`/template now joins the previous statement as in function bodies).
Gates: your tests, unit suite, security-await-pack classify (FAIL set must equal base's 10), `bun conformance/run.ts`,
pre-commit hook. Push after every commit. Report the new SHA.
