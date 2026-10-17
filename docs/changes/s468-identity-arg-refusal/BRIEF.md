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
# unit-id: s468-identity-arg-refusal — ruling S468 (2b): refuse identity passed as an argument to a server function
Policy limb: SECURITY (impl#1). Ruling VERBATIM: /home/bmacs/scrmlMaster/scrml-support/user-voice-scrml.md, last entry
(S468, "(2) = (b) now …"). Gap: g-param-default-identity-via-param-or-mutation-s467 (being raised to HIGH by the parallel
s468-rulings-spec docs unit — do NOT edit that gap's marker yourself; add your resolution note under it only at the end,
and expect a known-gaps merge).
Hole: `<button onclick=add("hi", @session.userId)>` with `function add(name, uid) { ?{INSERT … ${uid} …}.run() }` — the
browser computes `@session.userId` and sends it; any client can send another id. Also CPS-split defaults (the original
gap) and mutating-call routes (`Object.assign`, `.push`, `.set`).
BUILD: a value derived from `@session` / `@currentUser` (directly, through locals/aliases/derived cells/helpers/mutating
calls — REUSE the identity follower #1433 binding-provenance + #1442's carried-local identity check; do NOT write a
fourth walker) that reaches an ARGUMENT position of a call to a server-placed function — from client code or a CPS
browser part — is a compile error whose message names the fix (read `@session` on the server inside the function). Pick
the error code: reuse an existing E-ROUTE-*/E-AUTH-* code only if its §34 row genuinely covers this; else mint one and
add the §34 row + a §12.x/§52 sentence (with `> **Provenance:** ruling:user-voice-scrml.md S468`) — the ruling IS the
governing text.
MEASURE FIRST, before building the refusal fully: the corpus count of session/currentUser-derived arguments to server
functions (examples, samples, conformance/cases, stdlib, /home/bmacs/scrmlMaster/{giti,flogence}). Any REAL (non-fixture,
non-negative-test) site → STOP and report the list (the ruling's condition: real code newly refused returns to bryan).
Cover: direct, aliased, derived cell, helper fn return, template/concat, object/array wrapping, spread, mutation routes,
CPS default, cross-file import, `@currentUser.role`/`.tenant` style fields; NOT refused: reading @session INSIDE the
server function, non-identity data, `@session` used only in the browser. Execute forged requests on base (accepted) and
head (refused at compile). Gates: unit/integration/conformance, security-await-pack classify (0 new FAIL), corpus
differential, pre-commit hook. Push after every commit.
