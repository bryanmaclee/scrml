# BRIEF (archived verbatim at dispatch time)

Dispatch: `each-request-ref-nested-lift-2026-08-13`
Agent worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab0480c75e2b5c45f`
Base HEAD: `3ebaa01ea47a0985b4725c885eb39b8b14cdb753`

---

🔒 CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do this FIRST, before any other action)

1. Run `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not, STOP and report — do not proceed.
2. Run `git rev-parse --show-toplevel` — must equal that same worktree root. Run `git status` — must be clean.
3. `bun install` (a fresh worktree does NOT inherit `node_modules`; the commit hook fails with "cannot find package 'acorn'" otherwise).
4. `bun run pretest` (populates the gitignored `samples/compilation-tests/dist/` browser fixtures; ~130 ECONNREFUSED-shaped failures without it).
5. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml` (the shared checkout). Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"` for everything.
6. Make your FIRST commit message `WIP(each-request-ref): start at $(pwd)` so the path prefix is verifiable at landing.

A PreToolUse hook rejects Edit/Write that leak into the main checkout. Bash-based writes are NOT covered by it — so prefer Edit/Write on worktree-absolute paths.

# MAPS — REQUIRED FIRST READ
Read `<WORKTREE_ROOT>/.claude/maps/primary.map.md` FIRST; follow its Task-Shape Routing for a codegen task. Maps stamped `4f034e13`, HEAD `3ebaa01e` (6 newer landings: #514 #515 #516 #518 #520 #521). Treat map content as a HYPOTHESIS.

⚠ **`primary.map.md` invariant 54 is FALSE and you must not trust it.** It states the attribute-routing class is closed on "the two per-item paths" and that the nested path "is covered by #512's reparse instead." Both halves are wrong — that is exactly the bug you are fixing. Correcting that invariant is part of this task (see deliverable 4).

# THE BUG — HIGH, live on `main` right now, SILENT (exit 0, no diagnostic)

A Tier-1 `<each>` nested inside a Tier-0 lift body (`${ for … { lift <tr><each …>` or `${ if … { lift`) mis-routes a per-item ATTRIBUTE request-ref to the §36 input-state registry instead of `_scrml_request_<id>`.

The emitted client then references `_scrml_input_state_registry`, which is **tree-shaken out of the runtime** when the file declares no §36 input state — and nothing ever populates it. Result: a hard `ReferenceError` at mount that kills the ENTIRE client bundle, not just the row.

**PA-VERIFIED, twice, by me.** Compile exits 0. The emitted `.client.js` references `_scrml_input_state_registry` exactly once; `scrml-runtime.*.js` contains it ZERO times; `_scrml_input_state_registry.set(` appears ZERO times. Reproducer (already on disk, use it):

`/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c356bf12-763a-4917-934c-7f3831327f9f/scratchpad/rev/req/q-each-in-forlift-tr.scrml`

The load-bearing shape is the idiomatic table:
```scrml
<table>${ for (let r of @rows) { lift
  <tr><each in=@rows><td class=${<#profile>.data is some ? "y" : "n"}>x</td></each></tr>
} }</table>
```
It also reproduces via `${ if (@flag) { lift <div><each …>`.

**Correct behaviour:** the per-item attr request-ref routes to `_scrml_request_profile.data`, exactly as the already-fixed top-level `<each>` shape does. Control that shows the correct output: `.../scratchpad/rev/req/a-each-attr.scrml` (if absent, construct the top-level `<each in=@rows><td class=${<#profile>.data is some ? …}>` equivalent).

# LOCUS — PA-LOCATED, VERIFY FIRST

Relayed from an adversarial review and structurally corroborated by me, but **NOT independently traced end-to-end by me**. Treat as a hypothesis and report whether it HELD, was REFINED, or was WRONG:

- `compiler/src/codegen/emit-each.ts:3371` — `emitNestedEachFromMarkup`, which never sets `_eachRequestIds`
- `compiler/src/codegen/emit-each.ts:1748` — `const _requestIds = _eachRequestIds` reads null here, so the routing gate is skipped
- `compiler/src/codegen/emit-each.ts:3660` — the ONLY site that sets `_eachRequestIds`, inside `emitEachBodyRenderForFile`
- called from `compiler/src/codegen/emit-lift.js:725`

**Fix the ROOT, not the position.** This family has now been under-enumerated THREE times (#511, #512, and this). A fix that threads the request-ids through one more call site and stops is the same mistake a fourth time. Ask: why does a per-item render path exist that can be reached without its request-id context, and can that be made structurally impossible rather than remembered at each call site? If the structural fix is out of proportion, say so explicitly and justify the narrower one — do not silently take the small option (Rule 3: right beats easy; surface the shortcut so it can be vetoed).

# ADJACENT POSITIONS — enumerate before you fix

An independent review already confirmed these 12 route CORRECTLY (do not break them): each-body text interp, `if=`, `show=`, `style=`, `class:x=`, nested each-in-each, `<each of=N>`, for-lift `style=`, for-lift text. **Enumerate the remaining positions yourself and test each.** A separate MED defect exists in the same family — `while`/`do…while` lift bodies never push the request-id stack (`emitWhileStmt`, `compiler/src/codegen/emit-control-flow.ts:1000`, vs `emitIfStmt:421` / `emitForStmt:578` which do). **If your root fix closes that too, say so and pin it. If not, leave it and report why** — it is separately filed, do not scope-creep silently.

# VERIFICATION — mandatory, and grep is NOT sufficient

- **EXECUTE the emitted bundle.** A load-time `ReferenceError` has repeatedly been missed here by grepping emitted text for a marker. Mount the emitted client under happy-dom (or `bun` the artifact) and assert no throw AND the expected DOM. "The marker is present" is not evidence.
- Assert positively that the fixed output contains `_scrml_request_profile` and does NOT contain `_scrml_input_state_registry`.
- Read BOTH diagnostic streams — `result.errors` AND `result.warnings`. `E-DG-002` carries severity `warning`; a probe reading only `errors` is blind to it.
- **Direction-of-change (`pa-base` §8):** classify your change as inert / newly-rejecting / newly-accepting / semantics-changed. If anything becomes newly-rejecting, MEASURE the corpus migration (`grep` the real corpus, report count + files). Assumed-zero is not measured-zero.
- Full suite: `bun run test` (chains pretest). ⚠ This suite is ORDER-DEPENDENT and SELF-SEEDING — it has produced 53, 49 and 51 failures on one unchanged tree. **A failure COUNT is not a measurement; compare NAME SETS against your merge-base.**
- Add a regression pin (unit or conformance) covering the nested-in-lift shape.

# SCRML SOURCE FORM (so your reproducers actually reproduce)
V5-strict: top-level reactive decl `<x> = 0`; `@x = 0` ONLY inside `${...}`. Mixing the forms means the bug does not reproduce. `null`/`undefined` do not exist in scrml — absence is `not`; `""`/`0`/`false`/`[]`/`{}` are DEFINED values.

# PROCESS
- **Commit after every meaningful unit** — WIP commits expected; the branch is your crash anchor. Maintain `docs/changes/each-request-ref-nested-lift-2026-08-13/progress.md` (append-only, timestamped: what you just did, what's next, blockers).
- Archive this brief verbatim to `docs/changes/each-request-ref-nested-lift-2026-08-13/BRIEF.md` and commit it on YOUR branch.
- **NEVER use `--no-verify`,** and never override `core.hooksPath` or otherwise disable a hook. If a gate blocks you, report it — do not route around it. This is not negotiable and has been violated before.
- Do NOT merge to `main`, do NOT push to `main`. Work on your branch; the PA lands via PR.

# DELIVERABLES
1. The fix, with the root-vs-position reasoning stated.
2. Regression pin(s) for the nested-in-lift shape.
3. Execution evidence: emitted bundle mounted, no throw, correct DOM, and the `_scrml_request_*` assertion.
4. A corrected replacement for `primary.map.md` invariant 54 (the text only — I will land the map edit).
5. Whether the locus hypothesis held / was refined / was wrong.
6. Whether the `while`/`do…while` sibling is closed by your fix.
7. Final commit SHA + files-touched list.
