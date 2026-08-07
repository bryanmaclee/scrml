# S328 — match block-arm keyword-boundary + empty-block-arm void

Dispatch: fix two of four post-merge defects in PR #447 (§18.5 match block-arm in value position).
Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a984f17aa355c0da6`
Base: `18fc0571`

## Log

- 2026-08-07 — startup verification: pwd/toplevel match, tree clean, `bun install` OK (217 pkgs).
- 2026-08-07 — read `.claude/maps/primary.map.md` (stamp 97576f35). Load-bearing rows noted: invariant 43 (change a text pass's INPUT not its PATTERN), the codegen pre-land gate `scripts/corpus-emit-differential.ts`, invariant 31 (`parenthesizeAwaitServerCallsInExpr` feeds the value-form match-arm lowering).
- 2026-08-07 — archived BRIEF.md verbatim + created this progress log.
- 2026-08-07 — LOCUS TRACED. The regex IS at `emit-logic.ts:4538`, but it lives in `_blockTailIsValueExpr`, NOT `_matchArmResultIsBlockBody` (brief's containing-fn attribution refined). It has TWO consumers: `_emitBlockArmValueFromString:4564` (raw-string arm path) and the structured/variant arm tail check at `:4684`.
- 2026-08-07 — DEFECT 1 REPRODUCED at HEAD, both paths. Structured path: `.Low :> { const formatted = "beta"; formatted }` emits a dead `let _scrml_tilde_10 = formatted;` while `_scrml_tilde_8` stays null. Raw path: `1 :> { const formatted = "am"; formatted + "ber" }` emits a dead bare-expression statement `formatted + "ber";` and the result var stays null. Control arm with identifier `shade`/`base` is correct. `doc` (prefix `do`) hits too.
- 2026-08-07 — DEFECT 2 REPRODUCED at HEAD: `1 :> { }` emits `_scrml_tilde_11 = { };` — an empty object literal, not §18.5 void.
