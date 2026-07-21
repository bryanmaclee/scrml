# BRIEF — `collectOutlets` missed-edge fix: total-walk the outlet/landmark collector

Dispatched S277 (2026-07-21) · agent `scrml-js-codegen-engineer` · isolation `worktree` · model opus
Base: `origin/main` @ `5823b495`.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it does not, STOP and report — do not write anything.
2. `git rev-parse --show-toplevel` MUST equal that worktree root. `git status` MUST be clean.
3. `bun install` (worktrees do NOT inherit node_modules; the hook fails "cannot find package 'acorn'" otherwise).
4. `bun run pretest` (populates gitignored samples/compilation-tests/dist/ browser fixtures).
5. EVERY Read/Write/Edit uses an ABSOLUTE path under the worktree root. NEVER `cd` into
   /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
6. First commit message: `WIP(outlet-collector): start at $(pwd)`.
7. Commit after EACH meaningful unit + append to `docs/changes/outlet-collector-total-walk/progress.md`
   (append-only, timestamped). WIP commits expected — the branch + progress.md are the crash-recovery anchor.
8. NEVER `git commit --no-verify`.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, then follow its Task-Shape Routing for a compiler-diagnostic
task (expect `domain.map.md` — it carries a dedicated §20.8.1.1/§40.8.2 section with the four-case table
and the three-stage ownership split — plus `structure.map.md` and `error.map.md`). Map stamp is
`c48e59a2`; HEAD is `5823b495`. The ONE post-map landing (#125) is the S276 wrap — continuity docs only,
ZERO compiler source — so the maps are current for every file you will touch. Treat map content as a
verify-against-source hypothesis. Report whether the maps were load-bearing; "not load-bearing" is a
valid and useful answer.

## WHY THIS DISPATCH EXISTS — a live silent-correctness bug, empirically established

`compiler/src/symbol-table.ts` `collectOutlets` (SYM PASS 15.5) is an ALLOW-LIST walker: it descends a
hand-listed edge set — `children` / `body` / `defChildren` / `consequent` / `alternate` / `arms[].body` /
`branches[].element` / `elseBranch`. Its emit-side twin `treeHasAuthorMain`
(`compiler/src/codegen/emit-html.ts:1005`) is a TOTAL walker: it descends EVERY object-valued property
by design, with a documented rationale ("Being broad is the POINT, not sloppiness").

They therefore disagree about which `<main>` elements exist. **The PA verified this empirically before
writing this brief** (probes compiled through `compileScrml`, AST dumped at SYM time):

| shape | `<main>` node lives at | `collectOutlets` reaches it | emitted result today |
|---|---|---|---|
| `<main if=@flag>` sibling of `<outlet>` | `children` | YES → `E-OUTLET-AND-MAIN` fires | (build fails, correct) |
| `<main>` in a **match block-form arm** | `armBodyChildren[i].children[j]` | **NO** | silent; slot demoted; **ZERO `<main>` in the document** |
| `<main>` in an **engine state-child** | `bodyChildren[i].children[j]` | **NO** | silent; slot demoted; **ZERO `<main>` in the document** |
| component-mounted `<main>` | not in the SYM AST at all (raw text) | n/a | silent; exactly ONE `<main>` — **valid, leave alone** |

Note the missed edges are named `armBodyChildren` and `bodyChildren`. The walker's header comment claims
it descends "arms[].body" — **that edge name does not exist on these node kinds**, so the coverage claim
in the comment is false and has been since the pass was written.

### Consequence 1 — silent zero-landmark documents (the correctness bug)

A shell with an `<outlet>` and a `<main>` inside a match/engine arm compiles CLEAN. Emit's total walk
finds the arm's `<main>`, concludes the document has an author landmark, and demotes the slot to
`<div data-scrml-outlet>`. But a non-initial arm body does not render on first paint — so the composed
document has **zero `<main>` landmarks**. Invalid, inaccessible, and completely silent.

### Consequence 2 — `E-OUTLET-DUPLICATE` is broken the same way (verified)

The same walker's header records a V1 coordinator ruling verbatim: *"Two outlets in mutually-exclusive
conditional/match arms are STILL a duplicate ... So collectOutlets descends BOTH arms of every
conditional/match and files each outlet under its shell."* **That claim is false.** Verified:

- two plain sibling `<outlet/>` → fires ✅
- second `<outlet if=@flag/>` → fires ✅
- second `<outlet/>` inside a **match block-form arm** → **SILENT** ✗
- second `<outlet/>` inside an **engine state-child** → **SILENT** ✗

## THE FIX

**Make `collectOutlets` a TOTAL walker, mirroring `treeHasAuthorMain`.**

Do NOT simply append `armBodyChildren` and `bodyChildren` to the edge list. That is the same defect
waiting on the next node kind that invents an edge name, and it leaves the two walkers structurally
divergent — which is the actual root cause. One walker, one rule, no edge list to keep in sync.

Requirements:

- Replace the eight hand-listed `descend(...)` calls with a generic descent over every object-valued
  property, skipping `span` (a position record, never markup — the same exclusion `treeHasAuthorMain`
  makes and for the same stated reason). Keep the existing `WeakSet` cycle guard.
- **Preserve the scope bookkeeping exactly.** `enclosingProgram`, `openMains`, and `inRouteScope` are
  computed per-node today and must continue to be, including:
  - a nested `<program>` RESETS `openMains` (an outer shell's `<main>` must not be marked as wrapping an
    inner shell's outlet — there is a comment recording why, and a test pinning it);
  - `<page>` and `<outlet>` bodies set `inRouteScope` permanently for the subtree.
  Tree order is preserved by a generic walk, so nesting semantics carry over — but verify, do not assume.
- After the change, a `<main>` in a match arm / engine state-child MUST fire `E-OUTLET-AND-MAIN` (the
  same treatment `<main if=…>` already gets), and an `<outlet>` in those positions MUST count toward
  `E-OUTLET-DUPLICATE`.

### BLAST RADIUS — investigate and report before you finish

A total walk reaches markup that the allow-list never did. Enumerate what newly becomes visible and
decide, per shape, whether firing is correct. At minimum check:

- `renders` clauses on enum variants (§19.2) — is a `<main>` there shell chrome or route content?
- `fallback={<markup/>}` on `<errorBoundary>` (§19.6)
- markup-typed derived cells (`const <badge> = <span>…</span>`, §6.6.17)
- `snippet` props / `{ (p) => <markup> }` lambdas at call sites (§16.6)
- attribute-valued markup generally

If any of these produces a FALSE POSITIVE — a diagnostic on a shape that is not genuinely a competing
shell landmark — say so explicitly in your report with a compiled reproducer, and propose the narrowing
rather than silently adding an exclusion. Report the list even if every entry is benign.

## ALSO IN SCOPE — one SPEC clause (the component case)

The component-mounted `<main>` (row 4 of the table) is NOT a bug and you must NOT make it fire. Today's
behavior is correct: the component's `<main>` is the landmark, the marked slot demotes to a `<div>`,
the document carries exactly one landmark. Firing there would reject a program that compiles to valid,
accessible HTML and force the author to restructure working code.

`compiler/SPEC.md` §20.8.1.1 currently enumerates four cases and does not say which one an author
`<main>` arriving through COMPONENT EXPANSION falls under. Add a normative bullet stating that a `<main>`
introduced by component expansion is **content-owned (the case-3 family)**: it takes the landmark and the
slot demotes, with no diagnostic. Match the surrounding prose style. Note in the bullet that the SYM
placement pass cannot see it (it is raw text pre-expansion) and that this is by design, not a gap —
so a future reader does not "fix" it into a false positive.

No `§34` row changes. No new error codes.

## TESTS (required)

Extend `compiler/tests/integration/navigate-wave1c-outlet-composition.test.js` (it already carries the
four-case structure and the `slotOpenTag` helper). Add:

1. `<main>` in a non-initial **match block-form** arm + `<outlet>` → `E-OUTLET-AND-MAIN` fires.
2. `<main>` in an **engine state-child** + `<outlet>` → `E-OUTLET-AND-MAIN` fires.
3. second `<outlet>` in a **match arm** → `E-OUTLET-DUPLICATE` fires.
4. second `<outlet>` in an **engine state-child** → `E-OUTLET-DUPLICATE` fires.
5. **regression guard**: component-mounted `<main>` + `<outlet>` → NO diagnostic, and the emitted body
   contains exactly ONE `<main>`. Assert the count, not just the absence of an error.
6. **the invariant itself, asserted on emitted HTML**: for every legal shape in the suite, the composed
   body contains exactly one `<main>`. A shape that fires an error is exempt.

**Assert on the emitted document, not only on diagnostics.** The S276 review found that a test oracle
which counted `<main` inside `<template>`/`<script>` shared the implementation's blind spot and let an
entire zero-landmark class through 16 green tests. Count `<main>` in RENDERED body content — exclude
`<template>` and `<script>` contents when counting. If you reuse a helper from the existing suite, verify
it does not have that flaw before trusting it.

## EMPIRICAL VERIFICATION (do not mark DONE without this)

Regression-tests-pass is NOT empirical-pass.

1. Full suite: `bun run test` (chains pretest). Record pass/fail/skip.
2. Recompile the real corpus on your post-fix baseline and diff diagnostics vs base:
   `docs/website` (98 route docs — the corpus the S276 gap-closure was measured on) and
   `examples/23-trucking-dispatch`. **Assert both trees are non-empty BEFORE trusting any comparison** —
   a prior session got a false-green `DIFF: NONE` because `wc`/`head` had dropped off PATH and the
   compare ran against missing directories.
3. Symptom check, explicitly: NO new `E-OUTLET-*` diagnostic appears on either corpus. If one does, it is
   either a real latent bug you have surfaced (report it with the file + line) or a false positive from
   the widened walk (report it as blast radius, per above). Do not silence it without saying so.

## REPORT BACK

Worktree path · final commit SHA · files touched · the blast-radius enumeration · suite numbers ·
corpus-recompile result · maps load-bearing yes/no · anything you deferred and why.

DONE-PROBE: `bun test compiler/tests/integration/navigate-wave1c-outlet-composition.test.js` passes AND
a `<main>` inside a match arm or engine state-child alongside an `<outlet>` fires `E-OUTLET-AND-MAIN`.
