# BRIEF — s395-tilde-arm-body

Close `g-bare-expr-in-if-arm-rebinds-tilde-context-corrupting-the-result-var` (HIGH, silent-wrong)
**under a fresh ruling**, and **reconcile the SPEC contradiction the ruling settles**. Both halves
land in the SAME arc; the codegen fix alone leaves the contradiction standing in the text.

## THE RULING (bryan, user-voice S395) — this is the governing authority for the arc

> **Limb (a): §17.6.2 governs an if-as-expression arm body.** A bare expression statement inside an
> arm is a **side effect**. It does NOT initialize `~`, does not rebind the tilde context, and does
> not touch the arm's result. Only a `lift` — or the §17.6.10 single-expression sugar — designates
> the result value.

Grounds ratified with it: specific-over-general (§17.6.2 is the section about arm bodies, §32 is the
general accumulator rule); it fixes the root rather than a position; it restores a shape SPEC ships
a worked example for (§17.6.9 ex 4). The FORK-RULE row-3 counter (newly-rejecting is the reversible
direction) was surfaced and **ruled past**, because the alternative does not fix anything — it makes
the construct illegal to dodge a codegen bug.

⚑ **`~` AS A GENERAL PRIMITIVE IS NOT BEING REDESIGNED HERE.** Whether an arm body should be a `~`
CONTEXT BOUNDARY in its own right (§32.4, beside `${}` contexts and function bodies) is banked as a
separate deliberation and is explicitly OUT OF SCOPE. Do not implement it, do not half-implement it,
do not add a boundary. If your work suggests the boundary is the only clean fix, **STOP and report
that** — it is a finding, not a licence.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST; follow its Task-Shape Routing. Stamp `ad7b65dc`, base
`8f3c5b74` — **3 commits behind, all of them landed this session and two of them in your surface**
(#818 route-inference/collect, #819 filings). Treat map claims as hypotheses. **Invariant 84 is
directly relevant and is CURRENT**: an if-as-expression at a BINDING SITE is lowered in
`emit-logic.ts`, reached via the `let-decl`/`const-decl` dispatch through `node.ifExpr` — not in
`emit-html.ts`/`emit-each.ts`/`emit-control-flow.ts`. Report whether the maps were load-bearing.

## STARTUP — CRITICAL (F4)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
   `git rev-parse --show-toplevel` MUST equal it; tree clean. Any failure: STOP, report, exit.
2. `git merge-base HEAD origin/main` MUST equal `origin/main`.
3. `bun install`.
4. Run `bun run pretest` PLAINLY from the worktree CWD. ⚑ `bun --cwd <path> run pretest` silently
   no-ops and **exits 0** — check the artifact exists, never the exit code.
5. First commit: `WIP(tilde-arm-body): start at $(pwd)`.
6. This brief is on branch `fix/s395-tilde-arm-body-ruling`, NOT on `origin/main`. Step one:
   `git fetch origin fix/s395-tilde-arm-body-ruling && git checkout FETCH_HEAD -- docs/changes/s395-tilde-arm-body/`

## PATH DISCIPLINE
Edit/Write on **worktree-absolute paths only**; NEVER `cd` into the main checkout; use
`git -C "$WORKTREE_ROOT"`. ⚑ **NEVER `git stash`** — `refs/stash` is SHARED across worktrees; do
base-vs-build flips by **FILE COPY**. ⚑ **NEVER a bare `pkill -f`/`killall`** on a shared command
string. Keep `progress.md` inside `docs/changes/s395-tilde-arm-body/`, NOT at the repo root.
**NEVER `--no-verify`**; do not touch `core.hooksPath`.

## THE DEFECT — PA-REPRODUCED ON MERGED MAIN

```scrml
${
    <n>: int = 5
    function note(s: string) { let _ = s }
    function show() {
        const label = if (@n > 0) { note("a") lift "pos" } else { lift "neg" }
        return label
    }
}
<p id="e">${show()}</>
```

Compiles **exit 0, zero diagnostics**. Emitted:

```js
let _scrml_tilde_4 = null;
if (…) {
  let _scrml_tilde_5 = _scrml_note_2("a");   // fresh mint AND rebinds tildeContext.var
  _scrml_tilde_5 = "pos";                     // the `lift` writes the WRONG var
} else {
  _scrml_tilde_5 = "neg";                     // NOT IN SCOPE here
}
const label = _scrml_tilde_4;                 // ALWAYS null
```

Two defects: `label` is always `null`, AND the else-arm assigns a name block-scoped to the *then*
branch. PA-verified the artifact is a **classic script** (no `"use strict"`, no `type="module"`), so
that second one is a silent **implicit global**, not a `ReferenceError`.

⚑ Note the else-arm behaviour DIFFERS by form: a SUGAR else (`else { "neg" }`) already writes the
outer var correctly after #815; only the explicit-`lift` else still mis-writes. Both must be correct.

## LOCUS — PA-located, VERIFY don't trust
`compiler/src/codegen/emit-logic.ts`, the shared **bare-expr handler** at approximately **`:1723`
and `:1882`**: under an active `tildeContext` it emits `let <fresh> = <expr>;` **and rebinds
`tildeContext.var`**. That is correct §32 pipeline behaviour in a general logic body and is exactly
what the ruling says must NOT happen inside an if-as-expression arm.

#815 added `_emitValueFormSugarArm` (~`:4438`) and threaded `tildeVar` through `emitIfExprAltChain`
(~`:4462`, both limbs) for the *sugar* shape. This arc is the sibling: the **statement+`lift`** shape.
Prefer extending the existing seam over a third mechanism. Report whether the locus HELD, was
REFINED, or was WRONG.

## SCOPE

**IN:** a bare expression statement in an if-as-expression arm body emits as a plain statement —
no fresh tilde mint, no `tildeContext` rebind — so a following `lift` (or the sugar) writes the
arm's real result var, in BOTH the `if` and `else` limbs and in `else if` cascades.

**OUT — do not touch:** `~` semantics in ordinary logic bodies (§32.2 stands there, unchanged);
the arm-body-as-`~`-boundary question (banked); the derived-cell binding, which still fails loud
with `E-CODEGEN-INVALID-LOGIC` and is a widening that is bryan's;
`compiler/src/symbol-table.ts:10642`, a deliberately TOTAL `Object.keys` walk — routing it through
any enumerator NARROWS a correct site.

## THE SPEC HALF — REQUIRED, same arc

SPEC currently answers this question twice and disagrees with itself:

- **§17.6.2** — the arm body *"MAY contain … function calls … Only one `lift` statement designates
  the result; other statements are side effects or intermediate computation."*
- **§32.2** — *"An expression statement whose value is not bound to any identifier SHALL initialize
  `~`."* With §32.3's exactly-once rule, `{ note("a") lift "pos" }` would be **E-TILDE-002**.

Under the ruling, **§17.6.2 governs inside an arm body.** Amend so a reader cannot land on the wrong
one: give **§32.2 the explicit arm-body carve-out** (an expression statement inside an
if-as-expression arm body does NOT initialize `~`), and add the reciprocal cross-ref at §17.6.2.
Search for and reconcile EVERY other locus that states the general rule without the carve-out —
#802's reconciliation surface turned out to be **three times** what its ruling named, so do not
assume two sites. Carry a Rule 4b line:

```
> **Provenance:** ruling:user-voice-scrml.md S395 — "your rec" ratifying limb (a), §17.6.2 governs an if-as-expression arm body
```

## VERIFICATION

**Phase 1 — bite, both directions, by FILE COPY.** base `let _scrml_tilde_5 = _scrml_note_2("a");`
+ `_scrml_tilde_5 = "pos";` → build: the call emitted as a plain statement and the `lift` writing
the OUTER var. Restore, re-verify by diff stat.

**Phase 2 — the shape matrix.** then-arm and else-arm, `lift` and sugar forms, `else if` cascades,
and an arm with MULTIPLE leading statements. Also confirm the else-arm no longer writes an
out-of-scope name in any combination.

**Phase 3 — measured differential.** Direction is `semantics-changed` (null → the correct value).
Recompile the corpus; report the **count of changed files and NAME them**. Expect zero — the shape
measured **corpus-zero** at ruling time (of 5 bound-position if-as-expression sites, the only one
with an intermediate statement uses a `let`-decl, which does not rebind). **Confirm that by
measurement, not by quoting this brief**, and STOP and report anything you cannot explain.

**Phase 4 — R26 empirical** (`../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`; r26 does
not exist, use r27/r28 too) on the post-fix baseline, with a shape check — not "tests pass".

Plus `bun run test` green and conformance cases pinning the ruled shape in both limbs.

## ⚑ A SEPARATE FINDING — DO NOT FIX IT HERE, BUT DO NOT BREAK IT EITHER
§32's enforcement does not fire: **six probes, including §32.5's own verbatim `${ process(~) }` and
§17.6.6's partial-`if` example, produce ZERO `E-TILDE` diagnostics on merged main**, though
`TildeTracker`/`checkLinear` exist and `checkLinear` is invoked unconditionally at file level. That
is filed separately and is NOT this arc's job. If your change would make any `E-TILDE` code start OR
stop firing, that is a reportable change of behaviour — say so explicitly.

## REPORT BACK
worktree path · final SHA · files touched · locus verdict · Phase-1 bite (both directions) ·
Phase-2 matrix · Phase-3 changed-file COUNT + NAMES · Phase-4 empirical · the SPEC loci you
reconciled and how you searched for them · any E-TILDE behaviour change · maps load-bearing? ·
anything deferred.
