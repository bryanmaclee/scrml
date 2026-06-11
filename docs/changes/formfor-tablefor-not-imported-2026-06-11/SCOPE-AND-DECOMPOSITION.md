# SCOPE — `<formFor>` / `<tableFor>` used without the `scrml:data` import → hard error

**Change-id:** `formfor-tablefor-not-imported-2026-06-11`
**Session:** S183 · **Gap:** `g-formfor-unimported-silent` (LOW, filed S182)
**Severity ruling (user, S183):** **ERROR** (AskUserQuestion — over Warning). Matches the S182 engine-effect ruling ("B, error") on the same silent-drop-of-a-known-construct class, and restores consistency with the schemaFor call-form sibling which already hard-errors on the same cause.

## The bug (empirically isolated, S183 verify-before-claim)

A `<formFor for=T .../>` or `<tableFor for=T rows=@c/>` markup element used **without** `import { formFor } from 'scrml:data'` (resp. `tableFor`) compiles **clean — exit 0, zero diagnostic** — and is emitted as a **literal `<formFor>` / `<tableFor>` HTML tag**, which renders as nothing. The form/table is silently NOT generated. Same class as the S182 engine opener `effect=` footgun (`E-ENGINE-EFFECT-NOT-INTERPOLATED`).

### Empirical matrix (S183, `bun compiler/bin/scrml.js compile`)
| Member | Form | Without import → today |
|---|---|---|
| `<formFor>` | markup element | exit 0, **silent literal `<formFor>` in HTML, no diagnostic** — BUG |
| `<tableFor>` | markup element | exit 0, **silent literal `<tableFor>` in HTML, no diagnostic** — BUG |
| `schemaFor(T)` | call form `${ schemaFor(T) }` | exit 1, **already fires `E-SCOPE-001`** ("Undeclared identifier `schemaFor` … a missing `import`") — **OUT OF SCOPE, already covered** |

The gap's "likely generalizes to schemaFor/tableFor" is half-right: **tableFor yes, schemaFor no.** Do NOT touch schemaFor — its call-form scope-resolution already names the missing import.

## Root cause (single seam)

`compiler/src/type-system.ts` gates the validation+expansion walk on the import-locals set being non-empty:
- `~line 7243`: `if (formForLocals.size > 0) { walkAndExpandFormForNodes(...) }`
- `~line 7375`: `if (tableForLocals.size > 0) { walkAndExpandTableForNodes(...) }`

When the import is absent, `formForLocals` / `tableForLocals` is empty → the walker never runs → the `<formFor>` / `<tableFor>` markup node is never validated and never expanded → it falls through to `emit-html.ts` and emits as a literal tag.

Both walkers already identify the node **by its literal markup tag** (`tableForLocals` is explicitly `void`'d inside the walker — "the markup tag is the gate"); the locals set ONLY gates whether the walker runs. `formFor`/`tableFor` are registered structural elements (`html-elements.js:656` / `:699`), so a literal lowercase `<formFor>`/`<tableFor>` is **unambiguously** the L22 element — there is **no legitimate non-L22 meaning** (not valid HTML, not a hyphenated custom element, not a PascalCase component) ⇒ **zero false-positive risk** for a hard error.

## Fix (Approach A — dedicated import-absent detection scan; recommended, lowest-risk)

When `formForLocals.size === 0`, do a lightweight walk of the markup tree (mirror the `collectFormForImports` recursion shape: descend `children` / `body` / `defChildren` / arm bodies) for any `kind:"markup"` node whose tag (`node.tag` ?? `node.tagName`) is the literal `"formFor"`. For each, push `E-FORMFOR-NOT-IMPORTED`. Symmetric scan for `"tableFor"` → `E-TABLEFOR-NOT-IMPORTED` when `tableForLocals.size === 0`.

This is additive — the existing `if (size > 0)` happy-path walkers are untouched; the new scan is the `else` arm. Do NOT restructure the existing walkers.

### New codes (mirror the existing per-family `E-FORMFOR-*` / `E-TABLEFOR-*` convention)
- **`E-FORMFOR-NOT-IMPORTED`** (Error) — message names the fix: ``a `<formFor>` element is present but `formFor` is not imported. Add `${ import { formFor } from 'scrml:data' }`.`` Cross-ref §41.14 / §34.
- **`E-TABLEFOR-NOT-IMPORTED`** (Error) — symmetric, `tableFor`. Cross-ref §41.16 / §34.

### Edge cases (handle + test)
- Import-one-use-the-other: `import { formFor }` present but `<tableFor>` used → `tableForLocals` empty → `E-TABLEFOR-NOT-IMPORTED` STILL fires. Correct.
- Aliased import (`import { formFor as ff }`) is the EXISTING happy path (out of scope) — only the literal-tag-with-no-import case is the bug; when no import exists the only writable form is the literal `<formFor>`/`<tableFor>`.
- Multiple unimported `<formFor>` nodes → one error per node (fan-out), mirroring the existing per-node validation pattern.

## SPEC (normative)
- §41.14 (formFor recognition) — add a normative statement: the `formFor` primitive SHALL be imported from `scrml:data`; a `<formFor>` element without the import SHALL emit `E-FORMFOR-NOT-IMPORTED` (parallels the existing "`for=` SHALL be a `:struct`" §41.14.1 shape).
- §41.16 (tableFor recognition) — symmetric statement for `E-TABLEFOR-NOT-IMPORTED`.
- §34 — +2 catalog rows (`E-FORMFOR-NOT-IMPORTED` in the E-FORMFOR-* block ~16955; `E-TABLEFOR-NOT-IMPORTED` in the E-TABLEFOR-* block ~16971). Both Error.

## Tests
New unit test file `compiler/tests/unit/formfor-tablefor-not-imported.test.js` (mirror `engine-effect-not-interpolated.test.js` shape):
- `<formFor>` without import → `E-FORMFOR-NOT-IMPORTED` fires (Error).
- `<tableFor>` without import → `E-TABLEFOR-NOT-IMPORTED` fires (Error).
- Canonical WITH import → NO `*-NOT-IMPORTED` error (regression no-fire; expansion still happens — `data-scrml-formfor` / `data-scrml-tablefor` present).
- Import-one-use-the-other → the missing one fires.
- (optional) Two unimported `<formFor>` → two errors.

## Corpus impact: ZERO
Every `<tableFor>` site in `samples/`+`examples/` HAS the import (3 files); no `<formFor>` markup site exists without the import. The new error breaks nothing. The dev agent MUST still run the full suite + R26 to confirm.

## What is OUT of scope
- `schemaFor` (already E-SCOPE-001).
- Aliased-import happy path.
- Any change to the existing expansion walkers / emit-form-for / emit-table-for.
