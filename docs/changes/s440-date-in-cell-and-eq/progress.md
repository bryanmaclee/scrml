# s440-date-in-cell-and-eq — progress (append-only)

## 1. Startup
- Worktree `agent-a96b369bf3096d5bd`, clean, ff to origin/main `2126dec1d` (merge-base == origin/main). bun install + pretest OK.
- Brief archived verbatim (`BRIEF.md`, commit 1667583bc).

## 2. Reproduced (before any edit, on 2126dec1d)
Finder reproducers copied from the gauntlet scratchpad, run in happy-dom:
- b12  `<eq> = @a == @b` (2020 vs 1999) -> eq="true" neq="false"          — BUG 2 reproduced
- b12b `new Date(2020,0,1) == new Date(1999,5,5)` -> "true"              — BUG 2 reproduced
- b12c `${@a}` + `@a.getFullYear()` -> both blank, TypeError            — BUG 1 reproduced
- b12d Date cell + sibling `${@ok}` -> sibling blank, TypeError at boot  — BUG 1 reproduced

## 3. Class probe (current `_scrml_deep_reactive`, before the fix)
THREW through the Proxy: Date, RegExp, Map, Set, WeakMap, WeakSet, Promise, Uint8Array,
Float64Array, ArrayBuffer, DataView, URL, URLSearchParams, Blob.
Did not throw but was damaged: Error (brand became `[object Object]`).
`_scrml_structural_eq` said TRUE for every pair of: Date, RegExp, Map, Set, URL, Error,
ArrayBuffer, DataView (and Promise/WeakMap/WeakSet/Blob). Typed arrays happened to work
(indices are own enumerable keys).

## 4. SPEC read
§45 read in full (SPEC.md 26129-26249). §45 has no Date-specific text. Implemented sentences:
- §45.1 "`==` is scrml's sole equality operator. It performs structural value comparison."
- §45.8 "`==` SHALL perform deep structural comparison for structs and enums."
plus ruling #8 (date/timestamp are VALUE types, `==` by instant) and §66.10 value semantics.
Note: §45.2's comparability list has no entry for date/timestamp or host built-ins; the ruling
fills that for Dates. A SPEC line recording it is PA's call (not written here).

## 5. CHOICE — invalid Date (dpa-037 unruled)
An invalid Date (NaN instant) follows the NaN rule: equal to nothing, ITSELF INCLUDED
(`@d == @d` is false when @d is invalid — the same as a NaN number, which `===` already gives).
Implemented in the `a === b` fast path too, so identity does not paper over it.

## 6. Fix
- `_scrml_deep_reactive`: allow-list — only arrays and plain objects (proto Object.prototype
  or null) are proxied. Everything else is returned raw. Same "plain" test protect-egress.ts uses.
  Consequence recorded: JS-interop class instances are no longer fine-grained tracked (cell
  assignment still notifies). Codegen emits no classes, so no scrml-authored value is affected.
- `_scrml_structural_eq`: a rule per built-in — Date (instant), RegExp (source+flags),
  typed arrays (same ctor, element-wise), DataView/ArrayBuffer (bytes), URL (href),
  URLSearchParams (toString), Error (ctor + message, then enumerable fields), Map/Set
  (size + per-entry match, key lookup first then structural for object keys; values
  structural), Promise/WeakMap/WeakSet/Blob (equal only when the same object).
  Map/Set trial comparisons use a FRESH cycle guard (a failed trial would otherwise leave
  its pair in `seen`, and a revisit reads "assume equal").
- Server copy: `SERVER_STRUCTURAL_EQ_HELPER` (emit-server.ts) is now sliced from the client
  runtime between `__SCRML_STRUCTURAL_EQ_START__/END__` markers (the §59 map-runtime
  precedent). The hand-written copy had drifted: no §59 map branch (server map `==` was
  order-sensitive, against §59.9), no cycle guard, same Date bug. Consumers (emit-server,
  emit-tool, emit-library) unchanged — same export name.
- To keep the inlined server text lint-clean (W-CG-UNDEFINED-INTERPOLATION), the four bare
  `undefined` checks in the function became loose `== null` / `!= null` (the form the old
  server copy used). Behavior: `_tag: null` is no longer treated as an enum tag (it never is).

## 7. Write through a Date cell
`@d.setFullYear(2030)` — before: TypeError (Proxy receiver). After: mutates the stored Date in
place, no notification (the Date is not a Proxy), so displays keep the old text until the
cell is reassigned. This is the §66.10 carried divergence; no new mechanism added (per brief).

## 8. Out-of-scope findings
- A regex LITERAL as a top-level declaration RHS (`<v> = /ab+c/i`) swallows the next
  declaration (`<r> = …` then E-STATE-UNDECLARED on `@r`). Parse-side; not touched.
- `Uint8Array` / `ArrayBuffer` / `DataView` are E-SCOPE-001 in scrml source (not known globals).
