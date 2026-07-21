# BRIEF — fire `E-CELL-RENDER-SPEC-NOT-BINDABLE` at the DECLARATION (close the under-fire)

Scoped S277 (2026-07-21) · agent `scrml-js-codegen-engineer` · isolation `worktree` · model opus
**DO NOT DISPATCH until `outlet-collector-total-walk` has MERGED** — that arc is editing `symbol-table.ts`.

> **This brief REPLACES an earlier revision that was WRONG.** The first version proposed widening the
> Shape-3 markup-factory lowering to non-`const` cells. bryan ruled that, then **REVERSED it** once the
> SPEC evidence came in. The reversal and its reasoning are recorded here deliberately — a future reader
> must not "restore" the original intent.

## THE RULING (bryan, S277, after reversal)

> **revert to the diagnostic fix**

Make `E-CELL-RENDER-SPEC-NOT-BINDABLE` fire at the **DECLARATION**, which is where SPEC already puts it.
Do NOT change any lowering. Do NOT make a non-`const` cell able to hold a markup value.

## WHY THE FIRST VERSION WAS WRONG (read this before touching anything)

**SPEC §6.2 Shape 2, line 2187 — the governing sentence:**

> `E-CELL-RENDER-SPEC-NOT-BINDABLE` (compile error): The RHS markup is a non-input element (e.g.,
> `<div>`, `<span>`). Shape 2 requires bindable markup. **Use Shape 3 (`const <derived>`) for
> display-only markup cells.**

So `<plain> = <span>yo</span>` is **not an unspecified gap** — SPEC calls it a compile error and names
the alternative. The earlier brief asserted the combination was "simply unspecified". That claim was
made from the PRIMER without reading §6.2, and it is false.

**And the shapes do not permit the widening.** SPEC §6.2:
- **Shape 1 — Plain Reactive Cell** (bare): "RHS is a literal, expression, or constructor call." Writable.
- **Shape 3 — Derived (Read-Only)** (`const`): "recomputes whenever its dependencies change. **It is
  read-only.**" Writes fire `E-DERIVED-WRITE`.

`const` IS the derived marker; bare IS reactive-only. "Widen the Shape-3 lowering to non-`const` cells"
is therefore incoherent — it would make a writable cell read-only, or make a literal markup RHS with no
dependencies "recompute". The earlier brief's own requirement that reassignment (`@plain = <span/>`)
must work directly contradicted the shape it named.

**L1 is not violated.** SPEC line 2202: a markup-typed derived cell's `${@badge}` "expands the markup
value at read time … the markup-as-value pillar applied to derived cells." Markup-in-a-cell works. The
sanctioned door is `const`.

## THE ACTUAL DEFECT

SPEC describes `E-CELL-RENDER-SPEC-NOT-BINDABLE` as a property of the **declaration** ("The RHS markup
is a non-input element"). The implementation fires it only at `<x/>` **render-by-tag use sites**
(SYM B6 walks self-closed lowercase tags that resolve to a registered cell). So:

| source | today | after |
|---|---|---|
| `<plain> = <span/>` + `<plain/>` | fires (use-site) | fires (now at the decl) |
| `<plain> = <span/>` + `${@plain}` | **silent, `reactive_set("plain", null)`** | **fires** |
| `<plain> = <span/>` + no use at all | **silent, nulled** | **fires** |

PA-reproduced on base `5823b495`; the authored markup survives nowhere (0 hits in `app.client.js`,
none in the HTML).

## SCOPE

- Fire `E-CELL-RENDER-SPEC-NOT-BINDABLE` when a **non-`const`** state-decl's RHS is **non-bindable
  markup**, at the declaration, independent of any use site.
- Key on the EXISTING classification: B5's `_cellKind === "markup-typed"` combined with
  `decl.isConst === false`. B6 already computes exactly this discrimination (see
  `docs/PA-SCRML-PRIMER.md` §13.7 "B6 specifics" — *"B5's `markup-typed` bucket collapses two
  spec-distinct cases … B6 reads `decl.isConst` to disambiguate"*). Do not invent a new classifier.
- **Do not double-fire.** B6's existing use-site fire must not also fire for a decl that now fires at
  the declaration. One diagnostic per offending declaration.
- No new error codes. No lowering changes. No SPEC normative changes — SPEC already says this; if
  anything the §6.2 prose may deserve a clarifying note that the check is decl-scoped, but the rule
  itself is unchanged.

### MIGRATION — measure it before you land it

This is a **newly-rejecting** change: source that compiled today will now fail. That is the acceptable
direction (adopters can fix code; a newly-ACCEPTING change is a one-way door) — but the cost must be
MEASURED, not assumed. Before finalizing, grep every `.scrml` under `scrml/` (excluding `dist/`),
`../scrml-support/`, and `../scrml-native/` for a non-`const` cell with a non-bindable markup RHS, and
report the count and the files. If the count is non-zero, STOP and report rather than migrating the
corpus unilaterally — the migration is a separate ruling.

## TESTS

1. `<plain> = <span/>` with `${@plain}` → fires at the decl.
2. `<plain> = <span/>` with no use at all → fires.
3. `<plain> = <span/>` with `<plain/>` → fires exactly ONCE (no double-fire).
4. **Regression guard:** `<userName req> = <input type="text"/>` (Shape 2, bindable) → clean, still
   lowers as a render-spec with `bind:*` dispatch intact. Assert the binding, not just no-error.
5. **Regression guard:** `const <badge> = <span/>` (Shape 3) → clean, still emits its markup factory.
6. `<count> = 0` (Shape 1, non-markup) → unaffected.

## EMPIRICAL VERIFICATION

Full suite; then R26 on `docs/website` + `examples/23-trucking-dispatch`, **both trees asserted
non-empty BEFORE comparing** (a bad path silently emits 0 files and reads as a false-green
`DIFF: NONE`). Expect byte-identical output and ZERO new diagnostics — if a new
`E-CELL-RENDER-SPEC-NOT-BINDABLE` appears on either corpus, that is a real adopter-facing migration and
you must STOP and report it.

## REPORT BACK

Final SHA · files touched · the corpus grep count for the newly-rejected shape · confirmation of
no-double-fire · suite numbers · R26 result · maps load-bearing yes/no.

DONE-PROBE: `<plain> = <span class="p">yo</span>` used only via `${@plain}` fires
`E-CELL-RENDER-SPEC-NOT-BINDABLE`, AND `<userName req> = <input type="text"/>` still compiles clean as
a bindable render-spec.
