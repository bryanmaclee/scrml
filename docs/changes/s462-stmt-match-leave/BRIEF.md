# BRIEF — s462-stmt-match-leave (dpa-068 pole-independent defects)

Change-id: `s462-stmt-match-leave`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## Why this is not waiting on a ruling
dpa-068 (`../scrml-support/docs/deep-dives/arm-body-leave-stmt-widening-dpa-068-2026-10-08.md`, read §1 and §9 IN FULL; read-only sibling repo) found silent miscompiles that exist under EVERY pole of the pending arm-body ruling. These are conformance restorations of existing SPEC sentences, not language changes. Do NOT implement any bare-leave widening (W1) and do NOT add any new refusal of bare forms — that is bryan's open ruling. Your job is ONLY the braced forms and the pole-independent defects below.

## Defects (impl#1 unless noted)
- **D2 (HIGH, gap `g-stmt-match-block-return-falls-through`, docs/known-gaps.md):** a braced `{ return }` / `{ return expr }` / `{ fail … }` arm in a STATEMENT-position `match` is swallowed by the IIFE lowering (`compiler/src/codegen/emit-control-flow.ts:~2548`, PA-located-verify) — the IIFE returns, the enclosing function keeps going, a `fail` is dropped, exit 0. The dPA recommends the root fix: statement-position `match` lowered INLINE (if/else chain or a labeled block), not through an IIFE. Governing text: find and QUOTE the §18 / §19 / §7 sentences that say a `return`/`fail` inside an arm leaves the enclosing function (§18.4, §19.5, …) — if you can't find one, STOP and report (that would make it a ruling).
- **D3:** `{ break }` / `{ continue }` in a statement-position match arm inside a loop → E-CODEGEN "Unsyntactic continue" (same IIFE root; the inline lowering should fix it). Labeled forms too.
- **D4:** a `?` arm body in a decl-position `match` → E-CODEGEN (`= f(n) ?;`). Fix the lowering if the SPEC makes `?` legal there (quote it); otherwise report.
- **D8:** impl#1 joins a single-expression arm body across a line break (`return⏎"orphan"` → `return return "orphan"`), against §7.2.2 rule 8 / arm heads. Fix the arm-body extent so a line break ends it unless the line ends in a §7.2.2 rule-2 continuation token.
- **D10:** an engine message arm with a bare or braced `return` → E-CODEGEN (`return return;`); no front-end diagnostic. Emit the existing legality error for "no enclosing function" (find the §7 / §51.0.S code; quote it) instead of a codegen crash.
- **D12 (bootstrap, `compiler/self-host-v2/parse.scrml` `armEnd` ~:673-692):** an expression arm ends at ANY later line, ignoring §7.2.2 rule-2 continuation tokens: `.Boom(m) :> "a:" +⏎ m` splits into a cascade. Make `armEnd` honour rule-2 continuation (impl#1 already joins it correctly).
- **Also (same lowering family, filed S462):** `g-impl1-given-match-arm-body-dropped-s462` — impl#1 drops the body of a `given x :>` match arm in value / return / statement matches. Investigate after D2; if the inline lowering fixes it, prove it; if not and the fix is in the same lowering, fix it; else report with locus. (A sibling branch is concurrently deprecating `given` — do not touch the deprecation lint, fix rule, or E-SYNTAX-044.)
- D1 (bare `fail` in a statement match → `return fail.V(…)` ReferenceError) and D5/D6/D9: DO NOT CHANGE — they depend on bryan's pending W1-vs-L ruling. Report their status after your lowering change (does D1 still reproduce?).

## Verification
- Reproducers: the dPA's probes are described in the deep-dive (c04/c04b/c06b/c07b/c08/c11/c14, b01b/b03b, d01); reconstruct them as `.scrml` files under your scratch dir and include them as conformance cases (runtime-half: the function really leaves; the `fail` really propagates).
- MEASURE: compile the full corpus (samples/ examples/ stdlib/ conformance/ + `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25/*.scrml`) base vs head; report every artifact or diagnostic change. A statement-position match lowering change is SEMANTICS-CHANGED for any program that relied on the swallow — list every site whose emitted JS changes and say whether its behaviour changes; non-trivial behaviour changes come back to the PA before landing.
- Browser-tier + conformance + types:check + bootstrap slices green.

## In-flight siblings (expect merges at landing; the PA merges)
s462-given-presence-deprecate, s462-is-some-deprecate (ast-builder collectExpr), s462-narrowing-ends-on-write (presence-narrowing.ts — touches match arms), s462-channel-006-inferred, s462-own-value-inference. Stay in your loci.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-stmt-match-leave): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-stmt-match-leave/` · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · files · governing sentences quoted · per-defect before/after · corpus measurement (semantics-changed sites listed) · D1/D5/D6/D9 status · locus held/refined/wrong.
