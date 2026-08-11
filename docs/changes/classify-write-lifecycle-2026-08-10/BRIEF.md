# BRIEF — `classifyWriteAgainstSpec` never consults the type; a `(not to T)` assignment jumps 1→3

**Dispatched:** 2026-08-10 (S337-bryan). **Agent:** scrml-js-codegen-engineer, `isolation:"worktree"`, opus.
**Base:** `origin/main`. **Authority:** dpa-023 (`(dpa:dpa-023)`), ratified-direction S337, bryan: *"b"*.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` + Task-Shape Routing; then `domain.map.md`, `structure.map.md`,
`error.map.md`. Refreshed this session (#495). Report whether load-bearing.

## ⛔ HARD CONSTRAINTS — two live sibling dispatches this session
- **DO NOT edit `compiler/SPEC.md` or the §34 catalog.** A sibling dispatch owns them. This is a BUG FIX;
  it should need neither. **If you conclude it does — STOP and report.**
- **DO NOT edit `compiler/src/codegen/emit-client.ts` or `dependency-graph.ts`** — a second sibling owns
  those. Your surface is `compiler/src/type-system.ts` and its tests.
- **DO NOT edit `docs/known-gaps.md`** (PA-owned) — report what to file.

## SCOPE — READ THIS TWICE, IT IS NARROWER THAN THE DD

dpa-023 proposed a THIRD type-state, `pending`, for `(not to T)` lifecycle cells (`not → pending → T`).
**bryan ratified the DIRECTION and DEFERRED the build to its own arc.** He did NOT authorize adding the
`pending` state here.

**Your job is ONLY the defect that exists independent of the rung.** `classifyWriteAgainstSpec`
(`compiler/src/type-system.ts:25865`, **duplicated at `:26799`** — PA-located, verify both) classifies a
write by **comparing SOURCE TEXT** and never consults the declared type. dpa-023's finding:
*"the compiler models TWO states and the assignment illegally jumps 1→3."*

**Do NOT introduce a `pending` state, a new type-state enum member, or a new diagnostic code.** If your
analysis says the defect CANNOT be fixed without one, that is a genuine finding — **STOP and report it**
rather than building the deferred arc under this brief. That outcome is sanctioned.

## WHAT TO ESTABLISH FIRST (report before changing behaviour)
1. **Reproduce it.** Construct a `(not to T)` cell whose write the source-text comparison misclassifies,
   and show the wrong classification by execution. If it does NOT reproduce, say so — `NOT-REPRODUCED`
   with the empirical table is a valid and valuable outcome (dpa-023's §19.6 mechanism claim was already
   PA-verified FALSE, so its mechanism claims do not get automatic trust).
2. **Are `:25865` and `:26799` genuinely duplicated?** If so, the fix is one change applied twice, or a
   shared helper — say which and why. A duplicated classifier is itself the drift shape this codebase
   keeps hitting.
3. **Direction-of-change.** Making the classifier consult the type may turn writes previously accepted
   into `E-TYPE-001` (newly-rejecting) — the reversible direction, but it owes a **MEASURED** migration.
   Recompile the tracked corpus (`git ls-files '*.scrml'`, NOT a directory glob — the suite writes
   untracked fixtures between runs and moves the denominator) and report count + files. **A non-zero
   count is a finding to report, not corpus to migrate unilaterally.**

## VERIFICATION
- Full suite `bun test compiler/tests/{unit,integration,conformance} --bail` → 0 failures. Takes >5 min;
  a Bash timeout does NOT mean the commit failed — verify `git show --stat`.
- A test that FAILS before and passes after, for the misclassification.
- The §14.12 lifecycle behaviour that already works (`given`/`is not`/`match` discrimination as
  transition; `transition()` for variant-progression) must be unchanged — prove it.
- Corpus diagnostic delta = exactly the intended change, nothing else.

## PROCESS
Commit after each meaningful unit + append-only `progress.md` here (your only crash anchor).
Path discipline: absolute paths under YOUR worktree root; never `cd` into the main checkout
(`git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`); first action `pwd`, must start
`/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` or STOP. Startup: `bun install` then
`bun run pretest`. **NEVER `--no-verify`**; never touch `core.hooksPath`.

**Report:** worktree path · final SHA · files touched · whether it reproduced · both loci held/refined/
wrong · direction-of-change + measured migration · maps load-bearing? · anything deferred.
