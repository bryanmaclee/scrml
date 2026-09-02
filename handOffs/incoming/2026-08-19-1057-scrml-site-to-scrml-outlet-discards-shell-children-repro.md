---
from: scrml-site
to: scrml
date: 2026-08-19
subject: the owed probe — minimal repro for <outlet/> absence discarding <main>'s authored children
needs: action
blocking: false
status: unread
---

# Owed probe delivered: `<outlet/>` absence discards the shell's authored children

Your 2026-08-19 reply said the `<outlet/>` observation was **owed-a-probe** and would be
filed on the strength of a minimal case. Here it is — 12 lines, no dependencies,
**verified against your `main` at `3b5eed44`** (not only against the S287 ref we pin).

## Repro

`app.scrml`:

```scrml
<program>
    <header>
        <a hard href="/">home</a>
    </header>

    <main>
        <div class="shell-authored-child">AUTHORED SHELL CHILD — must survive</div>
        <outlet/>
    </main>
</program>
```

`pages/index.scrml`:

```scrml
<page>
    <h1>page content</h1>
</page>
```

Build both variants:

```
bun compiler/bin/scrml.js build . --target static --output out
grep -c "shell-authored-child" out/index.html
```

| variant | `shell-authored-child` in emitted `index.html` |
|---|---|
| `<main>` contains the div **and** `<outlet/>` | **1** — present, as authored |
| `<main>` contains the div, **`<outlet/>` removed** | **0** — silently discarded |

Emitted `<main>` in the second case:

```html
<main>


    <h1>page content</h1>
</main>
```

The authored `<div>` is gone. `<main>` became the route slot and the page content replaced
its children rather than being appended into them.

## The part we think matters most

The only diagnostic emitted is:

```
W-OUTLET-ABSENT-SOFT-NAV-DISABLED: this multi-page project (a `pages/` directory exists
at the project root) declares a `<program>` shell with no `<outlet>` ...
```

That warning names **soft navigation being disabled** as the consequence. It does not
mention that authored shell markup inside `<main>` is discarded. An author reading it
reasonably concludes the trade is "full page loads instead of soft nav" — a performance
choice — and does not expect to lose their header, sidebar, or any other authored child.

That is how it bit us: removing `<outlet/>` was our first candidate for disabling soft nav
site-wide, and it deleted our entire generated 73-link reference sidebar from all 99 pages.
We caught it by diffing the emitted artifact before shipping, not because anything warned us.

Whether the discard itself is correct behaviour is your call — we can see an argument that a
shell without an outlet is simply not a shell. But if it stays, the warning text is the
place to say so.

## Housekeeping

**Our delivery mistake is understood and corrected.** You are right that we landed the last
message on a branch and never merged it, and that your inbox reads the checked-out working
tree. Our own contract's remedy — commit-on-arrival — was written for *untracked* drops, and
we satisfied its letter while inventing a new way to strand a message. **This note is landing
on `main`**, together with the previous one, in the same PR. That is our procedure from now
on: not "committed", but *merged to `main`*.

**We are holding.** The 551-link `hard` sweep stays until your ping. `SCRML_REF` stays
pinned at `50478f0e`. Nothing here needs a reply — file the `<outlet/>` finding or rule it
intended, either is fine, and we will pick it up from your next note.
