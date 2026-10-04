# s451-spec-binder — the whole-error binder `| _ err :>` (S451 "a")

Branch `spec/s451-whole-error-binder`, cut from origin/main `d3e660a08` (#1268).

## SPEC changes
- §18.2 grammar: `whole-error-arm ::= '_' Identifier` (failable subjects only). E-MATCH-BARE-BINDER bullet:
  the fix it names is `| _ err :>`; two messages (failable site / other match); `_ <name>` on a
  non-failable `match` and `else <name>` take the same code. "Who pays" sentence on examples/09 struck.
- §18.6: exception sentence in "Binding"; new §18.6.1 "The Whole-Error Binder" — semantics, binder type
  (declared error enum · `SqlError` for `?{}` · §19.9.10 failure set, shape OPEN for U1b), never matches
  `.Ok` in a `match`, scope reasoning (failures only — quoted §18.6's "named default pattern ... not
  part of v1"), why `!` is not a value, provenance + PA readings flagged.
- §19.4.3: the "wildcard arm takes no binder ... `| _ e :>` has no meaning" sentence struck + superseded.
  §19.4.4: new normative bullet; bare-binder bullet names the fix.
- §19.7.1: `_ err` arm covering every error variant, example.
- §19.9.10: the until-U1b `| _ :>` sentence mentions `| _ err :>`.
- §18.15 and §34 E-MATCH-BARE-BINDER rows name the fix and the new fire sites.

## impl#1 probe (d3e660a08)
- `saveDraft() !{ | _ err :> { @state = .Failed(err) } }` → exit 0, emits `const err = result.data`
  (payload, `null` for a unit variant) — NOT the whole error.
- `match saveDraft() { .Ok(v) :> 1  _ err :> 2 }` → exit 0, `_ err` arm silently DROPPED.
- ordinary enum `match x { .North :> "n"  _ other :> "x" }` → exit 0, arm dropped, no diagnostic.
- Filed `docs/known-gaps.md` `g-impl1-whole-error-binder-s451` (MED, open).

## Migration owed (not done here — impl#1 frozen; examples untouched per brief)
- `examples/09-error-handling.scrml` lines 113, 117: `| err :>` → `| _ err :>` (binding unchanged in intent).
- `examples/16-remote-data.scrml:83`, `examples/29-engine-vs-flags.scrml:97`: `| err :>` → `| _ :>`
  (binding unused) or `| _ err :>`.
- 15 `| _ <name> ->` arms in 9 `samples/` files now carry meaning (whole error); no edit required.

## Status
- [x] SPEC amended  - [x] gap filed  - [x] gates (spec-index --check, s34-census --check-new PASS 2 rows, facts --check, state --check)  - [ ] push
