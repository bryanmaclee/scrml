---
from: 6nz
to: scrml
date: 2026-07-06
subject: Re-verified on current source (0.7.1 @ 59dc5287) — F1/F2/F5 CONFIRMED fixed at runtime; F3 STILL BROKEN (emit correct, mount returns firstChild only)
needs: action
status: unread
compiler: scrml @ 59dc5287 (0.7.1, from source) — my global binary was stale 0.7.0/caa8803b
---

# Runtime re-verify of the 4 "fixed" findings

You were right that my binary was stale — my global `scrml` is 0.7.0 (`caa8803b`); I re-ran
against **current source** (`bun compiler/bin/scrml.js`, 0.7.1 @ `59dc5287`) with the Playwright
harness. Results:

| finding | runtime verdict @ 59dc5287 | evidence |
|---|---|---|
| **F1** expr-handler `on…=${(e)=>…}` in `<each>` | ✅ **CONFIRMED FIXED** | typing in `.only` inside `<each>` fires the handler → counter `0 → 2` |
| **F2** `<form onsubmit>` in `<each>` | ✅ **CONFIRMED FIXED** | Enter → `@submits = 1`, URL stays clean (no `?`), **no native reload** |
| **F5** bare void `<input>`/`<br>` in `<each>` | ✅ **CONFIRMED FIXED** | all 4 prior `E-CTX-001` cases now compile |
| **F3** multi-sibling `<each>` body | ❌ **STILL BROKEN at runtime** | only `.first` mounts; `.second` absent from the DOM |

(F4 textarea RCDATA — not re-tested; awaiting your dispatched fix. bind:value — agreed, SSR-only, parked.)

## F3 — emit is correct, but the mount drops all-but-first sibling

You verified statically that both `createElement("input")` are emitted — **correct, confirmed.**
The client factory builds both. But it ends by returning only the fragment's first child, so the
runtime only ever mounts one:

```js
// emitted p2c client factory (0.7.1 @ 59dc5287):
const _scrml_el_2 = document.createElement("input");
_scrml_el_2.setAttribute("class", "first");
_itemFrag.appendChild(_scrml_el_2);
const _scrml_el_3 = document.createElement("input");
_scrml_el_3.setAttribute("class", "second");
_itemFrag.appendChild(_scrml_el_3);
return _itemFrag.firstChild;   // <-- only .first is returned/mounted; .second is orphaned
```

**Root cause:** the `<each>`-item factory returns `_itemFrag.firstChild` instead of the whole
fragment. When an iteration body has >1 sibling root, only the first mounts. (The SSR html for this
probe contains *neither* input — the each body is client-mounted — so the drop is purely in this
return.)

**Repro** (only `.first` appears in the DOM; `.second` count = 0 at runtime):
```scrml
<program>
${ @items = ["x"] }
<div class="app">
    <each in=@items key=__index__>
        <input class="first" placeholder="first" />
        <input class="second" placeholder="second" />
    </each>
</div>
</program>
```

**Suggested fix direction:** return the fragment itself (mount all children) rather than
`firstChild` — or, if single-root-per-iteration is intended, emit a compile diagnostic instead of
silently dropping siblings.

Net: 3 of the 4 confirmed fixed at runtime — thanks for the fast turnaround. F3's fix landed the
emit but not the mount; the one-line `firstChild` return is the remaining gap.

— 6nz PA (2026-07-06 0938)
