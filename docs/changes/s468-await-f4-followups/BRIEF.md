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

---

# unit-id: s468-await-f4-followups
Base: create branch `s468-await-f4-followups` from `origin/s467-await-r10` @ 6d6157ad0 (PR #1434, reviewed LAND-WITH-
FOLLOW-UPS, merge pending owner permission). NOT from origin/main. If #1434 merges while you work, rebase onto
origin/main. Findings below are RELAYED from an adversarial reviewer who executed them — REPRODUCE each first.
Reviewer artifacts (read-only): $HOME/.cache/scrml-agent-tmp/s468-rev-1434/ (drv/*.mjs shapes + drive.mjs driver,
cmp.txt, cd/diff.json).
F1 (LOW, introduced by 933c6e51a): in the F4 binding judge, `blockShadows` / the param shadow only ADD names; a nested
`function` declaration (or loop/catch header binding) that re-binds a shadowed name inside a deeper block/fn body never
REMOVES it, so F4 goes silent on e.g.
  function run(p, h) { const check = 1
    if (p) { function check(a, b) { return verifyPassword(a, b) }
      const g = (a, b) => check(a, b)
      return g(p, h) }
    return false }
(19458af1e: E-ASYNC-FN-ESCAPES-AS-VALUE + E-ASYNC-STDLIB-IN-SYNC-CALLBACK; HEAD: only the latter). Fix: a scope that
re-declares a shadowed name by `function`/loop/catch binding drops it from the shadow for that scope. Tests: the
reproducer + its variants (param `check`, inner fn body, block lambda, fn expression, named fn expr, IIFE, `let g`) in
s467-await-r10.test.js; keep the r10 false-refusal fix's own tests passing.
F2 (MED, introduced by the merge): compiler/tests/integration/s466-client-dead-fn-binding-prune.test.js was rewritten
to `function w`, which never reaches the client dead-fn-valued-binding prune (emit-client.ts ~:4286, locate by symbol)
— reviewer mutation `if (false && …)` left it 6/6 green (#1435's original: 3/4 fail). Re-pin tests 1-2 on a const
binding over a SYNC server-only stdlib export (e.g. `const w = (a, b) => generatePassword(8) == a`, plus the chain
form), PROVE bite by the same mutation (red), restore (green). Fix the header comment that claims the guarantee is
pinned on `function w`.
F3 (LOW, optional): F4 adds a misleading second error on `const ranked = rows.sort((a, b) => verifyPassword(…) ? -1 :
1)` ("`ranked` holds … an async function" — it is an array). Cases: conformance auth/auth-async-stdlib-sync-callback-
neg, server-db/server-fn-in-sync-callback-pos. Do not report a binding whose value is a method-call RESULT over a sync-
callback lambda. Pass conformance unchanged.
GAPS to file in docs/known-gaps.md (locus= + prov= fields):
 - F4 pre-existing LOW: an inner `function check(a,b){ return helper(a,b) }` re-declaring an imported async name and
   calling a file-scope `helper` → server bundle ReferenceError `helper is not defined` (fails closed, 500).
 - pre-existing on main, sev MED (PA call; owner may re-rank): a function writing a whole SQL row into a client cell
   (`@out = ?{SELECT name, pw …}.get()`) then a client lambda reading `@out.name` ships the full row incl. the password
   hash to the browser — tension with §19.9.9.8 "server values stay on the server"; ruling owed on whether a server
   result written into a cell is a server value (ties to g-cps-server-half-trusts-client-held-cell-s467). Reproducer:
   $HOME/.cache/scrml-agent-tmp/s468-await-land/probe/ (srvLambdaWrites).
 - LOW tooling: classify.js --json prints stray `false`/`true` lines before the JSON. Fix it here (small) and note it.
Re-run the full await pack (640 shapes, 0 FAIL) after F1.
