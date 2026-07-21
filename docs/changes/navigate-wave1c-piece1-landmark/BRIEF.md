# BRIEF — navigate Wave-1c PR-1: marker-driven composition + the ONE-LANDMARK invariant

Dispatched S276 (2026-07-20) · agent `scrml-js-codegen-engineer` · isolation `worktree` · model opus
Base: `origin/main` @ `020485b2`. Reference branch (DO NOT merge): `worktree-agent-a2ed001a5de228134` @ `8fd5fd07`.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it does not, STOP and report — do not write anything.
2. `git rev-parse --show-toplevel` MUST equal that worktree root. `git status` MUST be clean.
3. `bun install` (worktrees do NOT inherit node_modules; the hook fails "cannot find package 'acorn'" otherwise).
4. `bun run pretest` (populates gitignored samples/compilation-tests/dist/ browser fixtures).
5. EVERY Read/Write/Edit uses an ABSOLUTE path under the worktree root. NEVER `cd` into
   /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
6. First commit message: `WIP(wave1c-pr1): start at $(pwd)`.
7. Commit after EACH meaningful unit + append to `docs/changes/navigate-wave1c-piece1-landmark/progress.md`
   (append-only, timestamped). WIP commits expected — the branch + progress.md are the crash-recovery anchor.
8. NEVER `git commit --no-verify`.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, then follow its Task-Shape Routing for a codegen task
(expect `domain.map.md` + `structure.map.md`). Map stamp is `df2ac831`; HEAD is `020485b2`, so factor in
the post-map landings #120 (SSR auth-scoped leak, new `sql-lex.ts`), #121 (freeze-spec text), #122 (esql4
samples), #123 (S274 wrap). Treat map content as a verify-against-source hypothesis. Report whether the
maps were load-bearing — "not load-bearing" is a valid and useful answer.

## WHY THIS DISPATCH EXISTS

A prior dispatch built Wave-1c as three pieces on branch `worktree-agent-a2ed001a5de228134`. A PA-side
adversarial review found FIVE blocking defects, all reproduced empirically. Pieces 2 (boot restructure)
and 3 (runtime chunk-load) are HELD — they are NOT in this PR and you must NOT touch them.

This PR lands PIECE 1 ONLY, corrected. Piece 1 is independently valuable: it closes the coherence gap
between SPEC §20.8 (which names `<outlet>` the route slot) and the actual multi-file composition (which
predates §20.8 and keys on the first `<main>`).

## THE RULING YOU ARE IMPLEMENTING (bryan, S276) — THE ONE-LANDMARK INVARIANT

> **Exactly one `<main>` landmark per composed document; the MARKER decides the slot, never the tag.**

Concretely, four cases:

1. `<outlet>` with no author `<main>` enclosing it  -> emits `<main data-scrml-outlet tabindex="-1">`.
   (Author `tabindex` wins over the synthetic `-1` — this already works; keep it.)
2. `<outlet>` INSIDE an author `<main>` (`<main><outlet/></main>`) -> the outlet emits
   `<div data-scrml-outlet>`; the AUTHOR's `<main>` is the landmark. LEGAL — must NOT error.
3. A route body that carries its own `<main>`, composing into the slot -> the SLOT emits as a
   `<div data-scrml-outlet>`; the ROUTE owns the landmark. LEGAL — must NOT produce nested `<main>`.
4. A BARE / SIBLING author `<main>` alongside an `<outlet>` in the same shell -> `E-OUTLET-AND-MAIN`.
   This is the ONLY case that fires: two candidate slots, two landmarks, genuinely ambiguous.

## THE THREE SCOPING DEFECTS YOU MUST FIX (all reproduced by the PA)

**D1 — FALSE POSITIVE on the wrapping case.** `<program><main><outlet/></main></program>` currently
FAILS with E-OUTLET-AND-MAIN. Per case 2 above it must COMPILE CLEAN, with the outlet emitting a
`<div data-scrml-outlet>` inside the author `<main>`.

**D2 — FALSE POSITIVE on `<page>`-scoped `<main>`.** This compiles clean on base `020485b2` and FAILS now:
```
<program>
  <nav>chrome</nav>
  <outlet/>
  <page><main class="route">Route A</main></page>
</program>
```
A `<main>` inside a `<page>` body is ROUTE content, not shell content. `collectOutlets` in
`compiler/src/symbol-table.ts` (~L10152-10199) walks `node.children`/`node.body` straight through and
never treats `<page>` as a scope boundary. Make `<page>` a boundary for the SHELL-`<main>` collection.

**D3 — FALSE NEGATIVE across files (the silent one).** Multi-file: an `<outlet>` shell plus
`pages/index.scrml` containing `<main class="route">` compiles CLEAN and emits TWO nested `<main>`
elements — exactly the invalid HTML the error exists to prevent. The check is per-file and never sees
`pages/*.scrml`. Under the invariant this is NOT an error: it is case 3 — the composition must detect
that the route body carries a `<main>` and emit the slot as a `<div data-scrml-outlet>` instead.

## D4 — THE MARKER REGEX (separate, also confirmed)

`compiler/src/codegen/index.ts:~1883` uses
`/<([a-zA-Z][\w-]*)\b[^>]*\bdata-scrml-outlet\b[^>]*>/`. Two bugs: `\b` matches on `-`, so a
`data-scrml-outlet-debug` attribute wins the slot; and `[^>]*` spans attribute VALUES, so
`<div data-testid="data-scrml-outlet">` also wins. The runtime uses `querySelector("[data-scrml-outlet]")`
(exact attribute name), so codegen and runtime disagree on which element is the slot. Anchor the match to
the attribute NAME, e.g. `(?:\s|^)data-scrml-outlet(?=[\s=>/])`. Add regression tests for BOTH decoys.

## FILES IN SCOPE (do NOT touch anything else)

- `compiler/src/codegen/emit-html.ts` — the `<outlet>` emit (~L1594-1610).
- `compiler/src/codegen/index.ts` — composition slot detection (~L1861-1924).
- `compiler/src/symbol-table.ts` — `walkValidateOutlets` / `collectOutlets` / the E-OUTLET-AND-MAIN fire.
- `compiler/tests/integration/navigate-wave1c-outlet-composition.test.js` — see TESTS below.
- `compiler/SPEC.md` + `compiler/SPEC-INDEX.md` — see SPEC below.
- `docs/changes/navigate-wave1c-piece1-landmark/progress.md` — your progress log.

START from the piece-1 state on `worktree-agent-a2ed001a5de228134` (those three source files + the
integration test) and CORRECT it. Much of it is good: marker-driven slot detection, the author-`tabindex`
handling, and the empty-slot fix (`slotCloseIdx >= slotOpenEndIdx`, was `>`) — that last one is a genuine
bug fix (an empty `<main></main>` shell previously no-op'd composition and emitted pages with no shell
chrome). Keep those.

DO NOT touch: `runtime-template.js`, `emit-event-wiring.ts`, `emit-variant-guard.ts`, or any
browser/conformance test. Those are pieces 2+3 and are held.

## SPEC (land-with-impl, Rule 4) — SCOPED TO PIECE 1

- §20.8.1 — state the one-landmark invariant + the marker-not-tag rule + all four cases. The current
  branch text says a shell declaring BOTH an author `<main>` AND an `<outlet>` is an error; that is the
  overreach — correct it to the BARE/SIBLING case only.
- §40.8 — the marker-driven composition mechanism (previously unspecified) + the case-3 slot-demotion rule.
- §34 — correct the `E-OUTLET-AND-MAIN` row to the bare/sibling scope.
- Regenerate SPEC-INDEX: `bun run scripts/regen-spec-index.ts`.
- **DO NOT flip the §20.8 status banner to claim Wave-1c is implemented.** Pieces 2+3 are NOT landing in
  this PR. Cross-chunk soft-nav stays Nominal. Do NOT add `W-NAV-CHUNK-LOAD-FAILED` or the §20.8.2
  cross-chunk pipeline step — those land with piece 3. A false spec-ahead claim is a Rule 4 violation.

## TESTS

- `navigate-wave1c-outlet-composition.test.js` §4 currently contains:
  `test("`<main><outlet/></main>` (nested) also fires E-OUTLET-AND-MAIN", ...)`.
  That test encodes the overreach — **INVERT it**: the nested/wrapping form must compile clean and emit
  `<div data-scrml-outlet>` inside the author `<main>`. Keep the bare-sibling case asserting the error.
- ADD regression tests for D2 (a `<page>`-scoped `<main>` compiles clean) and D3 (a multi-file build whose
  route body has its own `<main>` yields EXACTLY ONE `<main>` in the composed document — assert the count).
- ADD the two D4 decoy tests (`data-scrml-outlet-debug` attribute name; `data-testid="data-scrml-outlet"`
  attribute value) — the real outlet must win the slot in both.
- Keep the existing back-compat coverage (bare-`<main>` shell composes statically).

## GATES — DO NOT REPORT DONE WITHOUT THESE

1. Pre-commit gate green: `bun test compiler/tests/{unit,integration,conformance} --bail`. Never `--no-verify`.
2. **R26 EMPIRICAL (mandatory).** Compile BOTH real corpus MPAs and diff emitted HTML against base `020485b2`:
   - `examples/23-trucking-dispatch` (36 files) and `docs/website` (98 files)
   - Both are bare-`<main>` shells and MUST stay byte-identical (the runtime content-hash may differ ONLY
     if runtime-template.js changed — it must NOT change in this PR, so expect ZERO diff).
   - Then compile an `<outlet>` MPA and assert exactly one `<main>` per composed document.
   A grep of emitted text is NOT sufficient — compile real sources and inspect the output.
3. Report the four ruling cases as a PASS/FAIL table with the actual compiler output for each.

## REPORT BACK

`WORKTREE_PATH`, `FINAL_SHA`, `BRANCH`, `FILES_TOUCHED`, tests before/after, the four-case table, the R26
diff result, and anything you deliberately did NOT do. If the invariant turns out to be unimplementable as
specified, STOP and report the fork rather than improvising — a prior dispatch's improvisation past the
ruling is exactly why this PR exists.
