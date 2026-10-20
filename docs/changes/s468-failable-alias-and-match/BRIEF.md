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
# unit-id: s468-failable-alias-and-match
Gaps (one unit, E-ERROR-002 family — read both entries in full):
1. `g-failable-alias-through-operator-or-returned-fn-s467` (MED) — the value-position failable check follows bare-name
   aliases only; an alias through an operator or a returned function escapes E-ERROR-002. Locus: type-system.ts
   checkFailableCallsInValuePositions + compiler/src/failable-value-calls.ts.
2. `g-match-failable-subject-through-operator-miscompiled-s467` (MED) — match lowering recognizes a failable subject only
   when the subject IS the call; otherwise emits `_scrml_match_N === "Denied"`. Locus: codegen match lowering.
Governing: §19.4.3 (+ the S467 #1431 ruling: an unhandled failable call used as a value is E-ERROR-002) — quote.
Root over positions: if it is round-by-round alias shapes, judge by the value's TYPE (does it carry a failable
result) rather than by syntactic alias chains — say which you did and why.

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

### BRIEF-failable-fixround.md (verbatim)

# unit-id: s468-failable-alias-and-match — FIX ROUND 1 (review of frozen 7ecae57eb: DO-NOT-LAND)
Work ON the existing branch (PR #1444): `git fetch origin s468-failable-alias-and-match && git checkout -B
s468-failable-alias-and-match origin/s468-failable-alias-and-match`; assert HEAD == 7ecae57eb898fb5a6214b0c00cbf1944700ad86c.
(COMMON step 6 overridden.) Read the branch's progress.md first. Policy limb: SECURITY. Reviewer artifacts (read-only):
$HOME/.cache/scrml-agent-tmp/s468-rev-failable/ (h2.mjs client harness, hs.mjs server harness, n1–n8/s1–s2 cases,
work/<tag>N/out emitted code). Reproduce every item first; execute wrong + right password.
The S467 durable lesson applies: position-by-position fixes did not converge on the await P0 (10 rounds) or CPS (5);
both closed only when the rule flipped to "admit only what is provably safe". This branch is showing the same signature.
A. INTRODUCED fail-open — MUST NOT land (match-subject half):
 F1 HIGH: `const ok = match (p == "wrong" ? AuthErr::Denied : check(p)) { .Denied :> false  _ :> true }` (also `.Denied`
   spelling, `match (plainDeny(p) || check(p))`, statement position) — the stamp marks the whole subject failable, the
   lowering treats every non-`__scrml_error` value as "Ok", so a PLAIN enum value skips `.Denied` → LOGGED IN (work/hn80).
 F2 HIGH: inline `match` in an event-handler attribute (`onclick=${ @msg = match (false || check("wrong")) {…} }`) is not
   reached by the stamp → `if (_scrml_match_6 === "Denied")` → LOGGED IN (work/hn31, hn234). Base refused (E-ERROR-002).
 F3 HIGH: statement-position `match (p == "" || check(p)) {…}` in a SERVER function emits `const _scrml_match_3 =
   check(p);` with no await → Promise classified "Ok" → 200 LOGGED IN (work/hs22). Base refused.
 FIX DIRECTION (fork rule: fail-closed wins): every operator-widened match subject that the lowering cannot discriminate
   CORRECTLY at EVERY position (client expr, statement, handler attribute, server statement, server expr, CPS) stays
   REFUSED (E-ERROR-002) exactly as on base. Keep the alias-through-NAME discrimination fixes the review confirmed
   correct (match g(p) via plain/ternary alias, match getF()(p), expression-position in blocks/.map/if/while, markup).
B. The alias half is shape-chasing (dev matched syntax, the gap text claims "by type"). F4 (MED, pre-existing, but the
   marker claims resolved): still LOGGED IN on base AND head — curried returns, `id(check)(p)`, `const g = id(check)`,
   `apply2(getF)(p)`, function-expression IIFE, destructuring default `const { g = check } = {}`, param defaults
   `function t(p, f = check)`, closure write, write-after-use in a loop, passing as a value (`apply(check)`,
   `((f) => f(p))(check)`, `[p].map(check)`/filter/some). ROOT FIX (reviewer's suggestion; you verify): refuse any read
   of a FAILABLE FUNCTION as a value outside callee position and the modelled alias initializers — the analogue of the
   S467 F4 rule (a waiting function is bound only by a `function` declaration). GOVERNING-SENTENCE GATE: find and quote
   the SPEC sentence that makes a failable function used as a value illegal or its result-use E-ERROR-002 (search §19.4,
   §19.4.3, §14.3 / E-VALUE-FUNCTION-STORED, §13.9.6). If none governs → implement A + B-only-what-is-governed, and STOP
   on the root refusal with a written ruling request (options + measured corpus count of failable-fn-as-value reads in
   examples/samples/conformance/stdlib/giti/flogence). Do NOT invent the rule.
 F5 LOW introduced: by-name fixpoint false refusal (nested `function getF(){ return check }` in one fn taints an unrelated
   local `getF` in `login`) — key by binding/scope, not name.
C. FILE as HIGH gaps (pre-existing P0s, do not fix here unless A's fix covers them by construction): the DIRECT forms of
   F2 (`match check("wrong")` in a handler attribute miscompiles on base) and F3 (`match check(p)` statement-position in a
   server fn is unawaited on base) — no known-gaps entry exists for either. Correct the gap-2 "resolved" marker text.
D. Docs: update SPEC §19.4.3's carried-gaps paragraph (compiler/SPEC.md ~:19629) to the truth; finish progress.md (the
   push outcome is unrecorded).
Gates: your tests + the 7 e-error-002/failable suites, unit suite, conformance, security-await-pack classify (0 new FAIL),
corpus differential (0 newly-rejected real sites, or STOP), and ADD F1–F3 + the F4 shapes to the security-await-pack (or a
sibling pack) so the classify gate can see this class. Push after every commit.
