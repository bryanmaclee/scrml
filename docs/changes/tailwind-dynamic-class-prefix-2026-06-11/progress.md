# progress — tailwind-dynamic-class-prefix-2026-06-11

Change-id: tailwind-dynamic-class-prefix-2026-06-11 · Session S183 · agent scrml-js-codegen-engineer (worktree-isolated).

- 2026-06-11 startup: worktree verified, merged main (065fa06c -> 44a0033a, contains HEAD dc6d11c9 lineage), bun install + pretest OK.
- 2026-06-11 repro confirmed: `class="driver-${@status}"` -> W-TAILWIND-UNRECOGNIZED-CLASS on `driver-`. Also confirmed W-TAILWIND-001 (findUnsupportedTailwindShapes) DOES mis-fire on colon/bracket fragments (`hover:bg-`, `p-[`, `:p-4`) -> BOTH loops need the fix.
- 2026-06-11 fix (compiler/src/tailwind-classes.js, commit ba63cc38): factored `findInterpolationRanges(value)` out of `maskInterpolations` (preserves its masked-string return for current callers) + added `tokenTouchesInterpolation(tStart,tEnd,ranges)`. Added a skip-check in BOTH scan loops: any `/\S+/` token glued to (adjacent, no whitespace) or overlapping a `${...}` region is skipped. Indices map 1:1 because the mask preserves length.
- 2026-06-11 tests (compiler/tests/unit/tailwind-classes.test.js §20, commit 7dce8d5b): 12 new tests across both scan functions. driver-/badge-/-suffix/grid-cols- no-fire (UNRECOGNIZED); hover:bg-/p-[/:p-4 no-fire (W-TAILWIND-001); STATIC counter-app/my-card STILL fire; fully-dynamic unchanged; whitespace-separated flexx + group-hover:p-4 STILL fire. 177 pass / 0 fail in file.
- 2026-06-11 compile-smoke: /tmp/tw-smoke.scrml `class="driver-${@status}"` -> "fixed — no false positive".
- NEXT: full `bun run test` 0-fail verification; final report.
