# BRIEF — S391 nav-map incremental refresh (project-mapper, isolation:worktree)

Archived verbatim per pa-base §5 (brief archival). Dispatched 2026-08-31 from main `2ec2ce3a`.
NOTE: the worktree is cut from `origin/main` (S346), so this file did not exist inside the agent's
workspace; the brief was carried inline in the dispatch prompt, which is reproduced below verbatim.

---

INCREMENTAL nav-map refresh for the scrml repo (wrap-6c work, owed from S390).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: run `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Also run `git rev-parse --show-toplevel` and confirm it equals that same worktree root, and
   `git status --short` (expect clean). If ANY check fails, STOP and report — do not write anything.
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. NEVER a relative path
   (relative resolves against the MAIN checkout via the additional-working-directories list), and
   NEVER a path under `/home/bryan-maclee/scrmlMaster/scrml/` that is not inside `.claude/worktrees/`.
3. NEVER `cd` into the main checkout. Use `git -C "$WORKTREE_ROOT"` and `--cwd=<path>` forms.
4. NEVER use `git stash` — `refs/stash` is SHARED across every worktree on this repo and the PA is
   live in the main checkout right now. Do base-vs-build flips by FILE COPY only.
5. NEVER a bare `pkill -f` / `killall` on a command string every checkout shares.
6. Run `bun install` at your worktree root before any bun command (worktrees do not inherit node_modules).
7. Commit after each meaningful unit (WIP commits expected) and keep an append-only `progress.md`
   at your worktree root. Your branch + progress.md are the crash-recovery anchor.

## The task

`.claude/maps/primary.map.md` line 3 stamps `commit: 0dd659a1` (S380 window, and that run was itself
an INCREMENTAL_UPDATE scoped to the codegen surface). Main is now at `2ec2ce3a` — 51 commits later.

Do an INCREMENTAL_UPDATE scoped to what actually moved, then re-stamp. The exact post-map source
landings (`git diff --name-only 0dd659a1..2ec2ce3a` over compiler/src, compiler/native-parser, stdlib,
scripts, lsp) are these 17 files:

```
compiler/src/ast-builder.js
compiler/src/codegen/emit-channel.ts
compiler/src/codegen/emit-engine.ts
compiler/src/codegen/emit-expr.ts
compiler/src/codegen/emit-server.ts
compiler/src/codegen/rewrite.ts
compiler/src/commands/compile.js
compiler/src/commands/dev.js
compiler/src/commands/diagnostic-format.js
compiler/src/component-expander.ts
compiler/src/default-logic-exemption.ts
compiler/src/lint-e-state-block-statement-form.js
compiler/src/runtime-template.js
compiler/src/symbol-table.ts
compiler/src/type-system.ts
scripts/corpus-compile-floor.ts
scripts/corpus-compile-floor.baseline.json
```

Two of these are NEW files that may have no map entry at all — `compiler/src/default-logic-exemption.ts`
and `compiler/src/lint-e-state-block-statement-form.js`. Check whether the maps know about them.

Notable landings behind the stamp, for orientation on what changed semantically:
- #781 channel-mount-in-conditional guard (emit-channel / component-expander / type-system) — added a
  FOUR-container check for a `<channel>` mounted inside a conditional container.
- #785 `<each in=>` scope check (symbol-table / type-system) — a new E-SCOPE-001 fire path.
- #788 `emit-channel.ts` `void 0` fix.
- #789 §34 catalog row for `E-CHANNEL-MOUNT-IN-CONDITIONAL` + a comment-only source edit.

## Verification you owe (do NOT skip — this is the load-bearing half)

The S372 maps run had SIX map claims corrected by execution, and a later "maps regen" landed as a
measured NO-OP. So:

- For every map claim you ADD or CHANGE, verify it against the SOURCE by reading the file — never
  from a prior map, a doc, or a commit message. A doc that describes a locus is not the locus.
- Report explicitly whether the watermark/stamp actually ADVANCED and what it advanced to. A
  no-op-with-a-note is an acceptable outcome; a silent no-op is not.
- If a map claim you find is WRONG (not just stale), say so separately — a locus error that recurs
  across dispatches is a map gap, and the PA wants those named.

## Report back

- Your worktree path, your branch name, your FINAL commit SHA.
- The exact list of files you touched.
- Whether the stamp advanced, and to what.
- Every map claim you corrected (as opposed to added), with the source evidence.
- Anything you found that you could NOT verify against source, said plainly as unverified.

Do not touch anything outside `.claude/maps/` and your own `progress.md`.
