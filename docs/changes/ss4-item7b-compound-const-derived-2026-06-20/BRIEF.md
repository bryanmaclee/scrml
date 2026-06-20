# Dispatch BRIEF — ss4 item 7 blocker (b): compound `const`-derived child registration

**Dispatched:** S209 (2026-06-20) by sPA ss4 · agent `scrml-js-codegen-engineer` · `isolation: "worktree"` · `model: opus`
**Lands to:** sPA branch `spa/ss4` (sPA re-integrates; you commit on your own agent branch).

## Startup verification (DO THIS FIRST — do not skip)
1. `pwd` + `git rev-parse --abbrev-ref HEAD` — confirm you are in YOUR provisioned worktree on YOUR agent branch, NOT the main checkout (`/home/bryan-maclee/scrmlMaster/scrml`).
2. **Merge the sPA branch so you build on blocker (a):** `git merge spa/ss4 --no-edit`. Then `git log --oneline -3` must show `spa(ss4): item 7 blocker (a)` (SHA e6a915c5) in history. Blocker (a) already fixed the shift-op tokenizer + COMPOUND_OPS; do NOT redo it.
3. `git status` clean before starting.

## Path discipline (S99/S126 — LOAD-BEARING)
- EVERY Write/Edit/Bash-write uses a path UNDER YOUR WORKTREE (the `pwd` from step 1). NEVER write to `/home/bryan-maclee/scrmlMaster/scrml/...` (main) or `/home/bryan-maclee/scrmlMaster/scrml-spa-ss4/...` (the sPA worktree). `stat` + read-back a file after writing to confirm the inode is in your worktree.
- NEVER `cd` into the main checkout. Use `git -C <worktree>` if you must target git explicitly.
- Commit INCREMENTALLY (after each meaningful unit). WIP commits expected. Update `docs/changes/ss4-item7b-compound-const-derived-2026-06-20/progress.md` after each step. `git status` clean before you report DONE.
- NEVER `--no-verify`. The pre-commit hook (unit+integration+conformance) is the gate.

## The problem
A `const`-derived cell declared as a CHILD inside a compound state-cell does not register in the cell registry, so the L21 derived-mutation walker (B8, `symbol-table.ts`) can't see it and never fires `E-DERIVED-VALUE-MUTATE` on mutations of that child.

Repro (compiles clean today; SHOULD fire E-DERIVED-VALUE-MUTATE):
```
<program>${
  <form>
    <data> = { a: 1 }
    const <derivedField> = { ...@form.data }
  </>
  function f() { @form.derivedField.a = 2 }
}</program>
```

The **walker is already correct and ready** — `walkDerivedValueMutate` descends the compound `_scope`, `findDeepestRegisteredOnPrefix` walks `["form","derivedField"]`, and `record.isConst` discriminates. The gap is purely the FRONT-END: `ast-builder.js` does not parse `const <child> = …` inside a compound `<parent>` body into a registered child state-decl with `isConst:true`. Tracking note: `compiler/tests/integration/parse-shapes-v0next.test.js §S11A.8` ("compound parent on the const path declines").

## SPEC authority (R4 — read before encoding)
- **§6.6.16** — compound-with-`const`-child syntax. Per §6.6, INDIVIDUAL derived fields MAY be `const`; the PARENT compound may NOT.
- **§S11A.8 INVARIANT (must STILL hold after your change):** NO `state-decl` is BOTH `isConst:true` AND has `children` populated. That test is about the *parent* being const (correctly declined). Your feature is about a const *child* — it must NOT make the parent isConst, and must NOT regress §S11A.8.

## Acceptance criteria (the tests ARE the spec)
In `compiler/tests/unit/derived-value-mutate.test.js`, un-skip (change `describe.skip` → `describe`) and make pass:
- **§B8.3** (4 tests): method call / plain `=` / compound-assign / delete on `@form.derivedField.*` (in-compound const-derived child).
- **§B8.6** (1 test): multi-segment receiver `@form.derivedField.push(1)` where the leaf is in-compound derived.
- Keep **§B8.3-neg** passing (non-derived in-compound child `@form.items.push(x)` does NOT fire).
- Keep **§S11A.8** passing (the negative invariant above).
- FULL suite green via the pre-commit gate (`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`). Also run `bun run test` (incl. browser) if you touch codegen-visible shapes.

## Scope guard
This is a PARSER/registry feature in `ast-builder.js` (+ `symbol-table.ts` registration if needed). Do NOT change the walker logic (it's correct). Do NOT widen beyond compound `const`-derived child registration. If you hit a genuine SPEC ambiguity about §6.6.16 semantics, STOP and report it (do not invent semantics) — that escalates to the sPA/PA.

## Report back
Final message: the agent branch name + tip SHA, which tests you un-skipped + their pass count, full-suite result, and any SPEC ambiguity or residual you hit. The sPA will cherry-pick/file-delta your `ast-builder.js`/`symbol-table.ts`/test changes onto `spa/ss4`.
