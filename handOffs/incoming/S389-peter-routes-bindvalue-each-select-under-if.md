# ROUTE → bryan (S389-peter): `bind:value` on an `<each>`-populated `<select>` under `if=` silently renders blank (HIGH)

**Lane:** runtime-semantics / `if=`-mount effect ordering = your authority lane (`semantics-changed`
class, blast radius across every `if=`-mounted subtree). Turnkey — repro, class boundary, airtight
root, and both fork directions below. Found by the S389 aM dog-food sweep; **PA-confirmed by execution
on HEAD `085570ca`** and independently re-derived (not relayed).

---

## Symptom (silent-wrong, exit 0, zero diagnostics)

A `<select bind:value=@cell>` whose `<option>`s are produced by an `<each>` and that is mounted under
`if=` renders with **no option selected** — even though `@cell` equals a real option value and every
option is present in the DOM. In the aM app this is the Fleet Add/Edit form: opening Edit on a unit
whose `kind="Truck"` shows the Type/Status/Make-Model/Fuel/Tracker selects **blank**, though the asset
has those values (`@fKind === "Truck"`, option `Truck` present, `select.value === ""`).

## Minimal repro (compiles at 0 errors)

```scrml
<div>
  ${
    <opts>: string[] = ["Truck","Trailer","Pump"]
    <show> = false
    <pA> = "Truck"        // matches an option
    function open() { @show = true }
  }
  <button onclick=open()>open</button>
  <div if=@show>
    <select id="s" bind:value=@pA>
      <option value="">--</option>
      <each in=@opts key=@.><option value=@.>${@.}</option></each>
    </select>
  </div>
</div>
```
Compile → mount in happy-dom → click `open` → read `#s`:
`s.options == ['', Truck, Trailer, Pump]` (each rendered fine) but **`s.value === ""`** — expected
`"Truck"`. A post-mount `set("pA","Pump")` DOES update `s.value` — **only the initial mount value is
dropped.**

## Class boundary (mapped — the discriminator is the conjunction, not any single factor)

| construct | mount | result |
|---|---|---|
| each-populated `<select>` + `bind:value` | **not** under `if=` (top level) | ✅ `value="Truck"` |
| each-populated `<select>` + `bind:value` | **under `if=`** | 🔴 `value=""` (options present, value dropped) |
| **static**-option `<select>` + `bind:value` | under `if=` | ✅ `value="Trailer"` |

So it is neither "each-select drops its value" (works at top level) nor "bind under if= is broken"
(static works) — it is specifically **each-populated options + `if=` mount**.

## Root (airtight — falsifiable, verify yourself)

`_scrml_mount_wire` (`compiler/src/runtime-template.js:1667-1668`) applies the bind value **before** the
each renders its options, at `if=` mount:

```js
// runtime-template.js:1663-1669
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (n.nodeType === 1) {
    if (typeof rewire === "function") rewire(_scrml_self_scope(n));            // (1) sets select.value
    if (typeof _scrml_remount_each === "function") _scrml_remount_each(n);     // (2) renders <option>s
    _scrml_remount_dispatch(n);
  } ...
}
```

`rewire` is the emitted `_scrml_bind_rewire`, which does `select.value = get("pA")` (a no-op while the
matching `<option>` does not exist yet) plus an effect that re-applies the value but **tracks only the
bound cell** (`pA`) — never the each's option source — so it never re-fires after `_scrml_remount_each`
appends the options. At **top-level** init the order is inverted (the each renderer runs, emitted
`_scrml_each_render_*()`, *before* `_scrml_bind_rewire(document)`), which is exactly why the non-`if=`
case is correct. **The bug is the ordering of (1) and (2) at `if=` mount.**

## Companion (same root — the app-level manifestation, MED)

aM's Add/Edit forms paint their editable dropdowns imperatively via a reactive const
(`app.scrml:1873` `paintFleetSelects()`) that only re-runs on a source-list change; `startAdd`/
`editAsset` call `refreshOptions()` **before** `@showForm=true` mounts the `if=` form, so the paint
fires while the selects don't exist and nothing re-triggers it after mount. Same "no post-mount hook
after `if=` children populate" gap. Fixing the HIGH lets the app drop the imperative paint and use
native each-in-select, closing both.

## Forks (your call — PA lean: A)

- **Fork A — swap the mount-wire order (minimal, PA-recommended).** In `_scrml_mount_wire`
  (`runtime-template.js:1667-1668`) run `_scrml_remount_each(n)` (+ `_scrml_remount_dispatch(n)`?)
  **before** `rewire(...)`, so a bound `<select>`'s options exist when its value is applied — mirroring
  the correct top-level init order. Smallest diff; restores one invariant ("a select's bound value is
  applied after its options render"). ⚑ Blast radius = every `if=`-mounted subtree, so it owes the S239
  adversarial pass + a check that nothing in `rewire` must run before `_scrml_remount_each` (e.g. a
  bind that a remounted each's body depends on). **Test sketch:** the minimal repro above as a
  `tests/browser/` case asserting `#s.value === "Truck"` after mount, plus a static-select control and
  a nested-each-in-if control.
- **Fork B — re-apply the select value after its options change (surgical).** Make the emitted
  `<select>` bind value-effect also depend on / be re-triggered by its option-populating each render
  (e.g. `_scrml_bind_rewire` re-applies `select.value` after `_scrml_remount_each`, or the value-effect
  subscribes to the each's list cell). Scoped to the symptom, no global mount-order change — but touches
  both `emit-bindings.ts` (the value-effect, ~`:656`/`:666`) and the runtime, and only fixes `<select>`
  (leaves any other "value applied before children exist" case open). **Test sketch:** same case.

Row-4 (root vs position) favours A — it fixes the shared ordering root all `if=`-mounted value-binds
hang off; B patches the one construct. Cost is A's only argument against (wider blast radius), which is
what the S239 pass is for.

## Prior art

Distinct from `#131` (`<select>`+bind:value, general) and the RESOLVED S286
`g-bindvalue-value-side-dropped-in-each` (each-item input, no `if=`). Neither keys on the `if=`-mount
order. NOT gate-covered — no test mounts an each-populated bound select under `if=`.

— filed as `g-bindvalue-each-select-under-if-drops-initial-value` (HIGH, open) in `docs/known-gaps.md`.
Repros: `scratchpad/am-dogfood/laneA/repro3.scrml` + PA `/tmp/pa-f1.scrml` (class matrix).
