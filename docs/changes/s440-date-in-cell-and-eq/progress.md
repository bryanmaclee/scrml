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

## 9. Runtime-size ratchet (tripped once, fixed)
The first commit attempt tripped `runtime-size-ratchet.test.js` §3 (counter aspiration, 16,384 B gz-9):
the counter runtime carries `_scrml_deep_reactive` (not the equality chunk), and runtime comments ship.
Measured: base 16,232 B -> first draft 16,668 -> final 16,326 (+94 B; 58 B headroom left, was 152).
The long deep_reactive rationale was moved out of the runtime into the test file and this doc.
Shell ratchet shape unchanged (26,035 B, no deep_reactive/equality in it).

## 10. Verification (at 2ba2dd5ce)
- New `compiler/tests/unit/s440-date-in-cell-and-eq.test.js`: 83 pass.
- Tests edited for the new server helper signature `(a, b, seen)`: server-eq-helper-import (4 sites),
  standalone-tool-target (1 site). Nothing else pinned the old text (other hits are local stubs).
- Gate `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`:
  25,851 pass / 0 fail / 70 skip / 11 todo (1,370 files).
- `bun conformance/run.ts`: 1041/1048 pass + 7 xfail (no fails).
- Browser suite `compiler/tests/browser`: 1109 pass / 48 fail / 43 skip — the SAME 48-failure set
  with the two source files swapped back to base 2126dec1d (diffed with timings stripped).
  Pre-existing; not caused here.
- Corpus (examples/ samples/ conformance/, 1,079 dirs, 6,637 output files, base compiler from
  `git archive 2126dec1d` vs this branch): same file set; per-dir compile status identical;
  2,616 byte-identical; 3,270 differ ONLY in the runtime content-hash filename; 751 differ only
  in the swapped helper text (663 runtime chunks: deep_reactive only; 54: equality section +
  deep_reactive; 6: equality section only; 27 .server.js + 1 tool/lib .js: server eq helper).
  0 unexplained. The runtime template itself is identical to base after swapping those two regions.
- Internal-use check: `_scrml_structural_eq` is only emitted for user-written `==`/`!=`; the
  runtime never calls it for change detection, so the invalid-Date self-inequality cannot loop.

## 11. FIX ROUND (S239 review: DO-NOT-LAND) — merged origin/main (merge, not rebase) first
All four findings REPRODUCED on 24299cae8 before fixing (scratch probe):
- F1: same invalid Date == itself -> false; two invalid Dates -> false; Float64Array[NaN] -> false; Map value NaN -> false.
- F3: Set{{a:1},{a:1}} == Set{{a:1},{a:2}} -> TRUE; Map analogue -> TRUE.
- F4: two Dates from a vm realm (instants 1 and 2) -> TRUE; foreign Date(1) vs local Date(1) -> false; foreign u8 vs local u8 same -> false.
- F5: _scrml_deep_set(URL, ["pathname"], "/y") -> a plain [object Object], href undefined, silently.

SUPERSEDES §5 (my CHOICE): the S440 dpa-037 ruling (postdates my brief) makes NaN a DEFINED
value and == REFLEXIVE (SameValueZero). Now:
- F1: `a === b` fast path is plain `return true` again. Date instants, typed-array elements and
  JS Map values compare with SameValueZero (`x === y || (x !== x && y !== y)`). ArrayBuffer /
  DataView stay bytewise (comment says why: byte identity, not numeric equality). The plain
  number branch is untouched (dpa-037 comparison-family build) — pinned as `test.todo`.
- F3: Map/Set pair ONE-TO-ONE: primitive keys/elements by the collection's own lookup (their
  counterpart is unique); object keys/elements against a `used[]`-marked list of b's object
  entries. Map entries match as (key, value) pairs, so crossed values still pair up.
- F4: built-ins recognised by BRAND (`Object.prototype.toString`), not instanceof; tag mismatch
  -> not equal (also fixes the old asymmetric `[1] == {0:1}`). Error compares name+message
  (constructor identity is realm-local). Blob keeps an instanceof fallback because polyfilled
  Blobs (happy-dom, jsdom) carry no Blob brand. Plain-object test in deep_reactive and
  deep_set uses "prototype's prototype is null" so another realm's plain object is plain.
- F5: `_scrml_deep_set` copies each container through `_scrml_deep_set_copy`, which throws
  `TypeError("scrml: cannot write .<key> of a <Class> in place; it is a value. Assign the whole
  cell.")` for any non-array non-plain object. Primitive/absent intermediates keep the old
  behavior (created as {}). Page test: the click raises the error; the cell keeps its intact URL.
- F2: code comment at the allow-list (accepted as designed; PA adds the SPEC line).

Sizes (gzip-9): counter 16,334 B (50 B headroom under 16,384; base 16,232); shell 26,206 B
(62 B under the 26,268 ceiling; base 26,035 — the growth is _scrml_deep_set_copy, which ships
in the shell's utilities chunk).

## 12. Fix-round verification (at e1689d76a) — FINAL sizes supersede §11's
- The full gate first tripped `v0-3-x-spa-tree-shake-phase-b.test.js` §1: the same counter, but gzipped
  at the zlib DEFAULT level (16,387 vs 16,384). Shortened the F2 comment to one line. FINAL:
  counter gzip-9 16,324 (60 B under the aspiration) / gzip-default 16,375 (**9 B** under the Phase-B
  gate; base was ~100 B under); shell gzip-9 26,206 (62 B under the 26,268 ratchet ceiling).
- Gate unit+integration+conformance: 25,880 pass / 0 fail / 70 skip / 12 todo (1,370 files).
- `bun conformance/run.ts`: 1041/1048 + 7 xfail.
- Browser: identical 48-failure set to base 2126dec1d (timings stripped).

## 13. One-guard repair R2-1 (final round)
Reproduced on a9080f9f2: `eq({[Symbol.toStringTag]:"URL", v:1}, {…"URL", v:2})` -> TRUE on client AND
server; same for "URLSearchParams", "RegExp", "ArrayBuffer" (Date already threw).
Fix: a nested `read(cls, key, x)` in `_scrml_structural_eq` reads each branch's value through the
class's OWN brand-checking getter/method, walking up the prototype chain (happy-dom's URL subclasses
the native one, so `href` is not an own accessor of its prototype). URL is read via its
brand-checked `toString` (= href). RegExp `source` (brand-checked) is read before `flags` (a generic
getter). A missing URL/URLSearchParams class throws "no toString reader". A spoof now throws
TypeError on both copies; real instances unchanged. R2-2 accepted with a one-line comment at the
Error branch. Typed arrays / DataView are gated by `ArrayBuffer.isView`, which a spoof cannot pass.
Sizes unchanged: counter 16,324 gz-9 / 16,375 gz-default; shell 26,206 (structural_eq is in neither).
Gate: 25,886 pass / 0 fail / 70 skip / 12 todo; size tests 27/0; conformance 1041/1048 + 7 xfail.
