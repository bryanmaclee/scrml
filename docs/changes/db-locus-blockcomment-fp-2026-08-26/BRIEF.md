# BRIEF — E-STATE-BLOCK-STATEMENT-FORM false-fires inside a `/* */` block comment

change-id: `db-locus-blockcomment-fp-2026-08-26`
dispatched: S376-bryan, 2026-08-26
agent: `scrml-js-codegen-engineer`, `isolation: "worktree"`, model opus

---

## ⚑ STEP 1 — GET THIS BRIEF AND THE CODE UNDER TEST

Your worktree is cut from **`origin/main`**, NOT from the PA's checkout. The code you are fixing is
**NOT on `origin/main`** — it lives on the branch `feat/s376-db-locus`. Before anything else:

```sh
git fetch origin feat/s376-db-locus
git checkout FETCH_HEAD -- compiler/src/lint-e-state-block-statement-form.js \
                            compiler/src/api.js \
                            compiler/tests/unit/state-block-statement-form.test.js \
                            docs/changes/db-locus-blockcomment-fp-2026-08-26/
git merge-base HEAD origin/main   # assert your base IS origin/main; if not, STOP and report
bun install                        # a fresh worktree does NOT inherit node_modules
```

Any instruction elsewhere to "rebase onto HEAD" resolves to `origin/main`.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its Task-Shape Routing for this shape
(a compile-pipeline diagnostic pass). Then the maps it routes you to (expect `structure.map.md`
and `error.map.md`).

- Map watermark: commit `8b2e4053`, dated 2026-08-25.
- **Post-map landings you must factor in:** `592dccf7` `77411e00` `84582f51` `a545bbe7` — all in
  `codegen/emit-each.ts` and `component-expander.ts`. **None touches your target file**, which is
  new on the feature branch and appears in no map. Treat every map claim as a
  verify-against-source HYPOTHESIS.
- Report back whether the maps were load-bearing for this task — "not load-bearing" is a valid and
  useful answer.

---

## THE DEFECT — reproduced by the PA, by EXECUTION, not inferred

`compiler/src/lint-e-state-block-statement-form.js` fires `E-STATE-BLOCK-STATEMENT-FORM` at
**severity error** on a line that is inside a `/* … */` block comment. Legal source is rejected.

**Reproducer (exact — PA ran this):**

```scrml
<program db="./app.db">
<schema>
  items { id: integer primary key, name: text }
</schema>
<db src="sqlite:./app.db" tables="items">
  /* legacy:
on mount { loadDashboard() }
  */
</db>
function loadDashboard() { }
<div>hello</div>
</program>
```

```
bun compiler/bin/scrml.js compile <file> --output-dir /tmp/x
→ EXIT 1
→ error [E-STATE-BLOCK-STATEMENT-FORM]: a lifecycle block `on mount { ... }` written directly in a
  state-block …
```

**Expected:** exit 0, zero `E-STATE-BLOCK-STATEMENT-FORM`. The statement is commented out; it is not
a lifecycle statement at that locus.

## LOCUS — TRACED, not searched

`compiler/src/lint-e-state-block-statement-form.js` → `scanStateBlockChildren()`.

The trace, so you can check it rather than trust it:
`compiler/src/api.js` Stage 2.5c calls `runEStateBlockStatementForm(bsResults)` →
`walk(blocks, …)` → `isStateBlock(node)` → `scanStateBlockChildren(node, …)`, which splits each
direct **text** child on `\n` and matches `STATE_BLOCK_ON_LIFECYCLE_RE` per line. Its only comment
carve-out is `if (!/^\s*\/\//.test(line))` — a **`//`-led line**. There is no `/* */` state, so any
block-comment continuation line beginning `on mount {` / `on dismount {` matches.

## SCOPE — what to change, and what NOT to

**FIX:** give the per-line scan real block-comment state across the lines of each text child, so a
line inside an open `/* … */` is not scanned. This module is a **pre-AST** scan over block-splitter
output, so text-level scanning is the CORRECT mechanic here (contract Rule 7 binds stages that
already hold the parsed tree; this one does not). But make it a **state machine over the text**, not
another regex bolted beside the first — a second pattern is how the first one got this wrong.

Handle, and prove by execution:
- an open `/*` on the same line as the match, and on an earlier line
- `*/` closing on the same line as a later match (the match after it MUST still fire)
- `/*` inside a `//` line (does not open a block comment)
- nested-looking `/* /* */` (scrml/JS block comments do not nest — a single `*/` closes)

**SECOND ITEM — evaluate and decide, with your reasoning recorded.** `api.js`'s Stage 2.5c wire-in
wraps the pass in `try { … } catch (e) { if (verbose) log(…) }`. For the sibling **warning** lints
that is fine; this is an **error gate**, so a thrown scanner silently disappears and the file
compiles exit 0 — the fail-OPEN direction. Either make it fail closed (surface the throw as a
diagnostic) or record in `progress.md` why the sibling pattern is right here. Do not change the
sibling lints.

**MUST NOT WRITE:** anything other than
`compiler/src/lint-e-state-block-statement-form.js`, the Stage-2.5c block in `compiler/src/api.js`,
and `compiler/tests/unit/state-block-statement-form.test.js`. In particular: no `ast-builder.js`
(two other ratified rulings are sequenced onto it), no `compiler/SPEC.md`, no other lint module.

## VERIFY — bite proof BOTH directions, by EXECUTION

Do not report DONE on "tests pass". Compile real files and read **exit codes**, never grepped output
text (a `grep -c` returning 0 exits 1 and reads as failure — a recorded miss on this project).

MUST still FIRE (exit 1, one diagnostic):
1. `on mount { loadDashboard() }` bare in a `<db>` body
2. the same in a `< db …>` deprecated-whitespace-opener body
3. `on dismount { cleanup() }` in a `<db>` body

MUST NOT fire (exit 0):
4. the block-comment reproducer above
5. `// on mount { loadDashboard() }` in a `<db>` body
6. prose: `we load on mount and dismount cleanly` in a `<db>` body
7. `on mount { … }` at a `<program>` body top (the legal locus)

Add regression tests for 4 (new) and keep the 16 existing tests green.
Then: `bun run test` for the full baseline (use `bun run test`, which chains `pretest`, NOT
`bun test`).

## CRASH RECOVERY

Commit after each meaningful unit — WIP commits are expected and fine; your branch is the
checkpoint. Keep an append-only timestamped `docs/changes/db-locus-blockcomment-fp-2026-08-26/progress.md`:
what you just did, what is next, blockers. A clean `git status` before you report DONE is mandatory.

## REPORT

Report: your worktree path, the final commit SHA, files touched, whether the traced locus HELD /
was REFINED / was WRONG, the seven verification results with their exit codes, your decision on the
fail-open item, and anything deferred.
