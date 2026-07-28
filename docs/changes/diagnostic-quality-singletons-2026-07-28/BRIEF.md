# DISPATCH CONTEXT
You are `scrml-js-codegen-engineer` on a scrml compiler-source fix. Baseline: scrml `main` @ **`89db7981`** (v0.7.1). You work in an `isolation: "worktree"` checkout. Model: opus.

# MAPS — REQUIRED FIRST READ + currency note
Read `.claude/maps/primary.map.md` §"Task-Shape Routing" (compiler-source codegen fix) FIRST, and report the Maps line in your final report ("load-bearing finding: …" or "not load-bearing").

⚠️ **The map is STALE.** It is stamped `c700c435` / 2026-07-27T11:15Z; HEAD is `89db7981`, **12 compiler/src commits ahead**. Treat every map claim as a STARTING HYPOTHESIS and verify against current source with grep/Read. Post-map landings that touch codegen and may have moved your loci:
`#215` Wave-1c cross-chunk soft-nav (chunk loader + runtime-template) · `#214`/`#218`/`#222`/`#226`/`#227` the per-item + nested-`<each>` reconcile family (`emit-each.ts`, `emit-lift.js`, `emit-variant-guard.ts`, `binding-registry.ts`) · `#224` `tabSpan→span` in `api.js` · `#209` `E-SQL-003` in `ast-builder.js` · `#206`/`#208`/`#217` schema/db-migrate. `#236` was a comment-only privacy scrub — no behavior change, but it DID touch comments in `schema-differ.js`, `db-migrate.js`, `emit-server.ts`, `emit-client.ts`, `tenant-egress.ts`, `type-system.ts`; do not read those diffs as logic changes.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
S99 had FOUR path-discipline leaks and S126 had FOUR Edit/Bash-divergence leaks. Hold the line.
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it resolves under ANY other repo (e.g. `scrml-support`) → **STOP and report** (the S90 CWD-routing failure). Save it as `WORKTREE_ROOT`.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git -C "$WORKTREE_ROOT" status --short` MUST be clean.
4. `git -C "$WORKTREE_ROOT" merge main` — your base may be a session-start snapshot; merge current main (expect clean/fast-forward).
5. `cd "$WORKTREE_ROOT" && bun install` — worktrees do NOT inherit `node_modules` (the hook fails "cannot find package 'acorn'" otherwise).
6. `bun run pretest` — populates the gitignored `samples/compilation-tests/dist/` browser fixtures (~130 ECONNREFUSED-shaped failures without it).
7. Your FIRST commit message MUST embed the verbatim `pwd`: `WIP(<task>): start at <pwd>`.

## Path discipline (MANDATORY)
- Apply ALL source edits via Bash (`perl -i -pe` / `python3` / `cat > heredoc`) on WORKTREE-ABSOLUTE paths containing the `.claude/worktrees/agent-<id>/` segment. Do NOT use Edit/Write on source files — they have leaked to MAIN before. Echo the target path before each write; re-verify with `git -C "$WORKTREE_ROOT" diff` after.
- NEVER `cd` into the main repo or outside `WORKTREE_ROOT` for writes/installs/compiles. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths. Reading from main is READ-ONLY and fine.

# COMMIT DISCIPLINE (two-sided)
After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` → `add` → **commit immediately**. Do NOT batch — the branch is your crash-recovery anchor. Keep an append-only `progress.md` (timestamped: what was just done, what's next, blockers). Before reporting DONE, `git -C "$WORKTREE_ROOT" status` MUST be clean. **Never `--no-verify`** — if the pre-commit gate fails, STOP and report; do not bypass and do not override `core.hooksPath`.

# PHASE 3 — R26 EMPIRICAL VERIFICATION (MANDATORY before DONE)
Synthesized-input tests pass while the real path stays broken — that is exactly how these three defects reached an adopter. Before claiming DONE you MUST re-compile a real reproducer on your POST-FIX baseline and confirm the named symptom is gone AND no new symptom appears. **"Tests pass" is NOT the check** — the check is the bug-specific symptom grep/execution named in your task below. **DO NOT mark DONE without R26 passing.**

⚠️ **EXECUTE, don't grep.** All three of these bugs emit text that *looks* right and fails at runtime. Where the task says "execute", load the emitted bundle (happy-dom or `node`) and confirm behaviour — a marker being present in the output has repeatedly been a false green (S265 theme-switch, S268 `((hi))`, S278 U3).

# REPORT (final message, structured)
`WORKTREE_PATH` · `BRANCH` · `FINAL_SHA` · `FILES_TOUCHED` · `REGRESSION-TESTS-ADDED` (file + count) · `R26-RESULT` (the actual compile/execute evidence, not a claim) · `STOPPED?` (if the fix risks regressing an adjacent shape, STOP and report the survey rather than force it) · `MAPS-FEEDBACK`.

---

# LANE 3 — DIAGNOSTIC-QUALITY SINGLETONS (F-2 + D-3)

**Two small, genuinely file-disjoint fixes. Verified not to collide with Lane 1 (`codegen/index.ts`) or Lane 2 (`type-system.ts` / `emit-*.ts`).** This lane exists to bank cheap progress while the two hard lanes run; if either item turns out to be bigger than stated, STOP rather than growing it.

Both are **adopter-friction findings, not miscompiles.** Nothing here is fail-open and nothing blocks a build. The value is that both degrade the trustworthiness of a diagnostic — which is the surface adopters use to decide whether to believe the compiler at all.

## ITEM A — F-2: `E-PA-002` steers a newcomer into hand-duplicating their schema

`E-PA-002` fires when the `<db>` file is absent. Its message does **not** name `scrml db-migrate` as the first remedy, so a newcomer's next move is to hand-duplicate their `<schema>` via `bun:sqlite` — rebuilding by hand the exact artifact the compiler already knows how to generate.

**Fix locus (PA-located, verify):** `compiler/src/protect-analyzer.ts` — the only file in `compiler/src` carrying `E-PA-002`.

**Scope: a message-string change.** Name `scrml db-migrate` as the first remedy, keep the existing explanation. Do NOT change the fire condition — whether `E-PA-002` should hard-fail a build at all is a **separate open ruling in bryan's lane** (a build-time DB-existence check bites CI / fresh-clone / headless builds). You are improving the message, not relitigating the gate.

**R26:** compile a source with a `<db src=…>` pointing at a missing file; confirm the emitted message names `db-migrate`; confirm the fire condition is byte-identical to pre-fix on a control that already fired.

## ITEM B — D-3: `outline-none` unrecognized by the Tailwind engine

`outline-none` is a real Tailwind utility that the engine does not recognize, so `W-TAILWIND-UNRECOGNIZED-CLASS` false-fires on it. Cosmetic in isolation — but the whole value of that warning is as a **typo detector**, and a false positive on a real utility teaches adopters to ignore it.

**Fix locus (PA-located, verify):** `compiler/src/tailwind-classes.js` (the utility registry; `W-TAILWIND-UNRECOGNIZED-CLASS` also referenced from `api.js` — the registry is the edit site).

**Scope discipline:** add `outline-none` and any same-family siblings the registry is clearly missing (`outline`, `outline-dashed`, `outline-<width>` — check what the family actually is before adding). Do **NOT** attempt a general Tailwind-coverage sweep; that is a different, larger arc. If you find the registry is missing a whole family rather than one class, report the count and STOP.

**R26:** compile a source using `outline-none`; confirm the warning no longer fires AND that a genuinely bogus class (e.g. `outlin-none`) still DOES fire. **Prove the gate still bites** — a warning that stops firing on everything is worse than the false positive you are fixing (pa-base §8, the unproven-gate rule).

## KNOWN ADJACENT — do not fix here
`W-TAILWIND-UNRECOGNIZED-CLASS` also false-fires on class names defined in an in-scope `#{}` block (the lint only knows Tailwind utilities and does not cross-reference `#{}`-defined selectors). That is a **separate, larger defect** with its own entry. Note it if you touch the code path; do not fix it in this lane.

Likewise, `g-tailwind-class-scan-skips-engine-non-initial-arms` (MED, filed S295) is in the same *subsystem* but a different file (`codegen/collect-class-names.ts`) and a different mechanism (class COLLECTION, not utility RECOGNITION). Out of scope here.

## STOP-IF
- Either item turns out to require a change beyond its named file → STOP and report; this lane's entire justification is that it is disjoint and cheap.
- The Tailwind registry turns out to be missing a whole family → report the count, do not sweep.
