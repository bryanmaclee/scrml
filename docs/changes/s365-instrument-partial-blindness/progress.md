# S365 — instrument partial blindness

Branch: `fix/s365-instrument-partial-blindness` (cut from `origin/main` @ 11966341)
Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8312d09e5de4d0ab`

## Scope

Two rulings on measuring instruments:

1. **Q7 / delta-lint partial blindness** — `scripts/delta-lint.ts` + `scripts/state.ts`
   share a byte-identical ENTRY regex that does not accept the drifted
   `[NNNN] <emoji> <kind> · body` convention. 4 live lines (`[561] [562] [565] [727]`)
   are bracketed-but-unparsed; the gate reports PASS at exit 0.
   - (1a) widen + unconditional `bracketed` vs `total` refusal, BOTH files.
   - (1b) gate `--fix` on a clean parse (`bracketed === total`), plus a one-line
     merge-hazard warning. Do NOT fix the merge-side renumbering bug.
   - Do NOT run `--fix` on the real log; do NOT renumber the 9 baselined dups.

2. **Q6 / conformance `expect` container policy** — `conformance/run.ts`.
   Uniform across the whole vocabulary: `[]` = no-op; non-array container
   (`{}`, `null`, `""`, number, boolean) = HARD ERROR failing ONE case, never
   aborting the run. Reuse the `codeCounts` idiom.

## Status log

- [x] Startup gate (pwd / toplevel / clean / branch off origin/main / bun install)
- [x] BRIEF.md + progress.md crash anchor
- [ ] Read known-gaps entries + both scripts
- [ ] Ruling 1a — regex widen + unconditional mismatch refusal (delta-lint.ts)
- [ ] Ruling 1a — same in state.ts
- [ ] Ruling 1b — `--fix` clean-parse gate
- [ ] Ruling 2 — conformance container policy
- [ ] Bite proofs (exit codes measured directly, never through a pipe)
- [ ] Regression: conformance 883/883 + `bun run test` vs origin/main baseline
- [ ] Six blocking CI gates at final SHA
