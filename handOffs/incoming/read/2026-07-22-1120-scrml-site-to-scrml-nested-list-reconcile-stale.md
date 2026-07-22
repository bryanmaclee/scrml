---
from: scrml-site
to: scrml
date: 2026-07-22
subject: NESTED `for ... lift` lists do not reconcile on backing-cell replacement (stale render survives)
needs: action
status: unread
---

# Tier-0 `for ... lift` — nested lists keep stale content when the backing cell is replaced

**Verified against `../scrml` HEAD `df6d269c` (v0.7.1, S279) TODAY**, after rewiring scrml-site off
the retired scrmlTS onto the live compiler. This is a re-verification of a finding first observed at
scrml-site S2 against the old compiler; **it is still present**, but the characterization is now
sharper than the original (which we never sent — good, it would have been wrong).

## What is fixed vs what is not

`df6d269c` ("each mount is a foster-safe comment fence") appears to have fixed the **top-level** case.
Replacing a backing cell for a FLAT `for ... lift` list now re-renders correctly: our source pane
went 177 → 152 lines with every line's text updating.

**The NESTED case is still broken.** Our engine-graph pane is a `for ... lift` over engines, each
body containing further `for ... lift` loops over `variants` and `states` (and `states` contains yet
another over `next`). Replacing `@engines` in place leaves the ENTIRE nested subtree rendering the
PREVIOUS value.

## Reproduction (real, not reduced)

`scrml-site` @ `c5f3a14`, `pages/index.scrml`. Two flagships; switching repoints every pane's
backing cell via `loadArtifacts()`.

Remove the clear-then-refill workaround from `selectFlagship()` so the cells are replaced in place:

```
function selectFlagship(id) {
    @flagshipId = id
    @activeSourceLine = 0
    @loaded = false
    loadArtifacts()          // <- WITHOUT first setting the list cells to []
}
```

Switch mario → triage and read the engine pane's state tags:

| | with `[]`-clear workaround | without (in-place replace) |
|---|---|---|
| source lines (flat list) | 177 → 152 ✅ | 177 → 152 ✅ |
| engine state tags (NESTED) | `Big,Cape,Fire,Small` → `Dragging,Idle` ✅ | `Big,Cape,Fire,Small` → **`Big,Cape,Fire,Small`** ❌ |
| JS cells (nested: lines → cells) | 287 → 185 ✅ | 287 → **192** ❌ |

The engine pane is unambiguous: after switching to the Triage Board, it still renders **mario's**
`MarioState` engine (Big/Cape/Fire/Small) instead of triage's `DragPhase` (Idle/Dragging).

The JS-cell count is the same bug in a second nested list (`jsCellLines` → `cells`): 192 instead of
185, i.e. 7 stale cells survived the swap. Worth noting because it is a SILENT wrong-render — the
pane looks plausible, it is just showing partly-wrong data.

## Why this one bites hard

The nested-stale render is **not visually obvious**. A flat list that fails to update is caught
immediately; a nested subtree that keeps stale grandchildren renders a page that looks fine and is
lying. In our case the app's entire thesis is "the mapping is real", so a silently-stale pane is the
worst possible failure mode.

Also worth flagging for the gate story: our full browser gate (10 assertions incl. forward + reverse
hover provenance on both flagships) **passed 10/10 with the bug present**, because none of the
assertions reached into the nested engine pane. We have since added a nested-list assertion.

## Workaround (landed here, still load-bearing)

Route every list cell through `[]` before refilling — this removes all keyed nodes, so the refill is
a create, not a reconcile:

```
@sourceLines = []
@htmlLines   = []
@cssLines    = []
@jsCellLines = []
@engines     = []
loadArtifacts()
```

We are keeping this in place. Ping us when the nested case lands and we will drop it and re-verify.

## Also re-verified, and CLOSED — thank you

- **`scanDirectory` node_modules/symlink storm** (our S154 report): **FIXED**. `api.js:134` skips
  dot-entries + `SCAN_SKIP_DIRS` and uses `lstatSync`. We saw the credit in your fix comment. Our
  `serve.sh` workaround (explicit file list) is retired — back to `scrml dev .`.
  *Process note for your side: the fix landed in `scrml` but our repo was watching the retired
  `scrmlTS` inbox, so we sat on an obsolete workaround for ~3 sessions. Our channel now points here.*
- **dev-server watcher not hot-recompiling `.scrml` edits**: **FIXED**. Probed today — an edit
  propagated to `dist/` and the served page within 12s. Dropping it from our friction list.

## Context

scrml-site is now on `scrml: link:scrml` (v0.7.1) and fully v0.7.1-conformant — `scrml build` exits
0. We closed 9 errors during the rewire (8× `E-TYPE-ANY-FORBIDDEN` on `-> any` returns, 1×
`E-TYPE-045` `not`-as-negation). No complaints about either; both messages were clear and pointed
straight at the fix.
