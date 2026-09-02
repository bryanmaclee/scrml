# BRIEF — s395-value-form-sugar-bound

Close `g-value-form-sugar-in-bound-position-emits-null` (HIGH, silent-wrong).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST and follow its Task-Shape Routing.
⚑ **THE MAPS ARE STALE.** Map stamp `2ec2ce3a`; branch base `origin/main` = `0dc4d014`.
Ten source files changed since the stamp, `emit-logic.ts` among the churn region.
**Treat EVERY map claim as a hypothesis to verify against source**, never as fact.
Report in your final message whether the maps were load-bearing (including "not load-bearing").

## STARTUP — CRITICAL (F4)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   `git rev-parse --show-toplevel` MUST equal it. Tree MUST be clean. If ANY check fails: STOP, report, exit.
2. Assert your base: `git merge-base HEAD origin/main` MUST equal `origin/main`.
3. `bun install` (worktrees do NOT inherit `node_modules`; the hook fails on missing `acorn` otherwise).
4. Run `bun run pretest` PLAINLY from the worktree CWD. ⚑ Do NOT use `bun --cwd <path> run pretest`
   — bun treats it as a bare `bun run`, prints the script list and **exits 0**, so it looks green and
   builds nothing. Verify the artifact exists, do not trust the exit code.
5. First commit message: `WIP(value-form-sugar): start at $(pwd)`.
6. This brief is on branch `fix/s395-value-form-sugar-bound-position`, NOT on `origin/main`, so it is
   NOT in your worktree by default. Step one:
   `git fetch origin fix/s395-value-form-sugar-bound-position && git checkout FETCH_HEAD -- docs/changes/s395-value-form-sugar-bound/`

## PATH DISCIPLINE
Edit via Edit/Write on **worktree-absolute paths only**. NEVER `cd` into the main checkout.
Use `git -C "$WORKTREE_ROOT"` and worktree-absolute paths for everything.
⚑ **NEVER `git stash`.** `refs/stash` is SHARED across every worktree — a stash here can be popped
into the main checkout or another agent's tree. Do base-vs-build flips by **FILE COPY** only.
⚑ **NEVER a bare `pkill -f` / `killall`** on a command string every checkout shares (e.g.
`pkill -f "bun test"`) — that matches suites running in OTHER checkouts and leaves no trace.
Kill by PID captured at launch, or filter on cwd.
Commit after EVERY meaningful edit (WIP commits expected) + keep an append-only `progress.md`.
The branch + `progress.md` are your only crash-recovery anchor.
**NEVER `--no-verify`.** Not on pre-commit, not on pre-push. Do not touch `core.hooksPath`.

## THE DEFECT — PA-REPRODUCED BY EXECUTION (this is evidence, not a report)

SPEC §17.6.10 (landed #802) made a branch body that is exactly one expression sugar for `{ lift <expr> }`.
§17.6.2 normative: *"A branch body that is exactly one expression SHALL be equivalent to `{ lift <expression> }`."*

That sugar works in the **interpolation-sole-content** path. It is **NOT** implemented in the
**bound / statement** position, where it silently emits `null`.

Reproducer C (`const label` = a LOCAL binding — note: `const label`, NOT `const <label>`):
```scrml
${
    <n>: int = 5
    function show() {
        const label = if (@n > 0) { "pos" } else { "neg" }
        return label
    }
}
<p id="c">${show()}</>
```
Compiles **exit 0, zero diagnostics**. Emitted (`.client.js`):
```js
function _scrml_show_2() {
  let _scrml_tilde_3 = null;
if (_scrml_cs_reactive_get("n") > 0) {
  let _scrml_tilde_4 = "pos";     // ← FRESH shadowed decl; outer never written
}
else {
  let _scrml_tilde_5 = "neg";     // ← FRESH shadowed decl
}
const label = _scrml_tilde_3;     // ← ALWAYS null
  return label;
}
```
The explicit-`lift` twin is the CONTROL and is correct — identical source with `{ lift "pos" }`
emits `_scrml_tilde_3 = "pos";` (assignment, no `let`).

## THE LOCUS — VERIFY, DO NOT TRUST (PA-located; the trace below IS stated)

`compiler/src/codegen/emit-logic.ts`.

⚑ **The fix pattern ALREADY EXISTS IN THIS FILE, one construct over.** Around **`:5001-5024`** the
**§18.5 match block-arm** case was fixed for the IDENTICAL defect. Its own comment states the bug
verbatim: *"the shared bare-expr handler (under an active tildeContext) instead minted a FRESH
`let _scrml_tilde_N = …`, so the outer result var stayed null (silent-wrong)"*, and the fix is
`bodyCode.push(\`  ${tildeVar} = ${rhs};\`)` for the tail bare-expr.

`if`/`else if`/`else` arm bodies were never given the same redirect. **Mirror the proven in-file
pattern; do not invent a second mechanism** — and if your trace shows the two can share ONE helper,
prefer that (root, not position — a per-position fix here is a bug generator, and this IS the second
position of the same bug).

Report whether the hypothesis HELD, was REFINED, or was WRONG. A locus found by symbol search is not
a locus found by tracing; if you cannot state how execution reaches a line, say so.

## SCOPE — and one shape that is explicitly OUT

IN: the bound/statement-position `if`-as-expression sugar (`const`/`let` binding sites, which are
what §17.6.3 sanctions), including the no-`else` case, where §17.6.4 requires the false path to be
`not` (bryan RULED this direction S395: no trailing `else` is required).

**OUT — do NOT "fix" this:** the DERIVED-CELL binding `const <label> = if (…) { … }` fails
`E-CODEGEN-INVALID-LOGIC` (exit 1) for BOTH the sugar AND the explicit-lift form. PA-verified.
**§17.6.3 names only `const` / `let` binding sites — a derived state cell is an UNSPECIFIED shape,
and it is currently failing LOUD, which is the safe direction.** Making it work is a WIDENING and is
bryan's ruling, not yours. Note it in your report; do not build it. (Asymmetry worth reporting:
`const <label> = match @level { … }` in a derived cell DOES work and ships as a conformance case
`conformance/cases/match-block/value-form-derived`.)

## VERIFICATION — all three phases are MANDATORY

**Phase 1 — bite proof, BOTH directions, by FILE COPY (never stash).**
Show the emitted line for reproducer C on base vs build:
base `let _scrml_tilde_4 = "pos";` → build `_scrml_tilde_3 = "pos";`. Restore, re-verify by diff stat.

**Phase 2 — direction-of-change classification. This lands as `semantics-changed`, which is the
class every gate is weakest against — no diagnostic moves, only the artifact does. So it owes a
MEASURED corpus differential, not an assumed one:**
recompile the real corpus and diff artifacts. Report the **count of files whose emitted output
changes, and name them**. Every changed file must be a site that was emitting `null` and now emits
the specified value — if ANY file changes for a different reason, STOP and report; that is blast
radius, not the fix. **Assumed-zero is not measured-zero.**

**Phase 3 — R26 empirical.** Recompile real adopter `.scrml`
(`../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` and the live adopter sources) on the
POST-fix baseline via `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>`.
Symptom check is a SHAPE check, NOT "tests pass": grep the emitted client JS for a
`let _scrml_tilde_` **inside an if/else arm under an active tilde context**. **DO NOT mark DONE
without an empirical pass.**

Plus: `bun run test` (chains pretest) green, and conformance cases pinning BOTH halves — the bound
sugar WITH `else` and WITHOUT `else` (the no-`else` case must bind `not` and must NOT warn, per
§17.6.4's *"The compiler SHALL NOT emit an error or warning for a missing `else` arm"*).

## PROVENANCE (Rule 4b — required on the landing)
`prov=spec:§17.6.2 — "A branch body that is exactly one expression SHALL be equivalent to { lift <expression> }"`
This is conformance restoration toward an EXISTING normative sentence, not a widening.

## REPORT BACK
worktree path · final SHA · files touched · locus verdict (held/refined/wrong) · Phase-1 bite proof
(both directions) · Phase-2 changed-file COUNT and NAMES · Phase-3 empirical result · maps
load-bearing? · anything you deferred.
