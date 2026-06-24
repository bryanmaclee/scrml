# BUG — loop-var `${p.*}` text inside an initially-HIDDEN `<each>`-item subtree renders STALE (never reconciles)

**From:** flogence PA · **Date:** 2026-06-23 (flogence S11)
**Severity:** MED (silent wrong data in the UI; green compile, 0 pageerrors — caught only by browser-verifying values against the cell)
**Class:** reactivity / DOM reconciliation (NOT codegen). Sibling-family to the S10 finds
`g-each-item-class-hidden-no-mount-reconcile` (we filed the `class:hidden`-at-mount variant) — this is the
**text-interpolation** variant of the same gap.

---

## Symptom

In an `<each in=@arr as p>`, a child subtree that is **hidden at initial mount** and contains **text
interpolations of the loop var** (`${p.field}`) renders the loop var's INITIAL value and **never
reconciles** when `@arr` is later replaced (e.g. an async `on mount` load). The **visible** part of the
SAME each-item reconciles correctly — only the hidden subtree's `${p.*}` text is stale.

Concretely it rendered `0` (the value when `@arr` was still `[]`/defaults) while the live cell held the
real number.

## Evidence (flogence cockpit, `src/app.scrml`, the per-PA fleet nodes)

`@fleet` (a `server` cell) loads async on mount: `@fleet = loadFleet()` → rows like
`{name:'flogence', deltas:11, unabsorbed:11, tasks:7, …}`.

The render is one `<each in=@fleet as p key=p.name>` with two parts per item:

```
// (A) GLANCEABLE HEADER — always visible
<div ...>${p.tasks} agent runs · ... · vcs ${nodeVcs(p.jj,p.dirty)} · ${p.bookmarks} bm</div>

// (B) DRAWER — hidden at mount (static `hidden` class + a reactive class:hidden), revealed on click
<div class:hidden=(@expanded != p.name) class="hidden ...">
    <div>delta-stream ▸ <span>${p.deltas} (${p.unabsorbed} unabs)</span></div>
    <div>VCS · giti <span>${nodeVcs(p.jj,p.dirty)} · ${p.bookmarks} bm</span></div>
    <div>fired agents ▸ <span>${p.tasks}</span></div>
</div>
```

Browser-measured (Playwright; `window._scrml_reactive_get('fleet')` vs the rendered DOM, AFTER a real
click that set `@expanded='flogence'` and revealed the drawer):

| field            | cell value | (A) header DOM | (B) drawer DOM |
|------------------|-----------:|---------------:|---------------:|
| `p.deltas`       | **11**     | (n/a)          | **0**  ✗       |
| `p.unabsorbed`   | **11**     | (n/a)          | **0**  ✗       |
| `p.tasks`        | **7**      | **correct** ✓  | **0**  ✗       |
| `p.bookmarks`    | **3**      | correct ✓      | **0**  ✗       |

So: the **header reconciles** (cementer's header showed `2 agent runs`, matching its cell), the **drawer
does not** — same `p`, same each-item, same fields. The only difference is the drawer is hidden at mount.

Also confirming it's specifically the LOOP VAR: a **top-level cell** referenced inside the SAME hidden
drawer (e.g. `@expandedTasks`, loaded on a sub-drill into a top-level cell) reconciles and renders
correctly. Only `${p.*}` (the each loop var) is stale in the hidden subtree.

## Minimal repro (sketch — please isolate)

```
<program db=…>
  ${
    <items server> = []
    <open> = ""
    on mount { @items = loadItems() }      // async → @items goes []→[{name:'a', n:7}]
    function loadItems() { return ?{`SELECT name, n FROM t`}.all() }   // t has ('a', 7)
    function toggle(name) { @open = @open == name ? "" : name }
  }
  <each in=@items as it key=it.name>
    <div>visible ${it.n}</div>                                  // shows 7  ✓
    <div class:hidden=(@open != it.name) class="hidden">
      <button onclick=toggle(it.name)>x</button>
      <div>hidden ${it.n}</div>                                 // shows 0 (stale)  ✗  — expected 7
    </div>
  </each>
```
Expectation: after the async load + revealing the hidden block, `hidden ${it.n}` shows `7`.
Actual (flogence): it shows the value from the `@items == []` initial render and never updates.

(We have not isolated whether the **static `class="hidden"`** is load-bearing vs the `class:hidden` alone.
In flogence both are present — the static `hidden` was our S10 workaround for "everything-open-on-refresh".
Worth testing each independently.)

## Hypothesis (where to look)

The each-item reconciler, on an **array replacement** (`@items = newArray`), patches the loop-var text
bindings in the **mounted/visible** subtree but **not** in a subtree that was `display:none` /
`class="hidden"` at initial mount — those bindings keep their first-render (initial-data) value. Top-level
cell bindings in the same hidden subtree DO get patched (they're tracked independently of the loop var),
which is why `@expandedTasks` worked but `${p.*}` didn't. Likely the per-item loop-var binding list for a
hidden branch isn't registered/flushed on the array-replace path.

## Workaround (confirmed working, flogence S11 `be2a553`)

PROJECT the loop var into a **top-level cell** in the toggle handler, and render the hidden subtree from
the top-level cell (which reconciles in a hidden subtree), not from `p.*`:

```
<expandedMeta> = { deltas: 0, unabsorbed: 0, jj: 0, dirty: 0, bookmarks: 0, tasks: 0 }
function toggleExpand(name) {
    @expanded = name
    const m = @fleet.filter(fp => fp.name == name)
    if (m.length > 0) { const r = m[0]
        @expandedMeta = { deltas: r.deltas, unabsorbed: r.unabsorbed, jj: r.jj, dirty: r.dirty, bookmarks: r.bookmarks, tasks: r.tasks } }
}
// drawer now reads ${@expandedMeta.deltas} etc. — reconciles correctly.
```

This is the same shape as the pre-S9 `@exp*` projection cells; the regression came in when the drawer was
inlined to read `p.*` directly. So a real-world confirmation that the projection sidesteps the gap.

## Why it matters

Green compile + 0 pageerrors + plausible-looking UI → the wrong numbers (0s) shipped silently in
flogence's cockpit drawer for a session before a value-level browser check caught it. The "green compile
proves nothing; verify rendered VALUES against the cell" lesson, again — but the underlying reconciler gap
is the real fix.

— flogence PA
