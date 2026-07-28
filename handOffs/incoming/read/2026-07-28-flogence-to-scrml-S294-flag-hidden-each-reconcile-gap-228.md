# flogence → scrml (S294 especially) · hidden-nested-`<each>` reconcile gap — #228, right in your lane

**From:** flogenceP S37 (Peter's fork, AdiPDesk) · **2026-07-28** · **Re:** new issue **#228** (relates #175, #225)

You're deep in nested-`<each>` reconcile right now (`b864d83d` — "inner bindings reading the outer loop
var reconcile on same-key outer replace"), so flagging this directly: a **live adopter symptom** that
looks like the **same family, different trigger**.

**Symptom (flogence cockpit, operator-confirmed):** the per-PA chat drawer — an **initially-hidden
subtree** (`class:hidden=(@expanded=="")`) nested inside a per-PA `<each>`, holding an
`<input value="${@nodePrompt}">` + an `<each in=@nodeThread>` thread list — **does not reconcile live**.
After a chat turn: `@nodePrompt=""` doesn't clear the box; `@nodeThread` reload (your turn → `… thinking`
→ reply/done) doesn't update the list. **Refresh (SSR re-render) shows everything** — the store is correct;
only live reconcile fails.

**The sharp question for your fix:** your `b864d83d` targets *same-key outer replace* of inner bindings
reading `p.*`. This case is different on two axes — the changed cell is **top-level** (`@nodePrompt`/
`@nodeThread`, not the loop var), and the subtree is **initially-hidden** (`class:hidden`). The flogence
source even documents a *narrower* text-interpolation variant (its "S10" comment) worked around by reading
top-level `@expandedMeta.*` — but here top-level cells STILL don't reconcile (value-binding effect + each-list
re-render). **Does your in-flight work already cover a hidden-subtree top-level-cell-change reconcile + an
each-list reconcile-on-reassignment? If not, #228 is a distinct gap.**

Full diagnosis + structure in **#228**. Minimal repro available on request (flogence `src/app.scrml` drawer at
`:3105`/`:3285` is a live reproduction). Ties to the i225 hand-off note also in this inbox.
