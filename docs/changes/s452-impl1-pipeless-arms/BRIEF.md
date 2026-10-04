# BRIEF — s452-impl1-pipeless-arms (archived verbatim at dispatch)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ad8b4b89d5f96bb38

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ df6dad5ac.
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. Never write under /home/bryan-maclee/scrmlMaster/scrml/ outside your worktree; never `cd` into the main checkout.
3. NEVER `git stash`; NEVER `pkill -f`/`killall` (kill by captured PID only).
4. `bun install`, then `bun run pretest` from your worktree cwd. Scratch under "$WT/.tmp/" (delete before final report). TMPDIR if set → ~/.cache/scrml-agent-tmp/s452-impl1-pipeless-arms.
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-impl1-pipeless-arms/BRIEF.md (body `start at $(pwd)`); progress.md append-only. Code + its tests in ONE commit. Never --no-verify; never touch hooks. Pre-commit timeout 300000. Run git commands singly.
6. Push as `fix/s452-impl1-pipeless-arms` (normal push). Do NOT open/merge a PR.

MAPS — REQUIRED FIRST READ: .claude/maps/primary.map.md (stamp d3e660a08). Post-map landings: #1269 #1270 #1271 #1272 (SPEC/bootstrap/docs — none touch impl#1's parser). Treat map loci as hypotheses. Report whether load-bearing.

CONCURRENCY: Peter's session S453 is live in impl#1 on `js-async-analysis.ts` / listener emit and the `transaction {}` work in `emit-server.ts`. Stay out of those unless the fix genuinely requires it — if it does, STOP and report.

TASK — impl#1 (compiler/src/) is frozen; bryan granted an EXCEPTION (user-voice-scrml.md §S452 "yes exception granted", at /home/bryan-maclee/scrmlMaster/scrml-support/ — read-only) for exactly this: make impl#1 ACCEPT the canonical pipe-less `!{}` handler arm form.

Ruling context (S452 "c looks right"): `!{}` handler arms use the §18.2 `match`-arm grammar (compiler/SPEC.md §18.2: `match-arm ::= arm-pattern (':>' | '=>' | '->') arm-body`; `variant-pattern ::= ('.' | '::') VariantName ('(' binding-list ')')?`; wildcard `else` / `_`). A SPEC amendment writing this into §19 is in flight on another branch — don't edit SPEC.md. The legacy `|`-prefixed form (`| ::V m :>`, `| .V(m) :>`, `| _ :>`) MUST keep working exactly as today (parses identically).

The defect (PA-measured on main df6dad5ac):
```
<program>
type E:enum = { Bad(msg: string), Gone }
function risky(n)! -> E {
    if (n > 1) fail E::Bad("x")
    return n
}
export function go() {
    risky(2) !{
        .Bad(m) :> { return }
        .Gone :> { return }
    }
}
</program>
```
→ `error [E-TYPE-080]: Non-exhaustive error handler for E. Missing variant(s): Bad.` — the first pipe-less arm is silently dropped. Same with `.Bad m :>`. With `| ` in front of each arm it compiles. Locus: NOT traced by the PA — find where impl#1 parses `!{}` handler arms (search ast-builder / expression-parser / the guarded-expr construction; it likely splits arms on `|`). Report the path from entry to the decision.

Do:
1. Make the `!{}` arm list accept arms WITHOUT a leading `|`, for: `.V :>`, `.V(a) :>`, `.V(a, b) :>`, `::V(a) :>`, `_ :>`, `else :>`, with any arm body form already supported (block `{ … }`, single expression/statement), across newlines; mixed pipe / pipe-less in one handler also parses. Value position (`const r = f() !{ … }`) and statement position. The emitted JS for a pipe-less handler must be IDENTICAL to the same handler written with pipes (prove by diffing the compiled output of both spellings for several shapes).
2. Do NOT add any new diagnostic or lint (the W-lint lands later with the SPEC amendment). Do NOT add the `_ err :>` whole-error binder (separate gap). Do NOT change `match` parsing.
3. Tests: unit/integration tests for each shape above (pipe-less ≡ piped, same output), plus a conformance case if the conformance suite has a natural home (conformance/cases/error/…; follow an existing case's file layout exactly, with expected.json).
Verification (DO NOT report done without it):
(a) the reproducer above compiles and `go()` runs (execute the compiled output for one case and show the matched arm runs);
(b) R26 / differential: recompile the whole real corpus (examples/, samples/compilation-tests/, conformance/cases/, stdlib) on the base and on your branch and diff the emitted artifacts + diagnostics — expected: ZERO change (the corpus only uses the piped form); report the counts and any delta. If there is a delta, explain each one.
(c) full gate: `bun test compiler/tests/{unit,integration,conformance}` green.
Direction of change: NEWLY-ACCEPTING toward a ruled contract (conformance restoration) — say so in the commit body with the ruling pointer, and add a gap entry update: if docs/known-gaps.md has an entry for this (grep `pipe` / `s452`), mark it resolved with your SHA; if none exists yet (another dispatch may be filing it), note that in your report.
FINAL REPORT (<600 words): worktree, FINAL_SHA (== pushed tip), locus + trace, files touched, test counts, the differential result (counts, delta), `git status` clean.
