# BRIEF — two SYM diagnostic corrections (nested-`<program>` route-scope leak · decl-scoped markup reject)

Dispatched S277 (2026-07-21) · agent `scrml-js-codegen-engineer` · isolation `worktree` · model opus
Base: `origin/main` @ `499dd740` (#126 outlet-collector total-walk, just merged).

**WRITE-SET: `compiler/src/symbol-table.ts` + test files ONLY. Do NOT touch `compiler/SPEC.md` or
`compiler/src/block-splitter.js`** — a sibling dispatch owns those this session. If you believe a SPEC
change is required, STOP and report rather than editing it.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd`. MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If not, STOP and report — write nothing.
2. `git rev-parse --show-toplevel` MUST equal that worktree root. `git status` MUST be clean.
3. `bun install` (worktrees don't inherit node_modules).
4. `bun run pretest` (populates gitignored browser fixtures).
5. EVERY Read/Write/Edit uses an ABSOLUTE path under the worktree root. NEVER `cd` into
   /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WORKTREE_ROOT"` / `bun --cwd "$WORKTREE_ROOT"`.
6. First commit: `WIP(sym-diag): start at $(pwd)`.
7. Commit after EACH unit + append to `docs/changes/sym-diagnostic-fixes-s277/progress.md`.
8. NEVER `git commit --no-verify`.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first, then its Task-Shape Routing for a compiler-diagnostic task
(expect `domain.map.md` + `error.map.md`). Map stamp `c48e59a2`; HEAD `499dd740`. Post-map landings:
#125 (continuity docs) and **#126 — which rewrote `collectOutlets` into a total walk and added
`compiler/src/landmark-tag.ts`; PART 1 below edits that exact function, so read it at HEAD, not from
the map.** Report whether maps were load-bearing.

---

# PART 1 — a nested `<program>` must reset `inRouteScope`

## Governing sentence (SPEC §4.12.1, quoted)

> **"A nested `<program>` is a completely isolated compilation unit. It does NOT inherit any lexical
> bindings from its parent `<program>`."**

Route-scope inherited from an OUTER `<page>` into a nested `<program>` is the parent's context
leaking into a unit SPEC calls completely isolated. This is a bug against a stated rule, not a new
rule.

## The defect (PA-reproduced; identical on base and on #126 — pre-existing)

`collectOutlets` resets `openMains` at a `<program>` boundary but does NOT reset `inRouteScope`.
Once inside a `<page>`, `inRouteScope` is permanently true for the subtree — so a nested `<program>`
declared inside that `<page>` never re-opens shell scope, and a genuine case-4 violation inside the
INNER shell is silently exempted. Minimal pair, identical inner-shell violation:

```scrml
k01: <program><outlet/><div>  <program name="w"><outlet/><main>inner bare</main></program></div>  </program>
     -> E-OUTLET-AND-MAIN   (correct)

k02: <program><outlet/><page> <program name="w"><outlet/><main>inner bare</main></program></page> </program>
     -> SILENT              (WRONG — same violation, same inner shell)
```

## The fix

One line, at the `childInRouteScope` computation — the missing twin of the `openMains` reset that
#124's PA-direct round added for exactly this reason (`childOpenMains = isProgramMarkup ? [] : …`):

```ts
const childInRouteScope = isProgramMarkup
  ? false
  : (inRouteScope || nodeTag === "page" || nodeTag === "outlet");
```

Comment it as the sibling of the `openMains` reset and cite §4.12.1, so the symmetry is legible.

## Direction of change

**Newly-rejecting** on a shape with (verify this) zero corpus occurrences. Grep the corpus for a
nested `<program>` inside a `<page>` before landing and report the count.

## Tests

Add to `compiler/tests/integration/navigate-wave1c-outlet-composition.test.js`: k01 fires (guard,
should already pass) and k02 now fires. Pin count + line, per the file's existing `diagsOf()` helper.

---

# PART 2 — `E-CELL-RENDER-SPEC-NOT-BINDABLE` must fire at the DECLARATION

**Read `docs/changes/markup-cell-nonconst-lowering/BRIEF.md` in full — it is the authoritative brief
for this part**, including a recorded RULING REVERSAL you must not undo. Summary follows.

## Governing sentence (SPEC §6.2 Shape 2, line 2187, quoted)

> **"`E-CELL-RENDER-SPEC-NOT-BINDABLE` (compile error): The RHS markup is a non-input element (e.g.,
> `<div>`, `<span>`). Shape 2 requires bindable markup. Use Shape 3 (`const <derived>`) for
> display-only markup cells."**

SPEC describes this as a property of the **declaration** ("The RHS markup is a non-input element").
The implementation fires it only at `<x/>` render-by-tag USE SITES, so `${@x}` interpolation — or no
use at all — leaves the decl silently accepted and lowered to `_scrml_reactive_set(name, null)`, the
authored markup discarded.

## Scope

Fire at the declaration when `_cellKind === "markup-typed"` AND `decl.isConst === false`. B6 already
computes exactly that discrimination. **Do not double-fire** with the existing use-site check — one
diagnostic per offending declaration. No new codes. **No lowering changes** — do NOT make a
non-`const` cell able to hold markup; that was ruled and then REVERSED.

## THE TRAP — read before touching anything

`<userName req> = <input type="text"/>` (Shape 2, BINDABLE) **also** emits
`_scrml_reactive_set("userName", null)`, and that is **CORRECT** — the cell holds the input's value,
which starts empty. The emitted symptom is byte-identical between the correct case and the broken one.
**Any check keying on "the RHS is markup" converts every form input in the corpus into an error.** Key
on `_cellKind`, never on the RHS shape.

## Direction of change

**Newly-rejecting.** Grep every `.scrml` under `scrml/` (excluding `dist/`), `../scrml-support/`, and
`../scrml-native/` for a non-`const` cell with a non-bindable markup RHS. Report the count and files.
**If non-zero, STOP and report** — migrating the corpus is a separate ruling, not yours to make.

## Tests

Per the markup brief: fires at decl with `${@x}` use; fires with no use; fires exactly once with
`<x/>` (no double-fire); Shape-2 bindable regression guard asserting the `bind:*` dispatch survives;
Shape-3 `const` regression guard; `<count> = 0` unaffected.

---

## EMPIRICAL VERIFICATION (both parts)

1. Full suite; report before/after and **diff the failure SET vs base** (36 known failures — native
   parity, dual-pipeline canary, `migrate --fix`, 3 browser; the set must be identical).
2. R26 on `docs/website` + `examples/23-trucking-dispatch`, **both trees asserted NON-EMPTY before any
   comparison** — a bad path silently emits 0 files and reads as a false-green `DIFF: NONE`.
3. Expect byte-identical artifacts and ZERO new diagnostics on both corpora. A new
   `E-CELL-RENDER-SPEC-NOT-BINDABLE` or `E-OUTLET-AND-MAIN` on either corpus is a real adopter-facing
   migration — STOP and report it.
4. Revert-check: reverting your change makes the new tests go red.

## REPORT BACK

Final SHA · files touched · both corpus grep counts · confirmation of no-double-fire · suite numbers
with the failure-set diff · R26 result · maps load-bearing · **anything you disagree with — say so;
the last dispatch on this file was right to refuse an instruction and it saved a false positive.**

DONE-PROBE: a nested `<program>` inside a `<page>` with a bare inner `<main>` + inner `<outlet>` fires
`E-OUTLET-AND-MAIN`, AND `<plain> = <span>yo</span>` used only via `${@plain}` fires
`E-CELL-RENDER-SPEC-NOT-BINDABLE`, AND `<userName req> = <input type="text"/>` still compiles clean.
