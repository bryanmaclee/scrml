# s469-boot-tape-grants-2 — final-review follow-ups of #1528 (progress)

Branch `s469-boot-tape-grants-2`, cut from `origin/s469-boot-tape-grants` (`772f6726b`, PR #1528 in the merge
queue; merge origin/main once it lands). LIMB: BOOTSTRAP (`compiler/self-host-v2/`). impl#1 untouched.
Review probes: `~/.cache/scrml/review/boot-tape-r2/probe/`. Lane scratch: `~/.cache/scrml/lanes/boot-tape-grants-2/`.

Gap: `g-bootstrap-enum-payload-tape-not-a-tape-position-s469` (HIGH, narrowed — fail closed, ruling owed).

## Log

- [x] Read the round-1 progress.md, SPEC §66.11–§66.12 (§66.12.6 whole), the probes.
- [x] **F1 (HIGH)** — an enum variant payload is a tape position. Analyzer: `structTapeWrites` → `payloadTapeWrites`
      (every tape a whole enum value may replace — a payload tape, or one in a payload struct / enum — judged by
      the tape TYPE's grants; `TapeHit.payload`); a `replace`-less payload hit is E-BOOTSTRAP-UNSUPPORTED
      (`payloadTapeMessage`, owner question). Reached by every whole-value write: a cell write (the `fail` payload
      `!{ _ x :> @e = x }`), a variant switch, a `rule=` TRANSITION (`wholeFieldWrite` now runs the tape check on
      the graph branch too), a struct field / genuine struct replace holding the enum, a local enum rebinding,
      `reset(@e)`, `reset-on=` (now on a graph cell too), `persist="local"`. Core: `structTapeKept` →
      `payloadTapeKept` (C3, a Transition write included; C17).
- [x] **F2 (MED)** — the scan is structural: `slice-m4/grant-scan.js` (`grantReadsOutsideReader`) works on tokens and
      refuses, outside the reader's range, any member read of `grants` that is not a whole reader-call argument or
      a whole `grants:` slot value, any `grants` destructure / bare name, any `.replace` / `.edits` read, any
      `GrantSet` annotation, any held / read GrantSet-returning call, any `["grants"]` bracket key. The two
      GrantSet constructions outside it moved in (`fieldGrantSet`, `fieldDefGrants`); `fieldAtWrite`'s "is a tape"
      test uses `seqElem`. The test calls the real scan on the real source (no allow-list) and on 16 planted
      spellings + an end-to-end plant at the `persist="local"` admission — every one must fail.
- [x] **F3 (LOW)** — Core accepts `@o = { ...@o, inner: { ys: @o.inner.ys } }` and the instance form: `keepKey`
      reads `Read(LocalPath(before, p))` through the snapshot Let as the place it snapshots; `boundValue` follows a
      once-bound Local (one Let, no Assign) to its init (the Commit form). Controls: an Assigned snapshot, a
      snapshot of another place → C3.
- [x] **F4 (LOW)** — identity overrides are keeps: `resolveSpread` / `resolveInstanceSpread` skip an override whose
      value is the field's own place (`isOwnValue`); `structTapeWrites` returns no hit for a value that IS the place;
      Core `structTapeKept` keeps every tape of a value that reads the written place.
- [x] Acceptance (8 new, `acceptance/grants/`): `neg-enum-payload-{write,persist-local,reset,struct-tape}`,
      `enum-payload-replace-granted` (runs), `spread-override-nested-keep`, `spread-identity-{tape,struct}` (run).
      The instance form is not an acceptance case (the probe does not twin a `<doc>` outside `<program>`); it is in
      `tape-grants-r3.test.js`.
- [x] Slice tests: `slice-m4/tape-grants-r3.test.js` (F1 / F3 / F4, 36), `tape-write-forms.test.js` (F2 scan).

- [x] Commit 1 (`fix(bootstrap): enum payload tapes, …`); merged origin/main once #1528 landed (`4e1983534`).
- [x] Every blocking `ci.yml` `run:` command exits 0 (types-gate after `bun install --frozen-lockfile`;
      bootstrap-conformance `--check` current, no `--write` needed; s34-census `--check-new` against the merge base;
      slices m1 / m2 / m1-lowered / m3 / m4 / codec; e2e-render-map; host-global 1/2 and 2/2).

## Before / after

| F | Before (`772f6726b`) | After |
|---|---|---|
| F1 | `enum-src.mjs`: `srcEnum` / `resetEnum` / `structInEnumLocal` — 0 diagnostics, checkCore `[]`; cross-tab write emptied `xs` | each E-BOOTSTRAP-UNSUPPORTED naming `@e.A(xs)` / `@e.A(b).xs`; Core C3 / C17 refuse the planted twin |
| F2 | 7 planted spellings scored 0 hits; the e2e helper plant passed the test | every planted spelling (16) + the e2e plant reported by the real scan; real source: 0 |
| F3 | `nestSpreadInnerKeep`, `instSpreadKeep`: analyze clean, checkCore raw `C3: … o.inner.ys` | analyze clean, checkCore `[]`; the program runs (`u:2`) |
| F4 | `cellSpreadKeepXs`, `nestSpreadInnerSelf`, `instSpreadSelf`: E-WRITE-NOT-GRANTED | clean in both; runs |

## Owner questions (carried from round 1, renumbered; new ones marked NEW)

1. `reset(@b)` / `reset-on=` of a struct with a `replace`-less tape field — static refusal or run-time check? (Rec: static.)
2. Call-site subset code (direction ruled S435 "type"; the code is not). (Rec: E-WRITE-NOT-GRANTED.)
3. Fresh-value arguments (`take([])`, `take(mk())`) are not subset-checked — confirm.
4. A genuine replace's tape field written with a classifiable shape is judged as a `replace` — confirm.
5. Persist restore / cross-tab sync is a restore, not a program write (out of rule 4's "server reload") — confirm.
6. **Tape elements (the review's note):** replacing a tape of structs (`@gs = [...]`, `Row[free, append, replace]`
   with `Row = { ys: int[free, append] }`) is the outer tape's write; it compiles clean today, and the elements'
   own tape fields are NOT judged. Does a `replace` of the outer tape "replace" each element's tape field (so
   `ys` needs `replace` too), or is a new element a fresh value? Rec: a fresh value — an element is a value of
   the outer tape, and the outer `replace` grant is the write being made; judging the inner fields would make
   a tape of append-only logs impossible to `replace` at all.
7. `const` / parameter rebinding of a tape reports both E-ASSIGN-CONST and E-WRITE-NOT-GRANTED — acceptable?
8. **NEW (F1): an enum variant payload.** §66.12.6 rule 1's list does not name enum payloads (its lead says
   "wherever the tape is held"). (a) Confirm a payload is a tape position. (b) Is a variant SWITCH a fresh value
   or a `replace` of the payload tape — `.Dot` → `.A([1])` (no tape before), `.A(xs)` → `.Dot` (the tape is
   dropped), `.A(xs)` → `.A(ys)` (the same variant anew)? The bootstrap refuses all three with
   E-BOOTSTRAP-UNSUPPORTED when the payload tape grants no `replace`. Rec: same variant anew = a `replace`
   (E-WRITE-NOT-GRANTED); a switch AWAY from a payload variant that holds an append-only tape = a `replace`
   (dropping the log is the hole); a switch INTO a payload variant = a fresh value. Since the variant held is
   known only at run time, the static rule that follows is "a whole write of such an enum is a `replace`",
   i.e. E-WRITE-NOT-GRANTED.
9. **NEW (F1): the payload's own grant spelling.** A payload field has no `let` (it is a value), so its tape's
   grants are its type's alone. Confirm there is no payload-level `replace` beyond the type's.
10. **NEW (F3): the snapshot keep.** `@o = { ...@o, inner: { ys: @o.inner.ys } }` keeps `ys` as it was BEFORE the
    statement (strict snapshot, S440). If another override's call wrote `ys` in between (not expressible for an
    append-only sub-field tape today: a sub-field tape edit is E-BOOTSTRAP-UNSUPPORTED), the keep would restore the
    old value. Confirm "kept" means "equal to the statement's snapshot".

## Residuals (stated)

- The F2 scan is token-shaped, not a type checker: a read that never spells `grants` / `replace` / `edits` /
  `GrantSet` and never calls a GrantSet-returning function (a computed key `f["gr" + "ants"]`, a host escape)
  is not seen. The bootstrap dialect has no reflection, so that takes deliberate host code.
- Core's snapshot keep relies on once-bound Locals (one Let, no Assign) across the whole program; a Core that
  reused a Local sym across functions would lose the keep (fail closed: C3).
