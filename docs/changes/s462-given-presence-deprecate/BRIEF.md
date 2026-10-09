# BRIEF — s462-given-presence-deprecate

Change-id: `s462-given-presence-deprecate`. Dispatched S462 (2026-10-09) by the PA. Agent: scrml-js-codegen-engineer, isolation worktree.

## The ruling (governs everything below — quote it, do not reinterpret)
bryan, S462, "a, go" (scrml-support/user-voice-scrml.md §S462): the in-place presence guard `given x :> { … }` — incl. the multi-variable `given x, y :>`, the markup-context `given` form, and the `given x :>` match arm — is SOFT-DEPRECATED through the SPEC §63 lifecycle. NOT removed. The rebind form `given c = @h :>` (§66.7.5) is NOT affected. Codes (PA reading, bryan veto window): `W-GIVEN-PRESENCE-DEPRECATED` (fires) + reserved `E-GIVEN-PRESENCE-DEPRECATED` (named in §34, never emitted).
Context: S460 a′ ruled ONE presence test — a bare `x` whose type is `T | not` in a condition IS the presence test (narrows where true), with `x is given` / `x is not` as the explicit pair (SPEC §42.4, §42.2.2a). In-place `given` is a redundant third spelling.

## Governing sentences (read IN FULL before any edit)
- SPEC §63.2 (`compiler/SPEC.md`, grep `### 63.2`): "A deprecation is well-formed only if, at Stage-1 landing, it co-lands {a W-lint that parses IDENTICALLY} + {a reserved E-code named in §34} + {a --fix/scrml fix rule, or a designer-card waiver}. A deprecation MUST NOT name a removal version at Stage-1 landing."
- SPEC §63.5: during the window "the deprecated form must produce runtime identical to the canonical form"; "the W-code is a conformance-required code".
- SPEC §42.2.3 (the `given` guard, grep `#### 42.2.3`), §42.4 (conditions), §42.2.2a (`is some` / `is given`), §18 match arms.
Direction-of-change: the lint is INERT for artifacts (warnings only, W- partitions to result.warnings). Prove it: emitted artifacts byte-identical across the corpus before/after, diagnostics differ ONLY by the new W-code.

## Deliverables (one logical unit — code + tests + SPEC in coherent commits)
1. **SPEC**: §42.2.3 gets a soft-deprecation banner + a `> **Provenance:** ruling:user-voice-scrml.md S462 "a, go" · supersedes: (none — §42.2.3 stays normative for the window)` line; the canonical replacements shown (guard → `if (x) { … }` or `if (x is given) { … }`; multi → `if (x is given && y is given)` — VERIFY which compound form is legal under §42.4 statement rules before writing it; match arm `given x :>` → `else :>` after a `not :>` arm, or `x is given` where needed). §34 rows for both codes. §63.7/§66.21-style retired-form table: add the row where such forms are listed (find it; do not invent a new table). Regenerate SPEC-INDEX (`bun run scripts/regen-spec-index.ts`), FACTS (`bun scripts/facts.ts --write`), any other generated doc whose `--check` goes red.
2. **impl#1 lint**: emit `W-GIVEN-PRESENCE-DEPRECATED` (severity warning) at every in-place `given` guard / given-arm / markup given. NOT at the rebind `given c = …` form. Mirror the precedent of `W-GIVEN-ARROW-LEGACY` (PA-located-verify: `compiler/src/ast-builder.js`, `compiler/src/type-system.ts` — find where that code is emitted and mirror it; report whether the hypothesis held). A `given x => …` source should get the presence code; decide whether W-GIVEN-ARROW-LEGACY also fires (prefer NOT double-firing — one diagnostic naming the full rewrite) and state your choice.
3. **`scrml fix` rule** (`compiler/src/commands/fix*.js` — find how existing rules register): AST/span-driven rewrite, never regex-on-source in a post-AST stage (overlay Rule 7). Rewrite must be semantics-preserving: compile the rewritten file and show identical runtime behaviour (or identical emitted JS modulo the rewrite) on every corpus site. Fail closed on any shape it cannot rewrite safely (leave it, report it). Idempotent.
4. **Migrate the corpus** with the fix rule: grep EVERY `.scrml` under the repo (samples/, examples/, conformance/, stdlib/, docs/ fixtures, compiler/tests fixtures that are not deliberately testing `given`) — the PA count says ~9 uses in S19 gauntlet fixtures; MEASURE it, report the real count + files. Tests whose purpose is to test `given` keep it and assert the W-code.
5. **Conformance**: a case pinning the W-code on the guard, the multi form, the arm; and a case that the rebind form does NOT fire it. Runtime-half: deprecated form and canonical form behave identically.
6. **Bootstrap** (`compiler/self-host-v2/`): check whether its parser handles `given`. If yes, the W-code twin is owed — implement it if small, else file a gap in docs/known-gaps.md with `locus=` and report. `docs/bootstrap-conformance.md` must regenerate cleanly.
7. known-gaps: if `g-given-outside-machine-rule-body-mislowers-silently` or other given gaps are affected, annotate (do not resolve without evidence).

## Interaction with in-flight work
PR #1380 (branch `land/s461-given-cell-lowering`, another session's) fixes `given @cell :>` lowering and touches emit-logic + conformance + generated docs. Do NOT edit its fix. Expect generated-doc conflicts at landing; the PA merges. If you need the #1380 fix to prove runtime identity for `given @cell`, note it and test on non-cell receivers.

## Process (non-negotiable)
- F4 startup gate (below). `bun install` + `bun run pretest` from the worktree CWD (NOT `bun --cwd X run`).
- Commit after each change; maintain `docs/changes/s462-given-presence-deprecate/progress.md` (append-only, timestamped). First commit message: `WIP(s462-given-presence-deprecate): start at $(pwd)`.
- Never `git stash` (shared across worktrees); never pattern `pkill`; never `--no-verify`; never touch hooksPath.
- TMPDIR: leave unset or `~/.cache/scrml-agent-tmp/s462-given-presence-deprecate/`, never inside a repo.
- Run the browser-tier gate step exactly as `.github/workflows/ci.yml` runs it before reporting.
- `bun run types:check` must pass (blocking CI step).
- Context budget: if you pass ~70% context, commit, write progress.md, and report.

## Report
WORKTREE_PATH · FINAL_SHA · files touched · corpus count measured (command + files) · inert proof (artifact diff command + result) · locus hypothesis held/refined/wrong · bootstrap disposition · anything you chose that sets direction (for bryan's veto).
