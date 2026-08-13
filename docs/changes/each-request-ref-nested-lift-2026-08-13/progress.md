# progress — each-request-ref-nested-lift-2026-08-13

Append-only. Newest entries at the bottom.

## 2026-08-13 — startup

- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab0480c75e2b5c45f`, branch
  `worktree-agent-ab0480c75e2b5c45f`, base `3ebaa01ea47a0985b4725c885eb39b8b14cdb753`.
- `git rev-parse --show-toplevel` == worktree root. `git status` clean on arrival.
- `bun install` OK (217 packages). `bun run pretest` OK (13 test samples -> `samples/compilation-tests/dist/`).
- Read `.claude/maps/primary.map.md` in full (391 lines). Load-bearing rows: invariant 54
  (the FALSE one — the class is NOT closed), invariant 41 + the codegen task-shape row
  (`scripts/corpus-emit-differential.ts` is the standing pre-land gate, NOT in CI), invariant 55
  (no new source-text regex in a post-AST stage without justification), invariant 52
  (a field-listed walk is fail-open; "add the missing name" IS the defect class).
- Archived BRIEF.md verbatim.
- NEXT: reproduce the bug from the PA's on-disk reproducer; then trace the locus hypothesis.

## 2026-08-13 — reproduced + measured a 21-position matrix

Reproduced the PA's case verbatim (`q-each-in-forlift-tr.scrml`): compile exits 0, the emitted
`.client.js` carries `_scrml_input_state_registry.get("profile").data`, and the emitted
`scrml-runtime.*.js` contains that symbol ZERO times → dangling reference → whole-bundle
`ReferenceError` at mount. Control (`a-each-attr.scrml`, top-level `<each>`) emits
`_scrml_request_profile.data`. Both confirmed.

Then built a 21-case POSITION MATRIX (generator + classifying probe in the scratchpad) rather than
trusting the brief's "12 adjacent positions confirmed correct". **The blast radius is far wider than
the one reported position.** Measured at base `3ebaa01e`:

| class | count | cases |
|---|---|---|
| REQUEST (correct) | 5 | p01 top-level each attr · p02 for-lift attr direct · p16 top-level each attr NO-predicate · p18 each-in-each · p19 each-in-match |
| REGISTRY + DANGLING (silent, whole-bundle ReferenceError) | 13 | p03 each-in-for-lift attr · p04 each-in-if-lift · p05 each-in-while-lift · p06 each-in-do-while-lift · p09 `if=` · p10 `show=` · p11 `style=` · p12 `class:x=` · p13 `title=` · p14 TEXT interp · p17 `<each of=N>` · p20 each-in-each-in-for-lift · **p21 while-lift TEXT (no `<each>` at all)** |
| E-CODEGEN-INVALID-LOGIC (loud, no bundle) | 3 | p07 while-lift attr · p08 do-while-lift attr · p15 each-in-for-lift attr NO-predicate |

Two findings that correct the brief:
1. The "12 adjacent positions confirmed correct" were verified at the TOP-LEVEL `<each>` / DIRECT
   for-lift positions. **Every one of those same attribute kinds is broken once the `<each>` is
   nested inside a lift body** (p09-p14, p17, p20).
2. The `while`/`do…while` sibling is NOT confined to attributes and is not MED — **p21 is a plain
   TEXT interpolation with no `<each>` anywhere and it produces the identical DANGLING
   whole-bundle ReferenceError.**

- NEXT: implement the root fix (single per-file request-id carrier), then re-run the matrix.
