---
from: S429-peter (P-Tech1)
to: bryan
date: 2026-09-23
subject: "three fixes held on your rulings, plus one behaviour change you should see before it lands"
needs: ruling
status: unread
---

# S429, second half: three held fixes need a ruling from you, and a fourth needs your eyes

This follows my earlier message (`2026-09-23-from-S429-peter-to-bryan-two-rulings.md`, Q1–Q4). Each item below is a
built fix parked on a hold ref, with the question that blocks it.

## ⚑ Q5 — Deep reactivity: amend §6.5.6 / §6.5.7, or make literal cells shallow?

**The spec (§6.5.6/§6.5.7):** "There is no implicit deep reactivity." "Mutating a field of an object inside a
reactive array does NOT trigger subscribers."

**What the runtime actually does:**
- Literal-initialised cells (`<xs> = [...]`) are wrapped `_scrml_deep_reactive`. Codegen `emit-logic.ts`
  `_wrapDeepReactive` wraps only syntactic literals. So their row-field edits DO update the DOM, and the Bug-64
  tests assert that.
- Computed writes (`.map`, `.filter`, spread, the `_scrml_deep_set` copies, `Array.from`, function results) store
  RAW values, so their row-field edits do not update the DOM.

**What an adopter sees:** after `@groups = @groups.map(…)` replaces one row, `g.name += "!"` updates every row EXCEPT
the replaced one (`g-each-replaced-row-stops-receiving-in-place-edits`, HIGH). It is an inconsistency, not a missed
update.

**The fix:** `_scrml_cell_value` in `_scrml_reactive_set` makes every cell write deep-reactive. Frozen values are left
raw, and a worker `.send` passes a plain copy. It is **built and held** on `origin/hold/s429-deep-reactive-cell-writes`
@ `58b90cfc`, with 23 tests, a clean corpus differential and flat subscription counts. It resolves the inconsistency in
the direction the spec text **forbids**.

**Your choice:**
- (a) amend §6.5.6/§6.5.7 to say what the runtime already does for literals, then land the hold; or
- (b) make literal cells shallow. That changes behaviour for every app relying on it today.

My lean is (a): the runtime and its tests have held the deep behaviour for a long time.

## ⚑ Q6 — A `<match>` inside an engine state-child vs your open (A)/(B) fork

This is `g-match-anywhere-in-engine-state-child-loses-the-state-child`. Today it gives a false
`E-ENGINE-STATE-CHILD-MISSING`.

**The fix:** built, reviewed CLEAN on every criterion, and held on `origin/hold/s429-match-in-engine-state-child` @
`e0ac22d6`. The dev's spec reading, which I verified, is that it is LEGAL: §51.0.B, §4.18.1 and the
E-CHANNEL-MOUNT-IN-CONDITIONAL row all assume it exists.

**Why I held it anyway:** E-IF-IN-DISPATCHED-ARM defines "dispatched arm" to include engine state-children, and
`g-nested-block-match-in-dispatched-arm-silently-drops` is your open fork, (A) refuse vs (B) support. Landing this
decides (B) for the engine position before you rule.

**Part of it is independent of the fork:** the parser layer. A `</>`-closed capitalised element inside a lowercase one
stole the state-child's closer, so `<div><Card>…</></div>` in a state-child breaks today. That part can be split out
and landed whatever you rule.

## ⚑ Q7 — Reserve the `_scrml_` identifier namespace?

#1037 fixed arm-name collisions with compiler internals: `el`, `_root`, `_d` and others were silently shadowed or
failed to compile. The fix `_scrml_`-prefixes the internals. The reviewer pointed out that user code may still declare
`_scrml_`-prefixed names, so the collision has moved into that namespace; it is now loud, as a duplicate declaration.
A one-line reservation, in the spec plus a diagnostic, would close it.

## ⚑ FYI before it lands — `when @x changes` honours its dependency list (§6.7.4), and every `when` changes timing

`g-when-changes-effect-fires-eagerly-at-registration` was filed MED, for the eager boot run only. The S429 PA
measured more: the `_scrml_effect(function(){ body })` lowering breaks all three §6.7.4 clauses.
- It runs on mount.
- It NEVER fires on its listed dep.
- It fires on whatever the body reads, because auto-tracking is forbidden but happens anyway.

**The fix:** built, and held on `origin/hold/s429-when-changes-honours-dep-list` @ `2eecc899`, **not yet reviewed**. It
changes the behaviour of every `when` in every program toward the spec.

**Corpus programs that change:**
- `when-001-basic-effect`
- `gauntlet-r10-go-contacts`
- `gauntlet-r10-vue-datatable`: its dep is a derived cell, so it never fires. That should be E-LIFECYCLE-007, which
  never fires either.
- `gauntlet-r10-svelte-dashboard`
- the `phase2-when-*` samples

**It also exposes that `@items.push(x)` in an inline handler never calls `_scrml_reactive_set`,** which violates
§6.5.1. Main's auto-tracking masked that, so it must be fixed in the same PR.

No ruling needed, since the spec is explicit, but you should see the blast radius before it lands.
