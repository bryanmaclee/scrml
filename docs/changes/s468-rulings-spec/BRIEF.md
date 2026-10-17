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
# unit-id: s468-rulings-spec — SPEC + ledger + dPA bank for the two S468 rulings (docs-only)
Read the rulings VERBATIM first: /home/bmacs/scrmlMaster/scrml-support/user-voice-scrml.md, the last entry
("⭐ RULED — "your recos on both" … (S468)"). They are your governing text; quote them, do not paraphrase.
1. SPEC §19.9.9.8 (compiler/SPEC.md; reach via SPEC-INDEX) — ruling (1)(c): add the composition rule: when a CPS-split
   function's server batch calls a function that is itself CPS-split, the call stays server-tier (rule 1 unchanged) and
   the caller's batch runs the callee's server half in-process; the callee's cell writes join the caller's returned cell
   set; one round trip. Mark it NOMINAL (impl#1 keeps E-ROUTE-002 for this shape — fail closed; the bootstrap builds
   it) with an inline `> **Provenance:** ruling:user-voice-scrml.md S468` line. Read §19.9.9.7/§19.9.9.8 and §12.4 in
   full first; if the rule collides with an existing sentence (e.g. §12.4 R2's chain refusal), reconcile in the same
   edit and say how. If you find the ruling cannot be written without a further owner decision, STOP and report the
   exact question. Regenerate SPEC-INDEX (`bun run scripts/regen-spec-index.ts`) and its `--check`.
2. docs/known-gaps.md (marker fields per the overlay: locus=, prov=):
   - g-cps-rule1-split-callee-placement-ruling-s468: status=carried (owed by the bootstrap), prov= the S468 ruling;
     body: ruled (c), impl#1 keeps the refusal. (This entry lives on branch s468-cps-unbound-cluster / PR #1442 — if it
     is not on origin/main when you start, ADD the ruling text as an annotation under a new short entry that references
     it, and note the dependency; do not duplicate the id.)
   - g-param-default-identity-via-param-or-mutation-s467: sev=HIGH, re-scope the heading/body to "identity passed as an
     argument to ANY server function is client-forgeable" (q07 evidence: plain `server function add(name, uid)`), prov=
     ruling S468 (2b); fix in flight on branch s468-identity-arg-refusal.
   - g-cps-server-half-trusts-client-held-cell-s467 and g-server-row-written-to-cell-ships-to-browser-s468 (the latter
     may only exist on branch s468-await-f4-followups / PR #1446 — same handling as above): annotate "direction ruled S468
     (2d) — banked as dpa-<N>".
   Regenerate counts: `bun scripts/state.ts --write` then `--check`; `bun scripts/facts.ts --write`/`--check`.
3. BANK ruling (2d) in handOffs/dpa-queue.md (THE ONLY FILE THE dPA DRAINS — read its header and mirror the exact entry
   format; next free dpa id): "identity, and values that came from a server result, as a server-only value kind that
   cannot cross the wire or be trusted back from the client" — axiom-level, R2 minimum, ONE-AT-A-TIME; inputs: the S468
   ruling, the three gaps above, §19.9.9.8, §52, §14.8.x tenant/DB-authoritative sections, dpa-023's `(not to T)` work
   as the closest precedent; deliverable: a deep-dive in scrml-support/docs/deep-dives/ with forks for bryan.
Docs-only: no compiler/src. Pre-commit hook, push after every commit.
